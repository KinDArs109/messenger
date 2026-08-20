import { Router } from "express";
import multer from "multer";
import { LIMITS, boostLevel, uploadLimitFor, type AttachmentDto } from "@messenger/shared";
import { prisma } from "../../db/client.js";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { uploadLimiter } from "../../middleware/rateLimit.js";
import { newId } from "../../lib/ids.js";
import { badRequest } from "../../lib/errors.js";
import {
  fileUrl,
  isInlineType,
  saveAvatar,
  saveEmoji,
  saveFile,
  saveVoice,
  sniffMimeType,
  thumbUrlFor,
} from "../../lib/storage.js";

/** Файл держим в памяти, а не сразу на диске: пока не проверили
 *  содержимое, класть его в раздаваемую папку нельзя. Предел в 10 МБ
 *  делает это безопасным по памяти. */
const upload = multer({
  storage: multer.memoryStorage(),
  // Здесь стоит самый большой предел, какой вообще бывает, — предел
  // третьего уровня. Настоящий предел зависит от сервера, куда файл
  // отправляют, и проверяется ниже: multer о серверах и уровнях
  // не знает ничего.
  limits: { fileSize: uploadLimitFor(3), files: 1 },
});

/**
 * Сколько можно этому человеку в этот канал.
 *
 * Предел растёт с уровнем сервера — это и есть награда за буст.
 * В личной переписке уровня нет и быть не может: сервера там нет,
 * поэтому там всегда базовый.
 */
async function limitFor(userId: string, channelId: string | undefined): Promise<number> {
  if (!channelId) return LIMITS.uploadBytes;

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { serverId: true },
  });
  if (!channel?.serverId) return LIMITS.uploadBytes;

  // Членство проверяем не ради предела, а ради приличия: спрашивать
  // про чужой сервер незачем.
  const member = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId: channel.serverId, userId } },
    select: { serverId: true },
  });
  if (!member) return LIMITS.uploadBytes;

  const boosts = await prisma.serverBoost.count({ where: { serverId: channel.serverId } });
  return uploadLimitFor(boostLevel(boosts));
}

export const uploadsRouter: Router = Router();
uploadsRouter.use(requireAuth);

uploadsRouter.post("/", uploadLimiter, upload.single("file"), async (req, res) => {
  const userId = currentUserId(req);
  const file = req.file;
  if (!file) throw badRequest("NO_FILE", "Файл не получен");
  if (file.size === 0) throw badRequest("EMPTY_FILE", "Файл пустой");

  // Куда отправляют — знает клиент, и он же прикладывает это к запросу.
  // Без канала предел базовый: так ведут себя личные переписки, где
  // сервера нет, и любой запрос, пришедший не из мессенджера.
  const channelId = typeof req.body?.channelId === "string" ? req.body.channelId : undefined;
  const limit = await limitFor(userId, channelId);
  if (file.size > limit) {
    throw badRequest(
      "FILE_TOO_LARGE",
      `Файл больше ${Math.round(limit / (1024 * 1024))} МБ — столько можно на этом сервере`,
    );
  }

  // Тип берём из содержимого. То, что прислал браузер в Content-Type,
  // и расширение в имени — это данные пользователя, им веры нет.
  const mimeType = sniffMimeType(file.buffer);
  // Картинки при этом пережимаются в WebP, поэтому и тип, и размер
  // на выходе могут отличаться от присланных — берём их из хранилища,
  // а не из того, что пришло.
  const stored = await saveFile(file.buffer, mimeType);

  const attachment = await prisma.attachment.create({
    data: {
      id: newId(),
      uploaderId: userId,
      // Имя показываем пользовательское, но на диске оно не участвует.
      filename: sanitizeName(decodeOriginalName(file.originalname)),
      storageKey: stored.key,
      size: stored.size,
      mimeType: stored.mimeType,
      width: stored.width,
      height: stored.height,
    },
  });

  const dto: AttachmentDto = {
    id: attachment.id,
    filename: attachment.filename,
    size: attachment.size,
    mimeType: attachment.mimeType,
    url: fileUrl(attachment.storageKey),
    thumbUrl: thumbUrlFor(attachment.storageKey, attachment.width),
    width: attachment.width,
    height: attachment.height,
  };

  res.status(201).json({ attachment: dto });
});

/**
 * Аватар профиля или значок сервера.
 *
 * Отдельно от вложений, потому что и обрабатывается иначе: картинка
 * обрезается в квадрат и уменьшается до размера, в котором её и будут
 * показывать. Присланная с телефона фотография весит мегабайты, а на
 * экране это кружок в сорок точек — гонять через туннель разницу
 * незачем.
 *
 * Ответ — только ссылка. Куда её поставить, решает следующий запрос:
 * себе в профиль или серверу.
 */
uploadsRouter.post("/picture", uploadLimiter, upload.single("file"), async (req, res) => {
  const userId = currentUserId(req);
  const file = req.file;
  if (!file) throw badRequest("NO_FILE", "Файл не получен");
  if (file.size === 0) throw badRequest("EMPTY_FILE", "Файл пустой");

  const mimeType = sniffMimeType(file.buffer);
  if (!isInlineType(mimeType)) {
    throw badRequest("NOT_IMAGE", "Нужна картинка: PNG, JPEG, GIF или WebP");
  }

  const stored = await saveAvatar(file.buffer);
  if (!stored) throw badRequest("BAD_IMAGE", "Не удалось прочитать картинку");

  const attachment = await prisma.attachment.create({
    data: {
      id: newId(),
      uploaderId: userId,
      filename: "avatar.webp",
      storageKey: stored.key,
      size: stored.size,
      mimeType: stored.mimeType,
      width: stored.width,
      height: stored.height,
    },
  });

  res.status(201).json({ url: fileUrl(attachment.storageKey) });
});

