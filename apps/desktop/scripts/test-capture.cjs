// Проверка показа экрана в оболочке.
//
//   npx electron scripts/test-capture.cjs
//
// В браузере окно «что показать» рисует сам браузер, в Electron его
// нет: без обработчика getDisplayMedia молча не срабатывает. Скрипт
// проверяет обе половины — что система вообще отдаёт список
// источников и что запрос доходит до обработчика и возвращает поток.
//
// Окно создаётся до опроса источников намеренно: без единого окна
// desktopCapturer.getSources на Windows зависает молча и навсегда.

const { app, BrowserWindow, desktopCapturer, session } = require("electron");

const say = (line) => process.stdout.write(`${line}\n`);

const finish = (code, message) => {
  if (message) say(`\n  ${message}\n`);
  app.exit(code);
};

// Сторож: любая из проверок ниже может не ответить вовсе, и молчаливо
// висящий процесс хуже честного провала.
const watchdog = setTimeout(() => finish(1, "ПРОВАЛ: не уложились в 40 секунд"), 40_000);
watchdog.unref?.();

void app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  // Не data: и не about:blank — они не считаются безопасным контекстом,
  // а вне его navigator.mediaDevices не существует вовсе, и проверка
  // падала бы на ровном месте. localhost безопасным считается.
  await win.loadURL(`${process.env.CHECK_URL ?? "https://45.130.42.77.sslip.io"}/health`);
  say("  Окно создано");

  const bare = await desktopCapturer.getSources({ types: ["screen", "window"] });
  const screens = bare.filter((s) => s.id.startsWith("screen:"));
  say(`  Источников: экранов ${screens.length}, окон ${bare.length - screens.length}`);
  if (screens.length === 0) return finish(1, "ПРОВАЛ: система не отдала ни одного экрана");

  const withThumbs = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 320, height: 180 },
  });
  const empty = withThumbs.filter((s) => s.thumbnail.isEmpty()).length;
  say(`  Миниатюры: ${withThumbs.length - empty} из ${withThumbs.length} с картинкой`);

  let asked = false;
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      asked = true;
      callback({ video: screens[0], audio: "loopback" });
    },
    { useSystemPicker: false },
  );

  const result = await win.webContents.executeJavaScript(`
    !navigator.mediaDevices ? Promise.resolve({ ok: false, error: "нет mediaDevices" }) :
    navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 30 } },
      audio: true,
    }).then((stream) => {
      const settings = stream.getVideoTracks()[0].getSettings();
      const out = {
        ok: true,
        streamId: stream.id,
        video: stream.getVideoTracks().length,
        audio: stream.getAudioTracks().length,
        frameRate: settings.frameRate,
        size: settings.width + "x" + settings.height,
      };
      for (const track of stream.getTracks()) track.stop();
      return out;
    }).catch((error) => ({ ok: false, error: String(error) }))
  `);

  say(`  Обработчик вызван: ${asked}`);
  say(`  Поток: ${JSON.stringify(result)}`);

  if (!asked || !result.ok || result.video !== 1) {
    return finish(1, "ПРОВАЛ: захват экрана не состоялся");
  }
  if (result.frameRate > 30) {
    return finish(1, `ПРОВАЛ: кадров ${result.frameRate}, а просили не больше 30`);
  }
  finish(0, "Захват экрана работает");
});
