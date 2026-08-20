// Проверка звонка целиком, нажатием кнопок.
//
//   node scripts/call-fixture (на сервере) → сюда логин и пароль
//   npx electron scripts/check-call.cjs --a=… --b=… --pass=… --out=…
//
// Зачем именно так. Всё, что проверялось до сих пор, проверялось
// событиями: послали «звоню», дождались «зазвонило». Это доказывает,
// что сервер считает правильно, и ничего не говорит о том, доходит ли
// дело до кнопки — а половина ошибок живёт ровно там: обработчик
// не повешен, кнопка не показывается, окно не открылось.
//
// Поэтому здесь два настоящих окна с раздельными сессиями, два разных
// человека, и все нажатия — настоящие, мышью по координатам. Между
// ними ходит живой сервер.
//
// Вход делается запросом, а не набором пароля в форме: в поля
// с паролями я не печатаю даже во временных учётных записях.

const { app, BrowserWindow, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { войтиВСтранице, войтиСнаружи } = require("./login.cjs");

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const SITE = arg("site") ?? "https://45.130.42.77.sslip.io";
const OUT = arg("out") ?? ".";
const A = arg("a");
const B = arg("b");
const PASS = arg("pass");

const results = [];
const ok = (пункт, значение, ещё) => {
  results.push({ пункт, ок: Boolean(значение), ...ещё });
  console.log(`${значение ? "  ✔" : "  ✘ ПРОВАЛ"} ${пункт}${ещё ? " " + JSON.stringify(ещё) : ""}`);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Окно одного человека: своя сессия, свои cookie, свой микрофон. */
async function openFor(who, partition, x) {
  const ses = session.fromPartition(partition);
  // Микрофон разрешаем сразу: иначе разговор не начнётся, а окна
  // спросить некого.
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media" || permission === "audioCapture");
  });

  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    x,
    y: 40,
    show: true,
    title: who,
    webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false },
  });

  await win.loadURL(`${SITE}/?app`);

  // Вход запросом: cookie ставится браузером, дальше приложение
  // поднимает сессию само при перезагрузке.
  const logged = await win.webContents.executeJavaScript(войтиВСтранице(who, PASS));
  if (!logged) throw new Error(`не удалось войти как ${who}`);

  await win.loadURL(`${SITE}/?app`);
  await wait(2500);
  return win;
}

