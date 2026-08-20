// Проверка «играет в …» целиком: от запущенной программы до строчки
// в чужом списке друзей.
//
//   npm run fixture:call -w @messenger/server -- --setup
//   npx electron scripts/check-game.cjs --a=… --b=… --pass=… --out=…
//
// Зачем именно так. Про игру нельзя нажать кнопку — её замечает
// сама оболочка, поэтому «проверить руками» здесь означает запустить
// настоящую программу и посмотреть, что увидит друг на другом конце.
//
// Что здесь настоящее: список игр приходит от самого мессенджера
// (его собирает клиент и отдаёт оболочке), запущенное ищется тем же
// games.cjs, что и в приложении, имя игры превращает в человеческое
// тот же клиент, и через сервер оно доходит до второго окна, где
// его и читаем. Своего в этом файле — только цикл опроса на десяток
// строк, повторяющий main.cjs, и та часть, что заводит окна.
//
// Игрой работает переименованная копия системного Paint: настоящей
// Counter-Strike на этой машине нет, а проверяется здесь совпадение
// имени файла — для него важно только имя.
//
// Вход делается запросом, а не набором пароля в форме: в поля
// с паролями я не печатаю даже во временных учётных записях.

const { app, BrowserWindow, ipcMain, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { execFile, execFileSync, spawn } = require("node:child_process");
const { runningProcesses } = require("../games.cjs");
const { войтиВСтранице, войтиСнаружи } = require("./login.cjs");

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const SITE = arg("site") ?? "https://45.130.42.77.sslip.io";
const OUT = arg("out") ?? ".";
const A = arg("a");
const B = arg("b");
const PASS = arg("pass");

/** Имя файла берём из встроенного списка — проверяем именно его.
 *  Название рядом — то, что список обещает показать людям. */
const GAME_EXE = "cs2.exe";
const GAME_NAME = "Counter-Strike 2";

/** Тот же шаг, что у приложения во время разговора. Быстрее было бы
 *  удобнее, но тогда проверка мерила бы не то, что работает у людей. */
const GAME_CHECK_MS = 5000;

/** Ход проверки пишем в файл, а не только в консоль: у оконного
 *  приложения на Windows вывод копится и показывается разом в конце,
 *  а смотреть на него хочется по дороге. */
const LOG = path.join(OUT, "ход-проверки.txt");
fs.writeFileSync(LOG, "", "utf8");
const say = (line) => {
  console.log(line);
  try {
    fs.appendFileSync(LOG, `${line}\n`, "utf8");
  } catch {
    // Каталог мог не пережить уборку — не повод ронять проверку.
  }
};

const results = [];
const ok = (пункт, значение, ещё) => {
  results.push({ пункт, ок: Boolean(значение) });
  say(`${значение ? "  ✔" : "  ✘ ПРОВАЛ"} ${пункт}${ещё ? " " + JSON.stringify(ещё) : ""}`);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Обрубить ожидание, если оно затянулось. Снимок окна на спящем
 *  экране умеет висеть десятками секунд, и из-за него проверка,
 *  которая идёт три минуты, шла двенадцать. */
const atMost = (promise, ms, whenLate = null) =>
  Promise.race([promise, wait(ms).then(() => whenLate)]);

/* ── Оболочка ───────────────────────────────────────────────────────
 *
 * Мост preload требует, чтобы главный процесс отвечал на его вопросы,
 * иначе страница спотыкается на первом же обращении. Отвечаем тем же,
 * чем ответило бы приложение, — кроме игр, ради которых всё и затеяно.
 */

/** Список игр приезжает от мессенджера: он его и собирает. */
let wanted = [];
let listSeen = null;
let currentGame = null;
let first = null;

function stubs() {
  ipcMain.on("overlay:set", (_event, data) => {
    if (Array.isArray(data?.games)) {
      wanted = data.games;
      listSeen = listSeen ?? [...data.games];
    }
  });
  ipcMain.handle("game:current", () => currentGame);
  ipcMain.handle("apps:list", () => []);
  ipcMain.handle("autostart:get", () => false);
  ipcMain.handle("autostart:set", () => false);
  ipcMain.handle("window:is-maximized", () => false);
  ipcMain.handle("ptt:set", () => true);
  for (const channel of [
    "badge:set",
    "notify",
    "window:minimize",
    "window:hide",
    "window:toggle-maximize",
    "screen:picked",
    "overlay:action",
  ]) {
    ipcMain.on(channel, () => undefined);
  }
}

/** Тот же цикл, что в main.cjs: посмотреть, что запущено, и сказать
 *  мессенджеру, если что-то изменилось. */
async function tick() {
  if (wanted.length === 0) return;
  const running = new Set((await runningProcesses()).map((row) => row.name.toLowerCase()));
  const found = wanted.find((name) => running.has(String(name).toLowerCase())) ?? null;
  if (found === currentGame) return;
  currentGame = found;
  say(`    оболочка: ${currentGame ?? "игры нет"}`);
  if (!first?.isDestroyed()) first.webContents.send("game:changed", currentGame);
}

/* ── Окна ───────────────────────────────────────────────────────── */

async function openFor(who, partition, x, withBridge) {
  const ses = session.fromPartition(partition);
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media" || permission === "audioCapture");
  });

  const win = new BrowserWindow({
    width: 1000,
    height: 760,
    x,
    y: 40,
    show: true,
    title: who,
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      // Окну «играющего» отдаём настоящий мост приложения — иначе
      // клиент решит, что он в браузере, и про игры даже не спросит.
      ...(withBridge
        ? {
            preload: path.join(__dirname, "..", "preload.cjs"),
            additionalArguments: [
              `--messenger-origin=${new URL(SITE).origin}`,
              "--messenger-version=проверка",
            ],
          }
        : {}),
    },
  });

  await win.loadURL(`${SITE}/?app`);

  const logged = await win.webContents.executeJavaScript(войтиВСтранице(who, PASS));
  if (!logged) throw new Error(`не удалось войти как ${who}`);

  await win.loadURL(`${SITE}/?app`);
  await wait(2500);
  return win;
}

