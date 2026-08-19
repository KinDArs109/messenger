// Проверка того, чем приложение отличается от сайта.
//
//   npx electron scripts/test-app.cjs
//
// Запускает настоящее главное окно на настоящем адресе и проверяет,
// что различия на месте: своя шапка, трей, значок непрочитанного,
// уведомления, рация. Не подделка окружения — тот же main.cjs,
// который уезжает друзьям.

const { app, BrowserWindow, Tray, globalShortcut, nativeImage, Notification } = require("electron");
const path = require("node:path");

const say = (line) => process.stdout.write(`${line}\n`);
let failed = false;
const ok = (s) => say(`  ✔ ${s}`);
const fail = (s) => {
  say(`  ✘ ПРОВАЛ: ${s}`);
  failed = true;
};

const watchdog = setTimeout(() => {
  say("\n  ПРОВАЛ: не уложились в 60 секунд\n");
  app.exit(1);
}, 60_000);
watchdog.unref?.();

// main.cjs сам решает, что делать при готовности приложения, поэтому
// подключаем его и ждём, пока он создаст окно.
require("../main.cjs");

const waitFor = (check, ms = 30_000) =>
  new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const value = check();
      if (value) return resolve(value);
      if (Date.now() - started > ms) return resolve(null);
      setTimeout(tick, 200);
    };
    tick();
  });

void app.whenReady().then(async () => {
  const win = await waitFor(() => BrowserWindow.getAllWindows()[0]);
  if (!win) return finish("главное окно не появилось");
  ok("главное окно создано");

  // Своя шапка: системной полосы нет, но кнопки Windows остались.
  if (win.isVisible() === false && !process.argv.includes("--hidden")) {
    // Окно показывается по ready-to-show, подождём.
    await waitFor(() => win.isVisible(), 15_000);
  }

  const loaded = await waitFor(
    () => !win.webContents.isLoading() && win.webContents.getURL().startsWith("http"),
    30_000,
  );
  if (!loaded) return finish(`страница не загрузилась: ${win.webContents.getURL()}`);
  ok(`страница загружена: ${new URL(win.webContents.getURL()).origin}`);

  const bridge = await win.webContents.executeJavaScript(`
    (() => {
      const m = window.messenger;
      return m ? { present: true, isApp: m.isApp, version: m.version } : { present: false };
    })()
  `);
  if (!bridge.present) return finish("моста нет в настоящем окне приложения");
  ok(`мост на месте, версия ${bridge.version}`);

  // Своя рамка.
  const overlay = win.webContents.executeJavaScript(
    "typeof navigator.windowControlsOverlay !== 'undefined' && navigator.windowControlsOverlay.visible",
  );
  if (await overlay) ok("своя шапка включена, кнопки Windows поверх неё");
  else fail("windowControlsOverlay выключен — шапка не своя");

  // Трей. Своего значка main.cjs наружу не отдаёт, поэтому проверяем
  // то, от чего он зависит: что иконка на месте и что Windows вообще
  // принимает значок с ней. Пустая картинка дала бы пустое место
  // в трее — значок, который не найти.
  const icon = nativeImage.createFromPath(path.join(__dirname, "..", "build", "icon.ico"));
  if (icon.isEmpty()) {
    fail("иконка приложения не читается — значок в трее будет пустым");
  } else {
    const probe = new Tray(icon);
    if (probe.isDestroyed()) fail("Windows не принял значок в трее");
    else ok(`значок в трее создаётся (иконка ${icon.getSize().width}×${icon.getSize().height})`);
    probe.destroy();
  }

  // Значок непрочитанного: рисуется мостом и ставится главным процессом.
  await win.webContents.executeJavaScript("window.messenger.setBadge(3)");
  await new Promise((resolve) => setTimeout(resolve, 300));
  ok("значок непрочитанного поставлен без ошибок");

  // Уведомления.
  if (!Notification.isSupported()) fail("система не поддерживает уведомления");
  else ok("уведомления поддерживаются");

  // Рация: занимаем клавишу и отпускаем.
  const taken = await win.webContents.executeJavaScript(
    "window.messenger.setPushToTalk({ mode: 'hold', accelerator: 'F9' })",
  );
  if (!taken?.ok) fail(`клавишу занять не удалось: ${taken?.reason}`);
  else if (!globalShortcut.isRegistered("F9")) fail("клавиша числится занятой, но не занята");
  else ok("клавиша рации занимается");

  await win.webContents.executeJavaScript(
    "window.messenger.setPushToTalk({ mode: 'off', accelerator: null })",
  );
  if (globalShortcut.isRegistered("F9")) fail("клавиша осталась занятой после выключения рации");
  else ok("клавиша освобождается");

  // Автозапуск: читаем, не переключая — менять настройки системы
  // ради проверки нельзя.
  const autostart = await win.webContents.executeJavaScript("window.messenger.getAutostart()");
  ok(`автозапуск читается: ${autostart ? "включён" : "выключен"}`);

  // F5 и Ctrl+R не должны перезагружать окно.
  const урлДо = win.webContents.getURL();
  let перезагрузилось = false;
  win.webContents.once('did-start-loading', () => { перезагрузилось = true; });
  for (const key of ['F5', 'r']) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: key === 'r' ? ['control'] : [] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: key === 'r' ? ['control'] : [] });
  }
  await new Promise((r) => setTimeout(r, 1500));
  if (перезагрузилось || win.webContents.getURL() !== урлДо) fail('F5 или Ctrl+R всё ещё перезагружают окно');
  else ok('F5 и Ctrl+R перезагрузку не вызывают');

  // Окон должно остаться ровно одно: выбор источника рисует интерфейс,
  // а не отдельное окно системы.
  const окон = BrowserWindow.getAllWindows().length;
  if (окон !== 1) fail(`окон ${окон}, а должно быть одно`);
  else ok("лишних окон нет — выбор источника рисует сам интерфейс");

  finish();
});

function finish(error) {
  if (error) fail(error);
  say(failed ? "\n  Есть провалы\n" : "\n  Приложение отличается от сайта\n");
  app.exit(failed ? 1 : 0);
}
