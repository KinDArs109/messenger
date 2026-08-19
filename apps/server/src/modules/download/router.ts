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
const ANDROID = path.join(import.meta.dirname, "../../../../android");

/** Имена латиницей не для красоты: под ними же файлы лежат в релизе
 *  на GitHub, откуда приложение забирает обновления. Кириллицу GitHub
 *  в именах вложений заменяет точками, и автообновление перестало бы
 *  находить свой собственный установщик. */
const FILES: Record<string, { dir: string; file: string; saveAs: string }> = {
  setup: { dir: RELEASE, file: "Messenger-Setup.exe", saveAs: "Messenger-Setup.exe" },
  portable: { dir: RELEASE, file: "Messenger-Portable.exe", saveAs: "Messenger-Portable.exe" },
  // Имя, под которым apk собирается, — рабочее; человеку в «Загрузки»
  // должно упасть что-то узнаваемое.
  android: { dir: ANDROID, file: "app-release-signed.apk", saveAs: "Messenger.apk" },
};

/** Размер сборки. null — файла нет; страница тогда не показывает
 *  кнопку, вместо того чтобы вести на заведомую ошибку. */
function sizeOf(kind: string): number | null {
  const entry = FILES[kind];
  if (!entry) return null;
  const full = path.join(entry.dir, entry.file);
  return existsSync(full) ? statSync(full).size : null;
}

/** Та же страница, что и /download, но её показывают на корне тому,
 *  кто пришёл впервые. Отличается только заголовком вкладки: на корне
 *  это лицо сервиса, а по /download — именно страница скачивания.
 *
 *  Вынесена сюда, чтобы app.ts не знал ни про каталог сборок,
 *  ни про имена файлов. */
export function landingHtml(userAgent = ""): string {
  return downloadPage(
    { setup: sizeOf("setup"), portable: sizeOf("portable"), android: sizeOf("android") },
    deviceOf(userAgent),
    "Мессенджер для своих",
  );
}

/**
 * С чего пришли.
 *
 * Нужно ровно затем, чтобы не предлагать телефону установщик для
 * Windows, а компьютеру — apk. Разобрать это в стилях нельзя: ширина
 * окна и способ ввода говорят про экран, а не про систему, и на планшете
 * с Android они врут. Ошибка не страшна: не угадали — человек увидит
 * все кнопки, просто в другом порядке.
 */
function deviceOf(userAgent: string): "windows" | "android" | "ios" | "other" {
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Windows/i.test(userAgent)) return "windows";
  return "other";
}

export const downloadRouter: Router = Router();

/**
 * Страница скачивания живёт на корне, а не здесь.
 *
 * Раньше одна и та же страница открывалась по двум адресам — на корне
 * и по /download, — и получалось два лица у одного сервиса: непонятно,
 * какую ссылку давать друзьям, и обе выглядят одинаково. Главный адрес
 * должен быть один, и это корень: он короче, его проще продиктовать,
 * и он же превращается в сам мессенджер, когда человек вошёл.
 *
 * Старый адрес не убираем совсем — он мог остаться у кого-то
 * в переписке. Он просто ведёт на главный.
 */
downloadRouter.get("/", (_req, res) => {
  res.redirect(301, "/");
});

/** Два маршрута вместо одного с «?»: Express 5 больше не понимает
 *  необязательные параметры в пути — сервер просто не стартует. */
downloadRouter.get("/:kind", (req, res) => {
  const kind = String(req.params.kind);
  const entry = FILES[kind];
  if (!entry) throw notFound("Такой сборки нет");

  const full = path.join(entry.dir, entry.file);
  if (!existsSync(full)) {
    throw notFound(
      kind === "android"
        ? "Приложение для Android ещё не собрано. Соберите: bubblewrap build (apps/android)"
        : "Установщик ещё не собран. Соберите: npm run dist -w @messenger/desktop",
    );
  }

  res.setHeader("Content-Length", statSync(full).size);
  // Имя для сохранения — латиницей: кириллица в заголовке требует
  // отдельного кодирования, и не всякий браузер делает это одинаково.
  res.download(full, entry.saveAs);
});

/**
 * Файлы для автообновления.
 *
 * Раньше приложение искало обновления на GitHub, а установщик лежал
 * здесь — две площадки под одно и то же, и релиз надо было выкладывать
 * дважды. Теперь всё в одном месте: приложение спрашивает latest.yml
 * у того же сервера, с которого и работает.
 *
 * Имена строго из списка, а не из адреса: сюда приходит строка
 * от кого угодно, и подставлять её в путь к файлу нельзя ни при каких
 * обстоятельствах — это прямая дорога к чтению чужих файлов.
 *
 * Отдаём как есть, без Content-Disposition: обновлятору нужен файл,
 * а не предложение сохранить его в «Загрузки».
 */
const UPDATE_FILES = new Set([
  "latest.yml",
  "Messenger-Setup.exe",
  "Messenger-Setup.exe.blockmap",
]);

export const updatesRouter: Router = Router();

updatesRouter.get("/:name", (req, res) => {
  const name = String(req.params.name);
  if (!UPDATE_FILES.has(name)) throw notFound("Такого файла обновления нет");

  const full = path.join(RELEASE, name);
  if (!existsSync(full)) throw notFound("Обновление ещё не выложено");

  // latest.yml обязан быть свежим: закэшированный означает, что
  // приложение будет неделю уверено, будто новой версии нет.
  if (name === "latest.yml") res.setHeader("Cache-Control", "no-store");
  res.sendFile(full);
});