/** Отобрать у окна сеть и вернуть обратно.
 *
 *  Через отладчик самого Chromium: это тот же выключатель, которым
 *  пользуются в инструментах разработчика, и для страницы он выглядит
 *  как настоящий обрыв — с закрытым соединением и попытками
 *  переподключиться. */
async function offline(win, value) {
  const debug = win.webContents.debugger;
  if (!debug.isAttached()) debug.attach("1.3");
  await debug.sendCommand("Network.enable");
  await debug.sendCommand("Network.emulateNetworkConditions", {
    offline: value,
    latency: 0,
    downloadThroughput: value ? 0 : -1,
    uploadThroughput: value ? 0 : -1,
  });
  say(`    связь ${value ? "оборвана" : "восстановлена"}`);
}

async function waitFor(win, expression, timeoutMs = 20_000) {
  const till = Date.now() + timeoutMs;
  while (Date.now() < till) {
    const value = await win.webContents.executeJavaScript(expression).catch(() => null);
    if (value) return value;
    await wait(500);
  }
  return null;
}

/** Снимок окна.
 *
 *  Windows отдаёт содержимое окна не всегда: на спящем экране рисовать
 *  нечего, и попытка снять либо отказывает, либо висит. Поэтому ждём
 *  недолго и, получив отказ дважды, снимки больше не делаем: они здесь
 *  для человека, а доказывает проверку не картинка, а прочитанный
 *  со страницы текст. */
let noShots = 0;
async function shot(win, name) {
  if (noShots >= 2) return null;

  const file = path.join(OUT, `${name}.png`);
  const image = await atMost(
    win.webContents.capturePage().catch(() => null),
    4000,
  );
  if (!image) {
    noShots += 1;
    say(`    снимок «${name}» не получился`);
    return null;
  }

  fs.writeFileSync(file, image.toPNG());
  return file;
}

