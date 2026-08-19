// Проверка моста между страницей и оболочкой.
//
//   npx electron scripts/test-bridge.cjs
//
// Мост — единственное, чем приложение отличается от сайта, и он же
// единственное место, где страница получает права, которых у сайта
// быть не должно. Поэтому проверяется не только «работает ли», но и
// «не достаётся ли чужому»: оболочка умеет открыть другой адрес,
// и на чужой странице window.messenger обязан отсутствовать.

const { app, BrowserWindow } = require("electron");
const path = require("node:path");

const OWN = process.env.CHECK_URL ?? "https://45.130.42.77.sslip.io";
// Несовпадение проверяем с другой стороны: страница наша, а мост
// настроен на чужой адрес. Кодовый путь тот же самый —
// location.origin !== ожидаемого, — но проверке не нужен второй
// работающий сервер, которого здесь взять негде.
const OTHER_ORIGIN = "https://example.com";

const say = (line) => process.stdout.write(`${line}\n`);
let failed = false;
const ok = (s) => say(`  ✔ ${s}`);
const fail = (s) => {
  say(`  ✘ ПРОВАЛ: ${s}`);
  failed = true;
};

const watchdog = setTimeout(() => {
  say("\n  ПРОВАЛ: не уложились в 40 секунд\n");
  app.exit(1);
}, 40_000);
watchdog.unref?.();

// Окна не разрушаем по ходу дела, а собираем и закрываем в конце:
// уничтожение окна ломает загрузку в следующем — тот же самый адрес,
// который только что открылся, отдаёт ERR_FAILED.
const opened = [];

/** Окно с мостом, настроенным на allowedOrigin, открытое на openUrl. */
async function probe(allowedOrigin, openUrl) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "..", "preload.cjs"),
      additionalArguments: [
        `--messenger-origin=${allowedOrigin}`,
        "--messenger-version=0.0.0-test",
      ],
    },
  });
  opened.push(win);
  try {
    await win.loadURL(openUrl);
  } catch (error) {
    return { loadFailed: String(error) };
  }
  const result = await win.webContents.executeJavaScript(`
    (() => {
      const m = window.messenger;
      if (!m) return { present: false };
      return {
        present: true,
        isApp: m.isApp,
        version: m.version,
        keys: Object.keys(m).sort(),
        windowKeys: Object.keys(m.window ?? {}).sort(),
        badgeDraws: (() => {
          try {
            // Рисование значка живёт в мосте, а не в клиенте: проверяем,
            // что оно вообще выполняется и не роняет страницу.
            m.setBadge(7);
            return true;
          } catch (error) {
            return String(error);
          }
        })(),
      };
    })()
  `);
  return result;
}

void app.whenReady().then(async () => {
  const own = await probe(OWN, OWN + "/health");
  if (!own.present) return finish("моста нет на своей же странице");
  ok("на своей странице мост есть");

  if (own.isApp !== true) fail("isApp не выставлен — клиент не отличит приложение от сайта");
  else ok("клиент видит, что он в приложении");

  if (own.version !== "0.0.0-test") fail(`версия не пробросилась: ${own.version}`);
  else ok("версия приложения доступна странице");

  const expected = [
    "getAutostart",
    "isApp",
    "notify",
    "onOpenChannel",
    "onPushToTalk",
    "onScreenPick",
    "screenPicked",
    "setAutostart",
    "setBadge",
    "setPushToTalk",
    "version",
    "window",
  ];
  const missing = expected.filter((key) => !own.keys.includes(key));
  if (missing.length > 0) fail(`в мосте нет: ${missing.join(", ")}`);
  else ok(`мост отдаёт всё нужное (${own.keys.length} пунктов)`);

  const windowExpected = ["hide", "isMaximized", "minimize", "onMaximizedChange", "toggleMaximize"];
  const windowMissing = windowExpected.filter((key) => !own.windowKeys.includes(key));
  if (windowMissing.length > 0) fail(`в управлении окном нет: ${windowMissing.join(", ")}`);
  else ok("управление окном на месте");

  if (own.badgeDraws !== true) fail(`значок непрочитанного не рисуется: ${own.badgeDraws}`);
  else ok("значок непрочитанного рисуется");

  // Главное: страница с чужого адреса прав не получает.
  const foreign = await probe(OTHER_ORIGIN, OWN + "/health");
  if (foreign.loadFailed) fail(`страница не открылась, проверка не состоялась: ${foreign.loadFailed}`);
  else if (foreign.present) fail("мост достался чужому адресу — так нельзя");
  else ok("при несовпадении адреса моста нет");

  // Пустая страница: origin вообще null, и на ней тоже ничего быть
  // не должно.
  const blank = await probe(OWN, "about:blank");
  if (blank.present) fail("мост достался пустой странице");
  else ok("на пустой странице моста нет");

  // И на всякий случай: без указанного адреса мост не появляется
  // вовсе, а не «разрешено всё».
  const unset = await probe("", OWN + "/health");
  if (unset.present) fail("без указанного адреса мост появился — это открытая дверь");
  else ok("без указанного адреса моста нет");

  finish();
});

function finish(error) {
  if (error) fail(error);
  for (const w of opened) w.destroy();
  say(failed ? "\n  Есть провалы\n" : "\n  Мост работает\n");
  app.exit(failed ? 1 : 0);
}