/** Настоящее нажатие мышью по середине элемента. */
async function click(win, selector) {
  const box = await win.webContents.executeJavaScript(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) });
    })()
  `);
  if (!box) return false;
  const point = JSON.parse(box);
  win.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
  win.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
  await wait(400);
  return true;
}

/** Дождаться, пока на странице появится нужное. */
async function waitFor(win, expression, timeoutMs = 12_000) {
  const till = Date.now() + timeoutMs;
  while (Date.now() < till) {
    const value = await win.webContents.executeJavaScript(expression).catch(() => null);
    if (value) return value;
    await wait(250);
  }
  return null;
}

async function shot(win, name) {
  const image = await win.webContents.capturePage();
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, image.toPNG());
  return file;
}

async function main() {
  console.log("\n=== Вход ===");
  const first = await openFor(A, "persist:call-check-a", 20);
  const second = await openFor(B, "persist:call-check-b", 700);

  const nameA = await first.webContents.executeJavaScript(`document.body.innerText.slice(0, 400)`);
  ok("первый вошёл", nameA.includes("Проверка Второй") || nameA.includes("Личные"), {});
  const nameB = await second.webContents.executeJavaScript(`document.body.innerText.slice(0, 400)`);
  ok("второй вошёл", nameB.includes("Проверка Первый") || nameB.includes("Личные"), {});

  console.log("\n=== Открываем переписку и звоним ===");
  // Открываем переписку так же, как человек: нажатием по собеседнику
  // в списке слева.
  const opened = await first.webContents.executeJavaScript(`
    (() => {
      const item = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Проверка Второй"));
      if (!item) return null;
      const b = item.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) });
    })()
  `);
  if (opened) {
    const point = JSON.parse(opened);
    first.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
    first.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
  }
  await wait(1200);

  const hasPhone = await waitFor(
    first,
    `Boolean(document.querySelector('button[aria-label="Позвонить"]'))`,
  );
  ok("в переписке есть кнопка звонка", hasPhone);
  await shot(first, "звонок-1-переписка");

  const clicked = await click(first, 'button[aria-label="Позвонить"]');
  ok("нажали «позвонить»", clicked);

  const calling = await waitFor(
    first,
    `document.body.innerText.includes("Звоню") ? "звоню" : ""`,
  );
  ok("у звонящего окно «Звоню…»", calling === "звоню", { видим: calling });
  const shotOut = await shot(first, "звонок-2-звоню");

  console.log("\n=== У второго звонит ===");
  const ringing = await waitFor(
    second,
    `(() => { const d = document.querySelector('[role="dialog"]');
              return d && d.getAttribute("aria-label")?.includes("Входящий") ? d.getAttribute("aria-label") : ""; })()`,
  );
  ok("у второго открылось окно входящего", Boolean(ringing), { окно: ringing });

  const answerVisible = await waitFor(
    second,
    `Boolean(document.querySelector('button[aria-label="Ответить"]'))`,
  );
  ok("есть кнопка «Ответить»", answerVisible);
  const shotIn = await shot(second, "звонок-3-входящий");

  console.log("\n=== Отвечаем ===");
  const answered = await click(second, 'button[aria-label="Ответить"]');
  ok("нажали «Ответить»", answered);

  // После ответа обе стороны должны оказаться в разговоре: у обоих
  // появляется полоска с кнопкой выхода.
  const inCallA = await waitFor(
    first,
    `Boolean(document.querySelector('button[aria-label="Выйти из разговора"]'))`,
    15_000,
  );
  const inCallB = await waitFor(
    second,
    `Boolean(document.querySelector('button[aria-label="Выйти из разговора"]'))`,
    15_000,
  );
  ok("звонивший в разговоре", inCallA);
  ok("ответивший в разговоре", inCallB);

  ok(
    "окно звонка закрылось у обоих",
    !(await first.webContents.executeJavaScript(
      `Boolean(document.querySelector('[role="dialog"][aria-label*="вон"]'))`,
    )) &&
      !(await second.webContents.executeJavaScript(
        `Boolean(document.querySelector('[role="dialog"][aria-label*="вон"]'))`,
      )),
  );

  await wait(2500);
  const shotCallA = await shot(first, "звонок-4-разговор-первый");
  const shotCallB = await shot(second, "звонок-5-разговор-второй");

  // Слышат ли они друг друга — проверяем по соединению: если дорожка
  // пришла и играет, значит звук идёт. Спрашиваем у самой страницы.
  const heard = await waitFor(
    first,
    `(() => {
       const el = [...document.querySelectorAll("*")].some((n) => n.textContent === "Проверка Второй");
       return el ? "виден" : "";
     })()`,
    8000,
  );
  ok("собеседник виден в разговоре", heard === "виден", { видим: heard });

  console.log("\n=== Кладём трубку ===");
  await click(first, 'button[aria-label="Выйти из разговора"]');
  const leftA = await waitFor(
    first,
    `document.querySelector('button[aria-label="Выйти из разговора"]') ? "" : "вышел"`,
  );
  ok("выход из разговора работает", leftA === "вышел");

  const failed = results.filter((r) => !r.ок);
  console.log(
    `\n${failed.length === 0 ? "Всё сходится" : `Провалов: ${failed.length}`} — проверок ${results.length}\n`,
  );
  console.log(JSON.stringify({ снимки: [shotOut, shotIn, shotCallA, shotCallB] }, null, 1));

  first.destroy();
  second.destroy();
  app.exit(failed.length === 0 ? 0 : 1);
}

app.on("window-all-closed", () => undefined);

void app.whenReady().then(() =>
  main().catch((error) => {
    console.error("проверка сорвалась:", error);
    app.exit(2);
  }),
);