/* ── Игра ───────────────────────────────────────────────────────── */

const gamePath = path.join(OUT, GAME_EXE);
let gameProcess = null;

/**
 * Запустить «игру».
 *
 * Игрой работает копия node под именем игры: проверяется совпадение
 * имени файла, и для него важно только имя. Брать что-нибудь из
 * системных программ не вышло — вынесенные из System32, они теряют
 * свои ресурсы и молча не запускаются, а «Блокнот» в Windows 11
 * открывается через посредника и живёт не под тем именем, под которым
 * запущен. Копия node запускается откуда угодно и ничего не открывает
 * на экране.
 */
function startGame() {
  const node = (() => {
    try {
      return execFileSync("where", ["node"], { encoding: "utf8" }).split(/\r?\n/)[0].trim();
    } catch {
      return path.join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs", "node.exe");
    }
  })();

  fs.copyFileSync(node, gamePath);

  // Своё окружение, без наследства от Electron: тот держит в переменных
  // среды несколько своих, и запущенный с ними node ведёт себя иначе.
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("ELECTRON_") || name === "NODE_OPTIONS") delete env[name];
  }

  gameProcess = spawn(gamePath, ["-e", "setTimeout(function () {}, 600000)"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env,
  });
  // Молча не запуститься она не должна: без этого «игра не запущена»
  // выглядит как «мессенджер её не заметил», и чинишь не то.
  gameProcess.on("error", (error) => say(`    игра не запустилась: ${error.message}`));
  gameProcess.on("exit", (code) => say(`    игра закрылась сама, код ${code}`));
}

function stopGame() {
  return new Promise((resolve) => {
    execFile("taskkill", ["/f", "/im", GAME_EXE], { windowsHide: true }, () => resolve());
  });
}

/* ── Проверка ───────────────────────────────────────────────────── */