/**
 * Голосовое сообщение.
 *
 * Своим маршрутом, а не общей загрузкой, по одной причине: по заголовку
 * файла видно контейнер, но не то, звук в нём или видео. Обычная
 * загрузка честно назовёт запись «видео», и в ленте вместо полоски
 * со звуком появится чёрный прямоугольник. Здесь же мы знаем, что
 * пришло: маршрут для записи голоса.
 *
 * Длительность присылает клиент — он единственный, кто её знает:
 * Chrome пишет webm без длительности в заголовке, и проигрыватель
 * до конца записи считает её бесконечной.
 */
uploadsRouter.post("/voice", uploadLimiter, upload.single("file"), async (req, res) => {
  const userId = currentUserId(req);
  const file = req.file;
  if (!file) throw badRequest("NO_FILE", "Файл не получен");
  if (file.size === 0) throw badRequest("EMPTY_FILE", "Файл пустой");

  const container = sniffMimeType(file.buffer);
  if (container !== "video/webm" && container !== "video/mp4") {
    throw badRequest("NOT_VOICE", "Это не запись голоса");
  }

  // Пять минут — с запасом. Ограничение здесь не про диск, а про смысл:
  // то, что длиннее, проще сказать в разговоре.
  const seconds = Math.round(Number(req.body?.duration ?? 0));
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 300) {
    throw badRequest("BAD_DURATION", "Не разобрал длительность записи");
  }

  const stored = await saveVoice(file.buffer, container);
  if (!stored) throw badRequest("BAD_VOICE", "Не удалось сохранить запись");

  const attachment = await prisma.attachment.create({
    data: {
      id: newId(),
      uploaderId: userId,
      filename: "Голосовое сообщение",
      storageKey: stored.key,
      size: stored.size,
      mimeType: stored.mimeType,
      width: null,
      height: null,
      duration: seconds,
    },
  });

  const dto: AttachmentDto = {
    id: attachment.id,
    filename: attachment.filename,
    size: attachment.size,
    mimeType: attachment.mimeType,
    url: fileUrl(attachment.storageKey),
    thumbUrl: null,
    width: null,
    height: null,
    duration: attachment.duration,
  };

  res.status(201).json({ attachment: dto });
});

/**
 * Картинка для эмодзи сервера.
 *
 * Отдельно от аватара, потому что и обрабатывается иначе: прозрачность
 * сохраняется, картинка вписывается целиком, а не обрезается по центру.
 * У эмодзи по краям обычно и лежит самое важное — обрезав, получим
 * кусок вместо картинки.
 *
 * Ответ — только ссылка. Кому она достанется, решает следующий запрос:
 * эмодзи заводится на сервере отдельно.
 */
uploadsRouter.post("/emoji", uploadLimiter, upload.single("file"), async (req, res) => {
  const userId = currentUserId(req);
  const file = req.file;
  if (!file) throw badRequest("NO_FILE", "Файл не получен");
  if (file.size === 0) throw badRequest("EMPTY_FILE", "Файл пустой");

  const mimeType = sniffMimeType(file.buffer);
  if (!isInlineType(mimeType)) {
    throw badRequest("NOT_IMAGE", "Нужна картинка: PNG, JPEG, GIF или WebP");
  }

  const stored = await saveEmoji(file.buffer);
  if (!stored) throw badRequest("BAD_IMAGE", "Не удалось прочитать картинку");

  const attachment = await prisma.attachment.create({
    data: {
      id: newId(),
      uploaderId: userId,
      filename: "emoji.webp",
      storageKey: stored.key,
      size: stored.size,
      mimeType: stored.mimeType,
      width: stored.width,
      height: stored.height,
    },
  });

  res.status(201).json({ url: fileUrl(attachment.storageKey) });
});

/** Браузер шлёт имя файла в UTF-8, а multer разбирает multipart
 *  как latin-1 — «заметка.txt» приезжает как «Ð·Ð°Ð¼ÐµÑ‚ÐºÐ°.txt».
 *  Возвращаем байты обратно и читаем правильной кодировкой.
 *  Для ASCII-имён преобразование ничего не меняет. */
function decodeOriginalName(name: string): string {
  const restored = Buffer.from(name, "latin1").toString("utf8");
  // Если байты не складывались в корректный UTF-8, появится U+FFFD —
  // тогда имя и правда было в latin-1, оставляем как пришло.
  return restored.includes("�") ? name : restored;
}

const UNSAFE_IN_FILENAME = new RegExp("[\\u0000-\\u001f\\u007f\"\\\\]", "g");

/** Оставляем только базовое имя. Оно попадёт в Content-Disposition
 *  и на экран, поэтому убираем пути, кавычки и управляющие символы. */
function sanitizeName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "файл";
  return base.replace(UNSAFE_IN_FILENAME, "").trim().slice(0, 120) || "файл";
}
