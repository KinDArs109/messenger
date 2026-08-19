import path from "node:path";
import { Router } from "express";
import { prisma } from "../../db/client.js";
import { param } from "../../lib/params.js";
import { notFound } from "../../lib/errors.js";
import { UPLOADS_DIR, baseKeyOf, isInlineType } from "../../lib/storage.js";

/** Раздача загруженных файлов.
 *
 *  Токен сюда не передать: <img src> не умеет отправлять заголовок
 *  Authorization. Поэтому доступ — по неугадываемой ссылке: имя файла
 *  это ULID, перебрать его нельзя. Так устроены вложения и в Discord,
 *  и в Slack. Когда появятся приватные вложения, здесь встанет
 *  проверка прав по каналу сообщения.
 *
 *  Главное правило: всё, кроме картинок, отдаём как загрузку.
 *  Иначе присланный пользователем HTML исполнится в нашем домене
 *  и получит доступ к сессии того, кто по нему кликнул. */
export const uploadsServeRouter: Router = Router();

// Второй вариант — уменьшенная копия: тот же ключ с «.thumb».
// Отдельной записи в базе у неё нет, права проверяются по оригиналу.
const KEY_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}(\.thumb)?\.[a-z0-9]{2,5}$/;

uploadsServeRouter.get("/:key", async (req, res) => {
  const key = param(req, "key");
  // Проверяем форму ключа до обращения к диску: так `../` и прочие
  // попытки выйти из папки отсекаются на входе.
  if (!KEY_PATTERN.test(key)) throw notFound("Файл не найден");

  const isThumb = key.endsWith(".thumb.webp");
  const attachment = await prisma.attachment.findUnique({
    where: { storageKey: baseKeyOf(key) },
    select: { filename: true, mimeType: true },
  });
  if (!attachment) throw notFound("Файл не найден");

  const inline = isInlineType(attachment.mimeType);

  res.setHeader("Content-Type", attachment.mimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Даже для картинок запрещаем скрипты и фреймы внутри ответа.
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
  );

  res.sendFile(path.join(UPLOADS_DIR, key), (error) => {
    if (!error || res.headersSent) return;
    // Превью может не оказаться: файл загружен до того, как мы начали
    // их делать, или пережатие не удалось. Отдаём оригинал — картинка
    // на месте, просто тяжелее. Пустое место в ленте было бы хуже.
    if (isThumb) {
      res.sendFile(path.join(UPLOADS_DIR, baseKeyOf(key)), (second) => {
        if (second && !res.headersSent) res.status(404).end();
      });
      return;
    }
    res.status(404).end();
  });
});