async function main() {
  say("оболочка готова");
  stubs();

  // Сторож на случай, если что-то залипло: висеть до вечера хуже,
  // чем честно сказать «не уложилась».
  setTimeout(
    () => {
      say("\nпроверка не уложилась в отведённое время");
      void stopGame().then(() => app.exit(3));
    },
    6 * 60_000,
  ).unref?.();

  say("\n=== Вход ===");
  first = await openFor(A, "persist:game-check-a", 20, true);
  const second = await openFor(B, "persist:game-check-b", 620, false);

  ok(
    "первый вошёл в приложении (мост есть)",
    await first.webContents.executeJavaScript(`Boolean(window.messenger?.onGame)`),
  );
  ok(
    "второй вошёл и видит друга",
    Boolean(await waitFor(second, `document.body.innerText.includes("Проверка Первый") || null`)),
  );

  say("\n=== Список игр ===");
  const till = Date.now() + 15_000;
  while (!listSeen && Date.now() < till) await wait(500);

  ok("мессенджер прислал оболочке список игр", Boolean(listSeen), { имён: listSeen?.length ?? 0 });
  ok("список узнаёт игры без настроек", (listSeen?.length ?? 0) >= 100, {
    имён: listSeen?.length ?? 0,
  });
  ok(
    "в списке есть то, что мы запустим",
    listSeen?.some((name) => name.toLowerCase() === GAME_EXE),
  );
  ok(
    "в списке есть и другие ходовые игры",
    ["rustclient.exe", "dota2.exe", "robloxplayerbeta.exe", "gta5.exe"].every((name) =>
      listSeen?.some((item) => item.toLowerCase() === name),
    ),
  );

  const own = await first.webContents.executeJavaScript(
    `JSON.parse(localStorage.getItem("messenger:prefs") ?? "{}").overlayGames?.length ?? 0`,
  );
  ok("своих игр в настройках не отмечено", own === 0, { отмечено: own });

  say("\n=== До игры ===");
  const before = await second.webContents.executeJavaScript(
    `document.body.innerText.includes("Играет в")`,
  );
  ok("у друга ничего про игру не написано", !before);
  await shot(second, "игра-1-до");

  say("\n=== Запускаем игру ===");
  startGame();
  const timer = setInterval(() => void tick(), GAME_CHECK_MS);
  void tick();

  const noticed = await (async () => {
    const till = Date.now() + 20_000;
    while (Date.now() < till) {
      if (currentGame) return true;
      await wait(500);
    }
    return false;
  })();
  ok("оболочка заметила запущенную игру", noticed, { что: currentGame });

  const shown = await waitFor(
    second,
    `document.body.innerText.includes(${JSON.stringify(`Играет в ${GAME_NAME}`)}) || null`,
  );
  ok(`у друга появилось «Играет в ${GAME_NAME}»`, Boolean(shown));
  const shotPlaying = await shot(second, "игра-2-играет");

  say("\n=== Обрыв связи ===");
  // Настоящий обрыв, а не перезагрузка страницы: у окна отбирается сеть.
  // Сервер держит «кто во что играет» в памяти и, посчитав человека
  // ушедшим, забывает — а оболочка рассказывает только про перемены,
  // и игра, которая как шла, так и идёт, раньше пропадала навсегда.
  await offline(first, true);
  const disappeared = await waitFor(
    second,
    `document.body.innerText.includes("Играет в") ? null : true`,
    20_000,
  );
  ok("пока связи нет, у друга игры не видно", Boolean(disappeared));

  await offline(first, false);
  const back = await waitFor(
    second,
    `document.body.innerText.includes(${JSON.stringify(`Играет в ${GAME_NAME}`)}) || null`,
    30_000,
  );
  ok("связь вернулась — игра вернулась", Boolean(back));
  const shotBack = await shot(second, "игра-3-после-обрыва");

  say("\n=== Перезагрузка страницы ===");
  // Второй способ всё забыть: обновить страницу. Здесь пустеет уже
  // память самого мессенджера, и остаётся спросить у оболочки.
  first.webContents.reload();
  const afterReload = await waitFor(
    second,
    `document.body.innerText.includes(${JSON.stringify(`Играет в ${GAME_NAME}`)}) || null`,
    30_000,
  );
  ok("после перезагрузки страницы игра на месте", Boolean(afterReload));

  say("\n=== Закрываем игру ===");
  await stopGame();
  const gone = await waitFor(
    second,
    `document.body.innerText.includes("Играет в") ? null : true`,
    25_000,
  );
  ok("у друга строчка про игру пропала", Boolean(gone));
  await shot(second, "игра-4-после");

  clearInterval(timer);

  const failed = results.filter((r) => !r.ок);
  say(
    `\n${failed.length === 0 ? "Всё сходится" : `Провалов: ${failed.length}`} — проверок ${results.length}\n`,
  );
  say(JSON.stringify({ снимки: [shotPlaying, shotBack] }, null, 1));

  first.destroy();
  second.destroy();
  return failed.length;
}

app.on("window-all-closed", () => undefined);

// Свой каталог данных: во-первых, чтобы проверка не лезла в данные
// установленного приложения, во-вторых, чтобы прерванный прогон
// не мешал следующему — Chromium оставляет после себя замки, и запуск
// поверх них умеет ждать вечно.
app.setPath("userData", path.join(OUT, "electron-data"));

say("запуск");

void app.whenReady().then(() =>
  main()
    .then(async (failed) => {
      await stopGame();
      try {
        fs.rmSync(gamePath, { force: true });
      } catch {
        // Файл ещё занят закрывающимся процессом — уберём при следующем
        // прогоне, каталог временный.
      }
      app.exit(failed === 0 ? 0 : 1);
    })
    .catch(async (error) => {
      console.error("проверка сорвалась:", error);
      await stopGame();
      app.exit(2);
    }),
);
