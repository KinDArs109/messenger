// Проверка голосовых сообщений — от записи до полоски в ленте.
//
//   npm run check:voice-message -w @messenger/desktop -- --pass=…
//
// Запись настоящая: браузерный MediaRecorder пишет звук, который мы
// сами и сгенерировали — тон в звуковом движке вместо микрофона.
// Микрофона на машине проверки может не быть вовсе, а путь важно
// проверить тот же самый: запись → загрузка → сообщение → полоска
// у собеседника.

const { app, BrowserWindow, session } = require("electron");

app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.on("window-all-closed", () => undefined);

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const SITE = arg("site") ?? "https://45.130.42.77.sslip.io";
const PASS = arg("pass");

const результаты = [];
const ok = (пункт, значение, ещё) => {
  результаты.push(Boolean(значение));
  console.log(`${значение ? "  ✔" : "  ✘ ПРОВАЛ"} ${пункт}${ещё ? " " + JSON.stringify(ещё) : ""}`);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function окно(who, partition, x) {
  const ses = session.fromPartition(partition);
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(permission === "media" || permission === "audioCapture"),
  );

  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    x,
    y: 40,
    show: true,
    webPreferences: { session: ses, backgroundThrottling: false },
  });

  await win.loadURL(`${SITE}/?app`);
  await win.webContents.executeJavaScript(`
    fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include", body: JSON.stringify({ login: ${JSON.stringify(who)}, password: ${JSON.stringify(PASS)} }) })
      .then((r) => r.json()).then((d) => Boolean(d.accessToken))
  `);
  await win.loadURL(`${SITE}/?app`);
  await wait(3000);
  return win;
}

void app.whenReady().then(async () => {
  console.log("\n=== Голосовое сообщение ===");

  const один = await окно("call-check-a", "persist:voice-a", 20);
  const два = await окно("call-check-b", "persist:voice-b", 640);

  // Оба открывают переписку: получатель должен смотреть в канал,
  // иначе полоску негде будет искать.
  for (const win of [два, один]) {
    await win.webContents.executeJavaScript(`
      (() => {
        const b = [...document.querySelectorAll("button")]
          .find((n) => n.textContent.includes("Проверка"));
        b?.click();
        return Boolean(b);
      })()
    `);
    await wait(1200);
  }

  // Записываем три секунды — тем же MediaRecorder, что и в мессенджере.
  // Звук берём не с микрофона, а из звукового движка: микрофона
  // на машине проверки может не быть, а проверять надо путь, а не
  // железо.
  const записано = await один.webContents.executeJavaScript(
    `(async () => {
      const ctx = new AudioContext();
      const tone = ctx.createOscillator();
      tone.frequency.value = 220;
      const out = ctx.createMediaStreamDestination();
      tone.connect(out);
      tone.start();

      const media = new MediaRecorder(out.stream);
      const chunks = [];
      media.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      media.start(200);
      await new Promise((r) => setTimeout(r, 3000));
      await new Promise((r) => { media.onstop = r; media.stop(); });
      tone.stop();
      void ctx.close();

      const blob = new Blob(chunks, { type: media.mimeType });
      const body = new FormData();
      body.append("duration", "3");
      body.append("file", blob, "voice.weba");

      const token = await fetch("/api/auth/refresh", { method: "POST" })
        .then((r) => r.json()).then((d) => d.accessToken);

      const res = await fetch("/api/uploads/voice", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body,
      });
      const data = await res.json();
      if (!res.ok) return JSON.stringify({ ok: false, ответ: data });

      // Отправляем сообщение с этой записью — как это делает поле ввода.
      const channelId = [...document.querySelectorAll("textarea")].length
        ? (window.location.pathname, null) : null;
      return JSON.stringify({ ok: true, вложение: data.attachment });
    })()`,
    true,
  );
  const з = JSON.parse(записано);
  ok("запись загрузилась", з.ok === true, з.ok ? { тип: з.вложение?.mimeType } : з);
  ok("сервер узнал в ней звук, а не видео", з.вложение?.mimeType?.startsWith("audio/") === true, {
    тип: з.вложение?.mimeType,
  });
  ok("длительность сохранилась", з.вложение?.duration === 3, { секунд: з.вложение?.duration });
  ok("файл не пустой", (з.вложение?.size ?? 0) > 1000, { байт: з.вложение?.size });

  // Сообщение с записью — обычным запросом, как это делает поле
  // ввода: идентификатор вложения известен только здесь.
  const сПолоской = await один.webContents.executeJavaScript(
    `(async () => {
      const token = await fetch("/api/auth/refresh", { method: "POST" })
        .then((r) => r.json()).then((d) => d.accessToken);
      const dms = await fetch("/api/dms", { headers: { Authorization: "Bearer " + token } })
        .then((r) => r.json());
      const channelId = dms.dms?.[0]?.id;
      const res = await fetch("/api/channels/" + channelId + "/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ content: "", attachmentIds: [${JSON.stringify(JSON.parse(записано).вложение?.id ?? "")}] }),
      });
      return res.ok ? "да" : "";
    })()`,
    true,
  );
  ok("сообщение с записью отправилось", сПолоской === "да");

  await wait(2500);

  const уСобеседника = await два.webContents.executeJavaScript(`
    (() => {
      const audio = document.querySelector("audio");
      const play = [...document.querySelectorAll("button")]
        .find((b) => b.getAttribute("aria-label") === "Играть голосовое сообщение");
      return JSON.stringify({
        проигрыватель: Boolean(audio),
        кнопка: Boolean(play),
        время: [...document.querySelectorAll("span")]
          .map((s) => s.textContent.trim())
          .filter((t) => /^\\d+:\\d\\d$/.test(t)),
      });
    })()
  `);
  const у = JSON.parse(уСобеседника);
  ok("у собеседника появилась полоска со звуком", у.проигрыватель && у.кнопка, у);
  ok("и написана длительность", у.время.includes("0:03"), { найдено: у.время });

  один.destroy();
  два.destroy();

  const провалов = результаты.filter((x) => !x).length;
  console.log(
    `\n${провалов === 0 ? "Всё сходится" : `Провалов: ${провалов}`} — проверок ${результаты.length}\n`,
  );
  app.exit(провалов === 0 ? 0 : 1);
});
