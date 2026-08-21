// Что отдаёт сам захват экрана — до всякого сжатия и отправки.
//
//   npx electron scripts/check-capture.cjs
//
// Все прежние замеры были про кодировщик: ему подсовывали рисованную
// картинку и смотрели, что получится. Но у показа есть шаг раньше —
// сам захват. Если система отдаёт тридцать кадров вместо шестидесяти
// или уменьшает кадр по дороге, дальше уже ничего не спасёт: кодировщик
// не может отправить то, чего ему не дали.
//
// Здесь берётся настоящий экран этой машины и меряется, что именно
// из него выходит при тех настройках, которые ставит мессенджер.

const { app, BrowserWindow, desktopCapturer, session } = require("electron");

const скажи = (строка) => process.stdout.write(`${строка}\n`);

const сторож = setTimeout(() => {
  скажи("\n  ПРОВАЛ: не уложились в две минуты\n");
  app.exit(1);
}, 120_000);
сторож.unref?.();

void app.whenReady().then(async () => {
  // Окно нужно до опроса источников: без единого окна desktopCapturer
  // на Windows зависает молча и навсегда.
  const win = new BrowserWindow({
    show: false,
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadURL(`${process.env.CHECK_URL ?? "https://45.130.42.77.sslip.io"}/health`);

  const экраны = (await desktopCapturer.getSources({ types: ["screen"] })).filter((и) =>
    и.id.startsWith("screen:"),
  );
  if (экраны.length === 0) {
    скажи("\n  ПРОВАЛ: система не отдала ни одного экрана\n");
    app.exit(1);
    return;
  }

  session.defaultSession.setDisplayMediaRequestHandler((_запрос, ответ) => {
    ответ({ video: экраны[0], audio: "loopback" });
  });

  скажи("\nЧто отдаёт сам захват экрана\n");
  скажи(`  экран: ${экраны[0].name}\n`);

  const опыты = [
    { имя: "1080p, 60 к/с", height: 1080, fps: 60 },
    { имя: "1080p, 30 к/с", height: 1080, fps: 30 },
    { имя: "720p, 60 к/с", height: 720, fps: 60 },
    { имя: "как есть, 60 к/с", height: 0, fps: 60 },
  ];

  const строки = [];
  for (const опыт of опыты) {
    const итог = await win.webContents.executeJavaScript(
      `(async () => {
        const поток = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: ${опыт.fps}, max: ${опыт.fps} },
            ${опыт.height > 0 ? `height: { max: ${опыт.height} },` : ""}
          },
          audio: false,
        }).catch((б) => ({ ошибка: String(б.name) }));

        if (поток.ошибка) return { ошибка: поток.ошибка };

        const дорожка = поток.getVideoTracks()[0];
        дорожка.contentHint = "motion";
        const настройки = дорожка.getSettings();

        // Кадры считаем проигрывателем: он видит ровно то, что отдал
        // захват, без сети и без сжатия.
        const видео = document.createElement("video");
        видео.srcObject = поток;
        видео.muted = true;
        await видео.play().catch(() => undefined);
        await new Promise((r) => setTimeout(r, 1500));

        const до = видео.getVideoPlaybackQuality().totalVideoFrames;
        const началось = performance.now();
        await new Promise((r) => setTimeout(r, 6000));
        const после = видео.getVideoPlaybackQuality().totalVideoFrames;
        const секунд = (performance.now() - началось) / 1000;

        поток.getTracks().forEach((т) => т.stop());
        видео.srcObject = null;

        return {
          размер: (настройки.width ?? 0) + "×" + (настройки.height ?? 0),
          просили: настройки.frameRate ?? 0,
          вышло: Math.round((после - до) / секунд),
        };
      })()`,
      true,
    );

    строки.push([
      опыт.имя,
      итог.ошибка ? "—" : итог.размер,
      итог.ошибка ? "—" : `${Math.round(итог.просили)} к/с`,
      итог.ошибка ?? `${итог.вышло} к/с`,
    ]);
  }

  const шапка = ["настройка", "размер", "обещано", "на деле"];
  const ширины = шапка.map((_, i) =>
    Math.max(шапка[i].length, ...строки.map((с) => String(с[i]).length)),
  );
  const строка = (ячейки) => "  " + ячейки.map((я, i) => String(я).padEnd(ширины[i])).join("  ");

  скажи(строка(шапка));
  скажи("  " + ширины.map((ш) => "─".repeat(ш)).join("  "));
  for (const с of строки) скажи(строка(с));
  скажи("");

  app.exit(0);
});
