import { Router } from "express";
import multer from "multer";
import { LIMITS, type AttachmentDto } from "@messenger/shared";
import { prisma } from "../../db/client.js";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { uploadLimiter } from "../../middleware/rateLimit.js";
import { newId } from "../../lib/ids.js";
import { badRequest } from "../../lib/errors.js";
import { fileUrl, readImageSize, saveFile, sniffMimeType } from "../../lib/storage.js";

/** Файл держим в памяти, а не сразу на диске: пока не проверили
 *  содержимое, класть его в раздаваемую папку нельзя. Предел в 10 МБ
 *  делает это безопасным по памяти. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.uploadBytes, files: 1 },
});

export const uploadsRouter: Router = Router();
uploadsRouter.use(requireAuth);

uploadsRouter.post("/", uploadLimiter, upload.single("file"), async (req, res) => {
  const userId = currentUserId(req);
  const file = req.file;
  if (!file) throw badRequest("NO_FILE", "Файл не получен");
  if (file.size === 0) throw badRequest("EMPTY_FILE", "Файл пустой");

  // Тип берём из содержимого. То, что прислал браузер в Content-Type,
  // и расширение в имени — это данные пользователя, им веры нет.
  const mimeType = sniffMimeType(file.buffer);
  const dimensions = readImageSize(file.buffer, mimeType);
  const storageKey = await saveFile(file.buffer, mimeType);

  const attachment = await prisma.attachment.create({
    data: {
      id: newId(),
      uploaderId: userId,
      // Имя показываем пользовательское, но на диске оно не участвует.
      filename: sanitizeName(decodeOriginalName(file.originalname)),
      storageKey,
      size: file.size,
      mimeType,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
    },
  });

  const dto: AttachmentDto = {
    id: attachment.id,
    filename: attachment.filename,
    size: attachment.size,
    mimeType: attachment.mimeType,
    url: fileUrl(attachment.storageKey),
    width: attachment.width,
    height: attachment.height,
  };

  res.status(201).json({ attachment: dto });
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
