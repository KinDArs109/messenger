// Проверка гашения собственного звука в демонстрации экрана —
// на настоящем железе.
//
//   npx electron scripts/test-echo.cjs
//
// Из-за этого собеседник слышит сам себя: показ экрана берёт звук
// петлёй со всей системы, а в системе играет в том числе его голос
// из наших динамиков.
//
// Проверка идёт в два захода. Первый: работает ли встроенное в браузер
// ограничение restrictOwnAudio — просто ли попросить систему не брать
// наш звук. Второй: справляется ли наш собственный гаситель.
//
// Меряем честно: играем тон с паузами (ровный тон был бы поддавками —
// задержка ищется по изменениям громкости), захватываем систему
// и смотрим, сколько тона слышно в захвате до и после гашения.
//
// Во время проверки из динамиков будет тихо звучать тон — это она
// и есть, полминуты.

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, desktopCapturer, session } = require("electron");

const say = (line) => process.stdout.write(`${line}\n`);

const finish = (code, message) => {
  if (message) say(`\n  ${message}\n`);
  app.exit(code);
};

const watchdog = setTimeout(() => finish(1, "ПРОВАЛ: не уложились в 120 секунд"), 120_000);
watchdog.unref?.();

/** Частота пробного тона. 997 Гц — простое число герц: не совпадает
 *  ни с одной гармоникой сетевой наводки и не попадает ровно в центр
 *  спектрального окна, то есть не даст обманчиво чистого пика. */
const TONE_HZ = 997;

const PROCESSOR = fs.readFileSync(
  path.join(__dirname, "../../web/src/lib/echo-processor.js"),
  "utf8",
);

/**
 * Один замер.
 *
 * guard = false — просто смотрим, что слышно в захвате (и заодно
 * проверяем встроенное ограничение). guard = true — пропускаем
 * захват через наш гаситель и смотрим, что осталось.
 */
function measure(win, { restrict, guard, seconds }) {
  return win.webContents.executeJavaScript(`
    (async () => {
      const ctx = new AudioContext();

      // Что мы «играем в динамики»: тон с паузами, как речь.
      const osc = ctx.createOscillator();
      osc.frequency.value = ${TONE_HZ};
      const gate = ctx.createGain();
      const master = ctx.createGain();
      // Тихо: это не сирена, а замер. Для него хватает.
      master.gain.value = 0.05;
      osc.connect(gate).connect(master).connect(ctx.destination);

      // Паузы обязательны: по ним и находится задержка.
      gate.gain.value = 0;
      let at = ctx.currentTime + 0.2;
      for (let i = 0; i < 200; i++) {
        gate.gain.setValueAtTime(i % 2 === 0 ? 1 : 0, at);
        at += i % 2 === 0 ? 0.35 : 0.2;
      }
      osc.start();

      let stream = null;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { max: 5 } },
          audio: { restrictOwnAudio: ${restrict} },
        });
      } catch (error) {
        osc.stop();
        await ctx.close();
        return { ok: false, error: String(error) };
      }

      const track = stream.getAudioTracks()[0] ?? null;
      if (!track) {
        for (const t of stream.getTracks()) t.stop();
        osc.stop();
        await ctx.close();
        return { ok: false, error: "звуковой дорожки в захвате нет" };
      }

      const heard = ctx.createMediaStreamSource(new MediaStream([track]));

      let measured = heard;
      if (${guard}) {
        try {
          const url = URL.createObjectURL(
            new Blob([${JSON.stringify(PROCESSOR)}], { type: "text/javascript" }),
          );
          await ctx.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);
          const node = new AudioWorkletNode(ctx, "echo-canceller", {
            numberOfInputs: 2,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: "explicit",
            channelInterpretation: "speakers",
          });
          heard.connect(node, 0, 0);
          master.connect(node, 0, 1);
          measured = node;
          node.port.onmessage = (event) => { self.__report = event.data; };
        } catch (error) {
          for (const t of stream.getTracks()) t.stop();
          osc.stop();
          await ctx.close();
          return { ok: false, error: "гаситель не собрался: " + String(error) };
        }
      }

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 8192;
      analyser.smoothingTimeConstant = 0;
      measured.connect(analyser);
      // К динамикам ничего из захвата не подключаем: получилась бы
      // петля, и мерили бы мы собственный вой.

      const bins = new Float32Array(analyser.frequencyBinCount);
      const step = ctx.sampleRate / analyser.fftSize;
      const bin = Math.round(${TONE_HZ} / step);

      // Первые секунды уходят на поиск задержки и настройку — по ним
      // мерить значило бы мерить сходимость, а не результат.
      const измерять = performance.now() + ${seconds - 4} * 1000;
      const до = performance.now() + ${seconds} * 1000;
      let peak = -Infinity;
      let floor = -Infinity;

      while (performance.now() < до) {
        await new Promise((r) => setTimeout(r, 60));
        if (performance.now() < измерять) continue;
        analyser.getFloatFrequencyData(bins);
        const тон = Math.max(bins[bin - 1], bins[bin], bins[bin + 1]);
        if (тон > peak) peak = тон;
        const мимо = Math.max(bins[bin + 40], bins[bin + 60], bins[bin + 80]);
        if (мимо > floor) floor = мимо;
      }

      const report = self.__report ?? null;
      self.__report = null;
      for (const t of stream.getTracks()) t.stop();
      osc.stop();
      await ctx.close();

      return {
        ok: true,
        peak: Math.round(peak * 10) / 10,
        floor: Math.round(floor * 10) / 10,
        restrictOwnAudio: track.getSettings().restrictOwnAudio,
        report,
      };
    })()
  `);
}

