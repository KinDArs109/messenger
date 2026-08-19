// Подопытный для проверки ретранслятора. Сам по себе не запускается —
// его зовёт npm run check:turn (apps/server/scripts/check-turn.ts).
//
// Здесь настоящий движок WebRTC, тот же, что в браузере у друзей.
// Двум соединениям запрещено ходить напрямую (iceTransportPolicy:
// "relay"), поэтому связаться они могут только через наш ретранслятор.
// Если они связались и обменялись сообщением — ретранслятор работает.
//
// Настройки приходят в переменной PROBE, ответ уходит одной строкой
// в стандартный вывод.

const { app, BrowserWindow } = require("electron");

const options = JSON.parse(process.env.PROBE ?? "{}");

const done = (result) => {
  process.stdout.write(`\nПРОБА:${JSON.stringify(result)}\n`);
  app.exit(0);
};

const watchdog = setTimeout(() => done({ ok: false, error: "не уложились в 45 секунд" }), 45_000);
watchdog.unref?.();

void app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  // Не about:blank: он не считается безопасным контекстом, а вне его
  // часть возможностей браузера просто отсутствует.
  await win.loadURL(options.page);

  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const iceServers = ${JSON.stringify(options.iceServers)};
      const setup = { iceServers, iceTransportPolicy: "relay" };

      const first = new RTCPeerConnection(setup);
      const second = new RTCPeerConnection(setup);

      // Кандидатов передаём друг другу напрямую — сигнализация здесь
      // не проверяется, она и так работает.
      first.onicecandidate = (e) => e.candidate && second.addIceCandidate(e.candidate);
      second.onicecandidate = (e) => e.candidate && first.addIceCandidate(e.candidate);

      const ошибки = [];
      first.onicecandidateerror = (e) => ошибки.push(e.errorCode + " " + e.errorText);
      second.onicecandidateerror = (e) => ошибки.push(e.errorCode + " " + e.errorText);

      const канал = first.createDataChannel("проба");
      // Ждём именно открытия канала, а не «соединение установлено»:
      // соединение считается готовым чуть раньше, чем канал по нему,
      // и отправка в этот промежуток падает.
      const открыт = new Promise((resolve) => {
        канал.onopen = () => resolve(true);
        setTimeout(() => resolve(канал.readyState === "open"), 25000);
      });
      const принято = new Promise((resolve) => {
        second.ondatachannel = (e) => {
          e.channel.onmessage = (m) => resolve(m.data);
        };
      });

      await first.setLocalDescription();
      await second.setRemoteDescription(first.localDescription);
      await second.setLocalDescription();
      await first.setRemoteDescription(second.localDescription);

      const связались = await new Promise((resolve) => {
        const проверить = () => {
          if (first.connectionState === "connected") resolve(true);
          if (first.connectionState === "failed") resolve(false);
        };
        first.onconnectionstatechange = проверить;
        setTimeout(() => resolve(first.connectionState === "connected"), 25000);
        проверить();
      });

      let сообщение = null;
      if (связались && (await открыт)) {
        канал.send("проверка ретранслятора");
        сообщение = await Promise.race([
          принято,
          new Promise((r) => setTimeout(() => r(null), 5000)),
        ]);
      }

      // Через что именно пошёл трафик. Ради этой строки всё и затевалось:
      // «relay» означает, что путь лёг через наш ретранслятор.
      let пара = null;
      const stats = await first.getStats();
      const все = new Map();
      stats.forEach((r) => все.set(r.id, r));
      stats.forEach((r) => {
        if (r.type === "candidate-pair" && r.state === "succeeded" && r.nominated) {
          пара = {
            свой: все.get(r.localCandidateId)?.candidateType ?? null,
            чужой: все.get(r.remoteCandidateId)?.candidateType ?? null,
            байт: r.bytesSent,
          };
        }
      });

      first.close();
      second.close();

      return {
        ok: связались && сообщение !== null,
        связались,
        сообщение,
        пара,
        ошибки: ошибки.slice(0, 4),
      };
    })().catch((error) => ({ ok: false, error: String(error) }))
  `);

  done(result);
});
