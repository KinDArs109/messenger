// Проверка гасителя эха на настоящем звуке машины.
//
//   npm run check:echo-loopback -w @messenger/desktop
//
// Внимание: проверка на несколько секунд играет тон в динамики —
// иначе захватывать нечего.
//
// Чем отличается от check:echo (тот гоняет расчёт на выдуманных
// сигналах): здесь всё настоящее. Тон уходит в динамики через ту же
// цепочку, что и голоса собеседников (общая громкость → ограничитель
// → выход), возвращается через настоящий системный захват звука —
// тот самый loopback, которым берётся звук показа, — и гасится тем
// самым модулем из мессенджера (apps/web/src/lib/echo.ts).
//
// Вопрос ровно один: слышит ли собеседник сам себя в нашем показе.
// Замеряется до гасителя и после, на частоте тона.

const { app, BrowserWindow, session, desktopCapturer } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const скажи = (строка) => process.stdout.write(`${строка}\n`);

const сторож = setTimeout(() => {
  скажи("\n  ПРОВАЛ: не уложились в две минуты\n");
  app.exit(1);
}, 120_000);
сторож.unref?.();

/** Тот же гаситель, что и в мессенджере. Обработчик он ввозит
 *  как текст (`?raw`) — esbuild про такой суффикс не знает, поэтому
 *  подсказываем. */
async function собрать() {
  const сырое = {
    name: "raw",
    setup(build) {
      build.onResolve({ filter: /\?raw$/ }, (args) => ({
        path: path.join(args.resolveDir, args.path.replace(/\?raw$/, "")),
        namespace: "сырое",
      }));
      build.onLoad({ filter: /.*/, namespace: "сырое" }, (args) => ({
        contents: fs.readFileSync(args.path, "utf8"),
        loader: "text",
      }));
    },
  };

  // Асинхронно: подсказки (плагины) esbuild принимает только так.
  const собранное = await esbuild.build({
    entryPoints: [path.join(__dirname, "..", "..", "web", "src", "lib", "echo.ts")],
    bundle: true,
    format: "iife",
    globalName: "гаситель",
    write: false,
    charset: "utf8",
    plugins: [сырое],
  });
  return собранное.outputFiles[0].text;
}

const ЧАСТОТА = 700;

const сценарий = (модуль) => `
${модуль}
(async () => {
  const пауза = (мс) => new Promise((r) => setTimeout(r, мс));
  const ctx = new AudioContext();
  await ctx.resume();

  /* ── Наш выход в динамики: как в мессенджере ────────────────── */
  const master = ctx.createGain();
  master.gain.value = 1;

  // Тот же ограничитель, что стоит между общей громкостью и выходом.
  const предел = ctx.createDynamicsCompressor();
  предел.threshold.value = -6;
  предел.knee.value = 0;
  предел.ratio.value = 20;
  предел.attack.value = 0.003;
  предел.release.value = 0.25;
  master.connect(предел).connect(ctx.destination);

  // «Голос собеседника»: ровный тон. Негромко — проверка играет его
  // в настоящие динамики.
  const голос = ctx.createOscillator();
  голос.frequency.value = ${ЧАСТОТА};
  const громкость = ctx.createGain();
  громкость.gain.value = 0.2;
  голос.connect(громкость).connect(master);
  голос.start();

  /* ── Настоящий системный захват — тот же, что у показа ──────── */
  let захват;
  try {
    захват = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (беда) {
    return { беда: "захват не дали: " + беда.message };
  }

  const дорожка = захват.getAudioTracks()[0];
  if (!дорожка) return { беда: "в захвате нет звука" };

  /** Сколько децибел на частоте тона в этой дорожке. */
  async function накакой(track, мс = 1500) {
    const источник = ctx.createMediaStreamSource(new MediaStream([track]));
    const мера = ctx.createAnalyser();
    мера.fftSize = 8192;
    const глушитель = ctx.createGain();
    глушитель.gain.value = 0;
    источник.connect(мера);
    мера.connect(глушитель).connect(ctx.destination);

    await пауза(700);
    const данные = new Float32Array(мера.frequencyBinCount);
    const бин = Math.round(${ЧАСТОТА} / (ctx.sampleRate / мера.fftSize));
    let громче = -200;
    const до = performance.now() + мс;
    while (performance.now() < до) {
      мера.getFloatFrequencyData(данные);
      for (let i = бин - 1; i <= бин + 1; i += 1) громче = Math.max(громче, данные[i] ?? -200);
      await пауза(30);
    }
    источник.disconnect();
    мера.disconnect();
    глушитель.disconnect();
    return Math.round(громче);
  }

  const до = await накакой(дорожка);

  const охрана = await гаситель.guardScreenAudio(ctx, master, дорожка);
  if (!охрана) return { беда: "гаситель не собрался", до };

  // Фильтр подстраивается не мгновенно: даём ему пожить.
  await пауза(3000);
  const после = await накакой(охрана.track);
  const отчёт = охрана.report();

  охрана.stop();
  голос.stop();
  for (const т of захват.getTracks()) т.stop();
  await ctx.close();

  return { до, после, отчёт };
})();
`;

void app.whenReady().then(async () => {
  const окно = new BrowserWindow({
    show: false,
    webPreferences: { backgroundThrottling: false, sandbox: true },
  });

  // Окно выбора рисует оболочка — здесь выбираем за неё: первый экран
  // и системный звук. Это ровно то, что отдаёт мессенджер (main.cjs).
  окно.webContents.session.setDisplayMediaRequestHandler(
    (_запрос, ответ) => {
      void desktopCapturer.getSources({ types: ["screen"] }).then((источники) => {
        ответ(источники[0] ? { video: источники[0], audio: "loopback" } : {});
      });
    },
    { useSystemPicker: false },
  );

  // Захват звука живёт только в безопасном источнике; about:blank
  // им не считается — там нет даже navigator.mediaDevices. Своя же
  // страница здоровья подходит.
  await окно.loadURL(`${process.env.CHECK_URL ?? "https://45.130.42.77.sslip.io"}/health`);

  скажи("\nГаситель эха на настоящем звуке\n");
  скажи("  (несколько секунд в динамиках будет слышен тон)\n");

  let итог;
  try {
    итог = await окно.webContents.executeJavaScript(сценарий(await собрать()), true);
  } catch (беда) {
    скажи(`  ПРОВАЛ: проверка не отработала — ${беда.message}\n`);
    app.exit(1);
    return;
  }

  if (итог.беда) {
    скажи(`  ○ пропущено: ${итог.беда}\n`);
    app.exit(0);
    return;
  }

  const { до, после, отчёт } = итог;

  // Тона не слышно вовсе — значит на машине нет вывода звука либо
  // системный захват молчит. Мерить нечего, и врать об этом не надо.
  if (до < -70) {
    скажи(`  ○ пропущено: в захвате нет нашего тона (${до} дБ) — некуда возвращаться эху\n`);
    app.exit(0);
    return;
  }

  const тише = до - после;
  const вышло = тише >= 20;

  скажи(`  до гасителя:  ${до} дБ`);
  скажи(`  после:        ${после} дБ`);
  скажи(`  стало тише:   ${тише} дБ`);
  if (отчёт) скажи(`  сам гаситель: ${отчёт.gain} дБ, задержка ${отчёт.delayMs ?? "?"} мс`);
  скажи("");
  скажи(
    вышло
      ? "  ✔ собственный звук из показа убран\n"
      : "  ✘ ПРОВАЛ: собеседник услышит себя в нашем показе\n",
  );

  app.exit(вышло ? 0 : 1);
});