void app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await win.loadURL(`${process.env.CHECK_URL ?? "https://45.130.42.77.sslip.io"}/health`);

  const supported = await win.webContents.executeJavaScript(
    "Boolean(navigator.mediaDevices.getSupportedConstraints().restrictOwnAudio)",
  );
  say(`  Chromium: ${process.versions.chrome}`);
  say(`  Ограничение restrictOwnAudio объявлено: ${supported}`);

  const screens = (await desktopCapturer.getSources({ types: ["screen"] })).filter((s) =>
    s.id.startsWith("screen:"),
  );
  if (screens.length === 0) return finish(1, "ПРОВАЛ: система не отдала ни одного экрана");

  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => callback({ video: screens[0], audio: "loopback" }),
    { useSystemPicker: false },
  );

  const сырой = await measure(win, { restrict: false, guard: false, seconds: 8 });
  say(`  Захват как есть:      ${JSON.stringify(сырой)}`);
  if (!сырой.ok) return finish(1, `ПРОВАЛ: захват не состоялся — ${сырой.error}`);

  const слышно = сырой.peak - сырой.floor;
  say(`  Свой тон над фоном: ${слышно.toFixed(1)} дБ`);
  if (слышно < 10) {
    return finish(
      1,
      "НЕОПРЕДЕЛЁННО: тона не слышно и в сыром захвате — вывод звука выключен или на нуле",
    );
  }

  const встроенное = await measure(win, { restrict: true, guard: false, seconds: 8 });
  say(`  С ограничением:       ${JSON.stringify(встроенное)}`);
  const отОграничения = сырой.peak - встроенное.peak;
  say(`  Встроенное ограничение убавило: ${отОграничения.toFixed(1)} дБ`);

  const сГасителем = await measure(win, { restrict: true, guard: true, seconds: 16 });
  say(`  С нашим гасителем:    ${JSON.stringify(сГасителем)}`);
  if (!сГасителем.ok) return finish(1, `ПРОВАЛ: гаситель не собрался — ${сГасителем.error}`);

  const выигрыш = сырой.peak - сГасителем.peak;
  say(`\n  Свой звук тише на ${выигрыш.toFixed(1)} дБ`);
  if (сГасителем.report) {
    say(`  Отчёт гасителя: задержка ${сГасителем.report.delayMs} мс, убрано ${сГасителем.report.gain} дБ`);
  }

  if (выигрыш >= 20) finish(0, "Свой звук из демонстрации убирается");
  else finish(1, `ПРОВАЛ: свой звук убавился всего на ${выигрыш.toFixed(1)} дБ`);
});
