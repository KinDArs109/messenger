import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { Router } from "express";
import { notFound } from "../../lib/errors.js";

/**
 * Раздача установщика для рабочего стола.
 *
 * Без входа — иначе получается замкнутый круг: чтобы поставить
 * приложение, надо сначала в него войти. Файл и так лежит по адресу,
 * который знают только приглашённые, а внутри — то же самое, что
 * открывается в браузере по этой же ссылке.
 */

const RELEASE = path.join(import.meta.dirname, "../../../../desktop/release");

const FILES: Record<string, string> = {
  // Ключ — то, что в адресе; значение — имя файла на диске.
  // Кириллица в URL работает, но ломается при пересылке через
  // мессенджеры, поэтому адрес латиницей.
  setup: "Мессенджер-установка.exe",
  portable: "Мессенджер-portable.exe",
};

export const downloadRouter: Router = Router();

/** Два маршрута вместо одного с «?»: Express 5 больше не понимает
 *  необязательные параметры в пути — сервер просто не стартует. */
downloadRouter.get("/", (_req, res) => send("setup", res));
downloadRouter.get("/:kind", (req, res) => send(String(req.params.kind), res));

function send(kind: string, res: Parameters<Parameters<Router["get"]>[1]>[1]): void {
  const filename = FILES[kind];
  if (!filename) throw notFound("Такой сборки нет");

  const file = path.join(RELEASE, filename);
  if (!existsSync(file)) {
    throw notFound("Установщик ещё не собран. Соберите: npm run dist -w @messenger/desktop");
  }

  res.setHeader("Content-Length", statSync(file).size);
  // Имя для сохранения — латиницей: кириллица в заголовке требует
  // отдельного кодирования, и не всякий браузер делает это одинаково.
  res.download(file, kind === "setup" ? "Messenger-Setup.exe" : "Messenger-Portable.exe");
}
