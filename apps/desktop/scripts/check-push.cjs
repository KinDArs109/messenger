// Проверка уведомлений при закрытом мессенджере — до конца, настоящим
// Chrome и настоящей службой доставки Google.
//
//   npm run fixture:call -w @messenger/server -- --setup   (на сервере)
//   npx electron scripts/check-push.cjs --a=… --b=… --pass=… --out=…
//
// Почему именно так. Проверить уведомления «у себя» нельзя ничем, кроме
// настоящего браузера: подписку выдаёт служба доставки Google, письмо
// идёт через её серверы, и будит она сам браузер. Electron, в котором
// написаны остальные проверки, этого не умеет — у него нет службы
// доставки, и подписка там не выдаётся вовсе.
//
// Поэтому здесь запускается настоящий Chrome с отдельным профилем,
// а управляем им по тому же протоколу отладки, которым пользуются
// инструменты разработчика. Все нажатия настоящие. Само окно Electron
// нужно только затем, что из него удобно говорить по WebSocket.
//
// Что проверяется по-настоящему: подписка через наш же переключатель
// в настройках, отправка письма нашим сервером, доставка через Google
// и показ уведомления нашим service worker при закрытом мессенджере.

const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { войтиВСтранице, войтиСнаружи } = require("./login.cjs");

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const SITE = arg("site") ?? "https://45.130.42.77.sslip.io";
const OUT = arg("out") ?? ".";
const A = arg("a");
const B = arg("b");
const PASS = arg("pass");
const PORT = 9333;
const CHROME =
  arg("chrome") ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const LOG = path.join(OUT, "ход-проверки-уведомлений.txt");
fs.writeFileSync(LOG, "", "utf8");
const say = (line) => {
  console.log(line);
  try {
    fs.appendFileSync(LOG, `${line}\n`, "utf8");
  } catch {
    // Каталог временный — не повод ронять проверку.
  }
};

const results = [];
const ok = (пункт, значение, ещё) => {
  results.push({ пункт, ок: Boolean(значение) });
  say(`${значение ? "  ✔" : "  ✘ ПРОВАЛ"} ${пункт}${ещё ? " " + JSON.stringify(ещё) : ""}`);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Управление настоящим Chrome ─────────────────────────────────
 *
 * Протокол отладки работает по WebSocket, а в главном процессе
 * Electron его нет. Зато он есть в любой странице — поэтому держим
 * пустое невидимое окно и разговариваем через него.
 */

let pilot = null;
let chrome = null;

async function startChrome() {
  const profile = path.join(OUT, "chrome-профиль");
  fs.rmSync(profile, { recursive: true, force: true });

  chrome = spawn(
    CHROME,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${PORT}`,
      // Без этого Chrome отклоняет подключение к протоколу со страницы:
      // защита от того, чтобы в отладчик не залез чужой сайт.
      "--remote-allow-origins=*",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-search-engine-choice-screen",
      "--window-size=1000,860",
      `${SITE}/?app=1`,
    ],
    { stdio: "ignore" },
  );

  // Ждём, пока отладчик ответит.
  const till = Date.now() + 30_000;
  while (Date.now() < till) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.url.includes("45.130"));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Ещё не поднялся.
    }
    await wait(500);
  }
  throw new Error("Chrome не отозвался на протоколе отладки");
}

/** Подключиться к странице и научить окно-пилот слать команды. */
async function connect(url) {
  pilot = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false } });
  await pilot.loadURL("about:blank");

  await pilot.webContents.executeJavaScript(войтиВСтранице(A, PASS));
  ok("вошли в Chrome", logged);

  await cdp("Page.enable").catch(() => undefined);
  await run(`location.replace("${SITE}/?app=1")`);
  await wait(4000);
  ok(
    "приложение открылось",
    Boolean(await until(`document.body.innerText.includes("Личные сообщения") || null`)),
  );

  say("\n=== Включаем уведомления в настройках ===");
  ok("открыли настройки", await clickSelector('button[aria-label="Настройки"]'));
  ok("нашли раздел «Уведомления»", await clickText("Уведомления", "button"));
  ok(
    "переключатель на месте",
    Boolean(await until(`document.querySelector('button[role="switch"]') ? "да" : null`, 5000)),
  );
  ok("нажали переключатель", await clickSelector('button[role="switch"]'));

  const subscribed = await until(
    `navigator.serviceWorker.ready
       .then((r) => r.pushManager.getSubscription())
       .then((s) => (s ? s.endpoint.slice(0, 40) : null))`,
    20_000,
  );
  ok("браузер подписался у службы доставки", Boolean(subscribed), { адрес: subscribed });

  await clickSelector('button[aria-label="Закрыть"]');

  say("\n=== Закрываем мессенджер ===");
  // Уходим со страницы совсем: именно этот случай и проверяем —
  // мессенджера нет, живого соединения нет, человек ничего не узнает
  // без уведомления.
  await run(`location.replace("about:blank")`);
  await wait(3000);

  say("\n=== Пишем ему, пока он закрыт ===");
  const sent = await sendAsB();
  ok("второй отправил сообщение", sent.ok, { сообщение: sent.text });

  say("\n=== Ждём уведомление ===");
  await wait(6000);
  await run(`location.replace("${SITE}/?app=1")`).catch(() => undefined);
  await wait(4000);

  const shown = await until(
    `navigator.serviceWorker.ready
       .then((r) => r.getNotifications())
       .then((list) => (list.length ? JSON.stringify(list.map((n) => ({ title: n.title, body: n.body }))) : null))`,
    30_000,
  );
  ok("уведомление пришло и показано", Boolean(shown), { показано: shown });

  if (shown) {
    const list = JSON.parse(shown);
    ok(
      "в уведомлении видно, от кого и что",
      list.some((n) => n.title.includes("Проверка Второй") && n.body.includes(sent.text)),
      { первое: list[0] },
    );
  }

  const failed = results.filter((r) => !r.ок);
  say(
    `\n${failed.length === 0 ? "Всё сходится" : `Провалов: ${failed.length}`} — проверок ${results.length}\n`,
  );
  return failed.length;
}

/** Второй пишет первому. Через обычный запрос: проверяем доставку
 *  уведомления, а не кнопку отправки — она проверена отдельно. */
async function sendAsB() {
  const text = `Проверка уведомления ${Math.round(Date.now() / 1000) % 100000}`;

  const accessToken = await войтиСнаружи(SITE, B, PASS);
  if (!accessToken) return { ok: false, text };

  const dms = await fetch(`${SITE}/api/dms`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).then((r) => r.json());
  const channel = (dms.dms ?? dms)[0];
  if (!channel?.id) return { ok: false, text };

  const sent = await fetch(`${SITE}/api/channels/${channel.id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ content: text, attachmentIds: [] }),
  });

  return { ok: sent.ok, text };
}

app.on("window-all-closed", () => undefined);
app.setPath("userData", path.join(OUT, "electron-data-push"));

void app.whenReady().then(() =>
  main()
    .then((failed) => {
      chrome?.kill();
      app.exit(failed === 0 ? 0 : 1);
    })
    .catch((error) => {
      say(`проверка сорвалась: ${error.message}`);
      chrome?.kill();
      app.exit(2);
    }),
);
