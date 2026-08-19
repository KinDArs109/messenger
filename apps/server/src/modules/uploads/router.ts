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
  saveFile,
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
