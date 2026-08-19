// Выпуск новой версии оболочки.
//
//   npm run release -w @messenger/desktop
//
// Собирает установщик и кладёт его на сервер, откуда установленные
// приложения его и подхватывают.
//
// Раньше выпуск уезжал в релизы GitHub, а сайт с кнопкой «скачать»
// жил отдельно: два адреса, две вкладки, и на вопрос «откуда качать»
// два разных ответа. Теперь адрес один — тот же, по которому открывают
// сам мессенджер, — и скрипт целится туда же, куда electron-updater
// ходит за обновлениями.
//
// Порядок такой: сначала оба тяжёлых файла, и только когда они на
// месте — latest.yml. Он и есть объявление о выпуске: приложение
// читает его первым и по нему решает, что вышло новое. Приедь он
// раньше установщика — друзья полезли бы качать то, чего ещё нет.

import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;

const { url } = pkg.build.publish[0];
const host = new URL(url).host;

/** Куда класть. Тот же путь, из которого сервер раздаёт /updates
 *  и /download/setup, — он смотрит в release рядом с исходниками. */
const SSH = `root@${host.replace(/\.sslip\.io$/, "")}`;
const REMOTE = "/opt/messenger/apps/desktop/release";
const OWNER = "messenger:messenger";

/** Без этих трёх обновление не работает: latest.yml — объявление,
 *  blockmap — докачка изменившихся кусков вместо всех ста мегабайт. */
const HEAVY = ["Messenger-Setup.exe", "Messenger-Setup.exe.blockmap"];
const ANNOUNCE = "latest.yml";

const run = (cmd, args, options = {}) =>
  spawnSync(cmd, args, { cwd: root, encoding: "utf8", shell: true, ...options });

const die = (message) => {
  console.error(`\n  ${message}\n`);
  process.exit(1);
};

// Ту же версию выпускать нельзя: под одним номером у друзей окажутся
// разные файлы, у одних обновление встанет, у других нет, и разбираться
// будет невозможно.
const already = await fetch(`${url}/${ANNOUNCE}`)
  .then((r) => (r.ok ? r.text() : ""))
  .catch(() => "");
if (already.includes(`version: ${version}`)) {
  die(`Версия ${version} уже выложена. Поднимите номер в apps/desktop/package.json`);
}

console.log(`\n  Выпускаю ${version} на ${host}\n`);

// 1. Сборка. Без --publish: выкладываем сами, порядком, который
//    описан выше, — electron-builder такого порядка не даёт.
const build = run("npx", ["electron-builder", "--win", "--publish", "never"], { stdio: "inherit" });
if (build.status !== 0) die("Сборка не удалась");

const release = path.join(root, "release");
const local = (name) => path.join(release, name);

for (const name of [...HEAVY, ANNOUNCE]) {
  try {
    if (statSync(local(name)).size === 0) die(`Пустой файл после сборки: ${name}`);
  } catch {
    die(`Сборка не дала файла: ${name}`);
  }
}

// 2. Сначала тяжёлое, потом объявление.
for (const name of [...HEAVY, ANNOUNCE]) {
  const sent = run("scp", ["-q", `"${local(name)}"`, `${SSH}:${REMOTE}/${name}`]);
  if (sent.status !== 0) die(`Не удалось отправить ${name}:\n${sent.stderr || sent.stdout}`);
  console.log(`  отправлено: ${name}`);
}

// Файлы приезжают от root, а раздаёт их служба под своим пользователем.
const own = run("ssh", [SSH, `"chown ${OWNER} ${REMOTE}/*"`]);
if (own.status !== 0) die(`Не удалось выставить владельца:\n${own.stderr || own.stdout}`);

// 3. Проверка снаружи, а не по факту загрузки: важно не то, что файл
//    лёг на диск, а то, что приложение его получит.
const served = await fetch(`${url}/${ANNOUNCE}`).then((r) => (r.ok ? r.text() : ""));
if (!served.includes(`version: ${version}`)) {
  die(`Сервер отдаёт не ту версию:\n${served.slice(0, 200)}`);
}
for (const name of HEAVY) {
  const head = await fetch(`${url}/${name}`, { method: "HEAD" });
  const size = Number(head.headers.get("content-length") ?? 0);
  if (!head.ok || size !== statSync(local(name)).size) {
    die(`${name} отдаётся не полностью: ${head.status}, ${size} байт`);
  }
  console.log(`  проверено: ${name} — ${(size / 1e6).toFixed(1)} МБ`);
}

console.log(`\n  Готово. Обновление увидят при следующем запуске: ${url}\n`);
