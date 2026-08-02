import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { Router } from "express";
import { notFound } from "../../lib/errors.js";
import { downloadPage } from "./page.js";

/**
 * Страница и файлы для скачивания.
 *
 * Без входа — иначе получается замкнутый круг: чтобы поставить
 * приложение, надо сначала в него войти. Файлы и так лежат по адресу,
 * который знают только приглашённые, а внутри — то же самое, что
 * открывается в браузере по этой же ссылке.
 */

const RELEASE = path.join(import.meta.dirname, "../../../../desktop/release");

const FILES: Record<string, { file: string; saveAs: string }> = {
  setup: { file: "Мессенджер-установка.exe", saveAs: "Messenger-Setup.exe" },
  portable: { file: "Мессенджер-portable.exe", saveAs: "Messenger-Portable.exe" },
};

/** Размер сборки. null — файла нет; страница тогда не показывает
 *  кнопку, вместо того чтобы вести на заведомую ошибку. */
function sizeOf(kind: string): number | null {
  const entry = FILES[kind];
  if (!entry) return null;
  const full = path.join(RELEASE, entry.file);
  return existsSync(full) ? statSync(full).size : null;
}

export const downloadRouter: Router = Router();

downloadRouter.get("/", (_req, res) => {
  res.type("html").send(downloadPage(sizeOf("setup"), sizeOf("portable")));
});

/** Два маршрута вместо одного с «?»: Express 5 больше не понимает
 *  необязательные параметры в пути — сервер просто не стартует. */
downloadRouter.get("/:kind", (req, res) => {
  const kind = String(req.params.kind);
  const entry = FILES[kind];
  if (!entry) throw notFound("Такой сборки нет");

  const full = path.join(RELEASE, entry.file);
  if (!existsSync(full)) {
    throw notFound("Установщик ещё не собран. Соберите: npm run dist -w @messenger/desktop");
  }

  res.setHeader("Content-Length", statSync(full).size);
  // Имя для сохранения — латиницей: кириллица в заголовке требует
  // отдельного кодирования, и не всякий браузер делает это одинаково.
  res.download(full, entry.saveAs);
});
