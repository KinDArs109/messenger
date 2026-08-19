// Короткая проба: выдаёт ли ретранслятор адрес.
//
// Полная проба (turn-probe) строит соединение целиком и потому долгая.
// Здесь только первый шаг: браузер просит у ретранслятора адрес и
// показывает, что получилось. Если среди кандидатов появился relay —
// значит учётные данные приняты и адрес выдан.
//
// Настройки в переменной PROBE, ответ строкой в стандартный вывод.

const { app, BrowserWindow } = require("electron");

const options = JSON.parse(process.env.PROBE ?? "{}");

const done = (result) => {
  process.stdout.write(`\nПРОБА:${JSON.stringify(result)}\n`);
  app.exit(0);
};

setTimeout(() => done({ ok: false, error: "не уложились в 30 секунд" }), 30_000).unref?.();

void app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await win.loadURL(options.page);

  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const pc = new RTCPeerConnection({
        iceServers: ${JSON.stringify(options.iceServers)},
        iceTransportPolicy: "relay",
      });

      const кандидаты = [];
      const ошибки = [];
      pc.onicecandidate = (e) => {
        if (e.candidate) кандидаты.push(e.candidate.candidate);
      };
      pc.onicecandidateerror = (e) =>
        ошибки.push(e.errorCode + " " + e.errorText + " (" + e.url + ")");

      pc.createDataChannel("x");
      await pc.setLocalDescription();

      await new Promise((resolve) => {
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === "complete") resolve();
        };
        setTimeout(resolve, 20000);
      });

      pc.close();
      return {
        ok: кандидаты.some((c) => c.includes("typ relay")),
        всего: кандидаты.length,
        кандидаты: кандидаты.slice(0, 4),
        ошибки: ошибки.slice(0, 4),
      };
    })().catch((error) => ({ ok: false, error: String(error) }))
  `);

  done(result);
});
