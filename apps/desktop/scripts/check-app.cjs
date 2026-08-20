// Полная проверка мессенджера — весь путь человека, нажатием кнопок.
//
//   npm run check:app -w @messenger/desktop -- --a=… --b=… --pass=…
//
// Здесь нет ни одного вызова внутренностей приложения: только два
// настоящих окна с раздельными сессиями, настоящие нажатия мышью
// по координатам и настоящий набор текста с клавиатуры. Между окнами
// живой сервер.
//
// Так ловится то, чего не видят ни типы, ни серверные проверки:
// кнопка не показалась, обработчик не повесился, окно не открылось,
// событие ушло в пустоту. Ровно на такой ошибке этот способ уже
// поймал звонки — сервер считал верно, а до человека не доходило.
//
// Вход делается запросом, а не набором пароля в форме: в поля
// с паролями я не печатаю даже во временных учётных записях.

const { app, BrowserWindow, desktopCapturer, powerSaveBlocker, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

/*
 * Windows считает окно, закрытое другим окном, невидимым и перестаёт
 * его рисовать: анимации замирают на первом кадре, выезжающие панели
 * остаются схлопнутыми — а нажатия в них уходят мимо, потому что
 * кнопки лежат за краем невидимой полосы. Проверка при этом «находит»
 * десяток поломок, которых нет.
 *
 * Окон у нас два, и они заведомо перекрывают друг друга: экран один.
 * Поэтому расчёт перекрытия выключаем целиком — рисовать надо оба.
 */
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const SITE = arg("site") ?? "https://45.130.42.77.sslip.io";
const OUT = arg("out") ?? ".";
const A = arg("a");
const B = arg("b");
const PASS = arg("pass");

const results = [];
const shots = [];

function ok(пункт, значение, ещё) {
  results.push({ пункт, ок: Boolean(значение), ...ещё });
  console.log(`${значение ? "  ✔" : "  ✘ ПРОВАЛ"} ${пункт}${ещё ? " " + JSON.stringify(ещё) : ""}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Окна ──────────────────────────────────────────────────────── */

async function openFor(who, partition, x) {
  const ses = session.fromPartition(partition);
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(permission === "media" || permission === "audioCapture"),
  );

  // Показ экрана здесь идёт без окна выбора: окно рисует оболочка,
  // а нажимать в него некому. Берём первый экран — что на нём
  // нарисовано, проверке неважно: важно, что до второго доезжают
  // настоящие кадры по настоящему соединению.
  ses.setDisplayMediaRequestHandler(
    (_request, callback) => {
      void desktopCapturer
        .getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => callback(sources[0] ? { video: sources[0] } : {}))
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );

  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    x,
    y: 30,
    show: true,
    title: who,
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      // Окна проверки перекрывают друг друга, а Chromium невидимому
      // окну замедляет всё: таймеры, перерисовку, ответ на изменение
      // размера. Проверка от этого «находила» то, чего нет, — например,
      // широкую раскладку в узком окне. В самом приложении это давно
      // выключено по той же причине.
      backgroundThrottling: false,
    },
  });

  await win.loadURL(`${SITE}/?app`);
  const logged = await win.webContents.executeJavaScript(`
    fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ login: ${JSON.stringify(who)}, password: ${JSON.stringify(PASS)} }),
    }).then((r) => r.json()).then((d) => Boolean(d.accessToken))
  `);
  if (!logged) throw new Error(`не удалось войти как ${who}`);

  await win.loadURL(`${SITE}/?app`);
  await wait(2600);
  return win;
}

/* ── Действия человека ─────────────────────────────────────────── */

/** Где находится элемент. null — его нет на странице. */
async function box(win, selector) {
  const raw = await win.webContents.executeJavaScript(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return null;
      return JSON.stringify({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) });
    })()
  `);
  return raw ? JSON.parse(raw) : null;
}

/** То же, но по видимому тексту: человек ищет кнопку глазами,
 *  а не по внутренним признакам разметки. */
async function boxByText(win, text, tag = "button") {
  const raw = await win.webContents.executeJavaScript(`
    (() => {
      const el = [...document.querySelectorAll(${JSON.stringify(tag)})]
        .find((n) => n.textContent.trim().includes(${JSON.stringify(text)}));
      if (!el) return null;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return null;
      return JSON.stringify({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) });
    })()
  `);
  return raw ? JSON.parse(raw) : null;
}

async function clickAt(win, point) {
  if (!point) return false;
  win.webContents.sendInputEvent({ type: "mouseMove", ...point });
  await wait(60);
  win.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
  win.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
  await wait(450);
  return true;
}

const click = async (win, selector) => clickAt(win, await box(win, selector));
const clickText = async (win, text, tag) => clickAt(win, await boxByText(win, text, tag));

/** Набор с клавиатуры — по букве, как человек. */
async function type(win, text) {
  for (const ch of text) {
    win.webContents.sendInputEvent({ type: "char", keyCode: ch });
    await wait(25);
  }
  await wait(200);
}

/** Выделить всё в поле — как Ctrl+A руками.
 *
 *  Понадобилось не сразу: поле имени сервера заранее заполнено
 *  предложенным названием, и набор поверх него вставлял новое имя
 *  в середину старого. Получался сервер с именем-кашей — и проверка
 *  потом не находила его по имени. */
async function selectAll(win) {
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "a", modifiers: ["control"] });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "a", modifiers: ["control"] });
  await wait(150);
}

async function press(win, key) {
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: key });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: key });
  await wait(500);
}

/** Источник показа — холст вместо рабочего стола.
 *
 *  Настоящий захват требует живого экрана. На машине с погашенным
 *  или спящим экраном Windows не отдаёт поверхность вовсе: запрос
 *  на показ повисает навсегда и уносит с собой весь прогон — так
 *  и случилось в первый раз. Ждать, пока кто-нибудь подойдёт
 *  и подвигает мышью, проверка не должна.
 *
 *  Подменён только источник кадров. Кнопка нажимается настоящая,
 *  дорожка настоящая, и к собеседнику она едет тем же путём, что
 *  и рабочий стол, — проверяется ровно то, что нужно проверить:
 *  доходит ли показ и что делает красная кнопка у смотрящего. */
async function fakeScreen(win) {
  await win.webContents.executeJavaScript(`
    (() => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext("2d");
      let n = 0;
      // Кадры должны меняться: неподвижный холст кодировщик вправе
      // не отправлять вовсе, и «картинка не идёт» вышло бы ложным.
      setInterval(() => {
        n += 1;
        ctx.fillStyle = n % 2 ? "#204060" : "#3a6ea5";
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = "#ffffff";
        ctx.font = "48px sans-serif";
        ctx.fillText("проверка " + n, 40, 200);
      }, 100);
      navigator.mediaDevices.getDisplayMedia = async () => canvas.captureStream(10);
      return true;
    })()
  `);
}

async function waitFor(win, expression, timeoutMs = 12_000) {
  const till = Date.now() + timeoutMs;
  while (Date.now() < till) {
    const value = await win.webContents.executeJavaScript(expression).catch(() => null);
    if (value) return value;
    await wait(250);
  }
  return null;
}

const text = (win) => win.webContents.executeJavaScript(`document.body.innerText`);

/** Снимок окна — если экран вообще отдаёт картинку.
 *
 *  Отдаёт не всегда: при погашенном или заблокированном экране
 *  Chromium возвращает пустое изображение, а то и вовсе отказывает.
 *  Проверка от этого не зависит — она нажимает кнопки и читает
 *  разметку, — и обрывать её из-за не сделанного снимка нельзя:
 *  так однажды потерялся весь прогон на втором шаге. */
async function shot(win, name) {
  try {
    const image = await win.webContents.capturePage();
    if (image.isEmpty()) {
      console.log(`  · снимок «${name}» не вышел: экран не отдаёт картинку`);
      return null;
    }
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    shots.push(file);
    return file;
  } catch (error) {
    console.log(`  · снимок «${name}» не вышел: ${String(error).slice(0, 80)}`);
    return null;
  }
}

/* ── Проверка ──────────────────────────────────────────────────── */

async function main() {
  // Не даём экрану погаснуть, пока идёт проверка. С погашенным экраном
  // Windows перестаёт отдавать кадры, анимации замирают на первом,
  // и нажатия начинают попадать мимо схлопнутых панелей.
  const блокировка = powerSaveBlocker.start("prevent-display-sleep");

  console.log("\n=== 1. Вход ===");
  const one = await openFor(A, "persist:app-check-a", 10);
  const two = await openFor(B, "persist:app-check-b", 740);

  ok("первый вошёл", (await text(one)).includes("Личные сообщения"));
  ok("второй вошёл", (await text(two)).includes("Личные сообщения"));

  /* Идут ли вообще кадры.
   *
   * На машине с погашенным экраном Windows не отдаёт поверхность
   * для отрисовки: анимации замирают на первом кадре, панели остаются
   * схлопнутыми, и нажатия попадают мимо. Проверка при этом «находит»
   * десяток поломок, которых нет, — так и случилось однажды, и час
   * ушёл на разбор несуществующей беды. Лучше сказать прямо.
   *
   * Экран мог погаснуть сам, пока шёл вход, — тогда ждём: гасить его
   * дальше мы не даём (см. powerSaveBlocker выше), а вернуться он
   * может от любого движения мышью. */
  let frames = 0;
  for (let попытка = 0; попытка < 12; попытка += 1) {
    frames = await one.webContents.executeJavaScript(
      `new Promise((resolve) => { let n = 0; const tick = () => { n += 1; requestAnimationFrame(tick); };
         requestAnimationFrame(tick); setTimeout(() => resolve(n), 1000); })`,
      true,
    );
    if (frames >= 5) break;
    if (попытка === 0) console.log("  · экран не отдаёт кадры — жду до минуты");
    await wait(4000);
  }
  if (frames < 5) {
    console.log(
      `\n  ✘ Экран машины спит — кадров за секунду: ${frames}.\n` +
        "    Нажатия сейчас проверять бессмысленно: анимации не идут,\n" +
        "    панели не раскрываются, и промахи будут выглядеть поломками.\n",
    );
    one.destroy();
    two.destroy();
    app.exit(3);
    return;
  }

  console.log("\n=== 2. Главная — список друзей, в сети первыми ===");
  // «В сети» появляется не сразу: сначала должно доехать чужое
  // присутствие. Читать список одним взглядом — значит иногда
  // заставать его за долю секунды до того, как второй в нём загорится.
  const online = await waitFor(
    one,
    `(document.body.innerText.match(/В СЕТИ — \\d/i) ?? [""])[0] || null`,
  );
  const home = await text(one);
  ok("главная показывает друзей", home.includes("Друзья") && home.includes("Проверка Второй"));
  ok("есть заголовок «В сети»", Boolean(online), { строка: online ?? "нет" });
  await shot(one, "приложение-1-главная");

  /* ── Статусы ────────────────────────────────────────────────────
   *
   * Проверяем не «кнопка нажимается», а то, ради чего статусы вообще
   * нужны: что выбранное одним человеком доезжает до другого. Причём
   * невидимку — с обратным знаком: она обязана НЕ доехать.
   */
  console.log("\n=== 3. Статусы ===");
  await click(one, 'button[aria-label="Выбрать статус"]');
  const menu = await waitFor(one, `Boolean(document.querySelector('[role="menu"]'))`, 8000);
  ok("меню статуса открывается нажатием на себя", menu);

  await clickText(one, "Не беспокоить", '[role="menuitemradio"]');
  ok(
    "свой статус сменился на «не беспокоить»",
    (await waitFor(one, `document.body.innerText.includes("Не беспокоить") ? "да" : ""`, 8000)) === "да",
  );

  const seenDnd = await waitFor(
    two,
    `document.querySelector('[title="Не беспокоить"]') ? "да" : ""`,
    12_000,
  );
  ok("собеседник видит «не беспокоить»", seenDnd === "да");

  // Невидимка: для друга человек должен пропасть из «в сети» совсем.
  await click(one, 'button[aria-label="Выбрать статус"]');
  await clickText(one, "Невидимый", '[role="menuitemradio"]');
  const vanished = await waitFor(
    two,
    `/В СЕТИ — \\d/i.test(document.body.innerText) ? "" : "пропал"`,
    12_000,
  );
  ok("невидимка пропадает из «в сети» у друга", vanished === "пропал");
  ok(
    "себе же невидимка виден и предупреждён",
    (await one.webContents.executeJavaScript(
      `document.body.innerText.includes("Невидимый") ? "да" : ""`,
    )) === "да",
  );

  // И обратно: статус должен возвращаться так же легко, как ставился.
  await click(one, 'button[aria-label="Выбрать статус"]');
  await clickText(one, "В сети", '[role="menuitemradio"]');
  const back = await waitFor(two, `/В СЕТИ — \\d/i.test(document.body.innerText) ? "да" : ""`, 12_000);
  ok("вернулся в сеть — друг снова его видит", back === "да");

  console.log("\n=== 4. Переписка и сообщение ===");
  // Оба открывают переписку заранее: человек видит новое сообщение
  // сразу, только если смотрит в этот канал. Иначе он увидел бы
  // счётчик непрочитанного, а это уже другая проверка.
  await clickText(two, "Проверка Первый");
  await wait(900);
  await clickText(one, "Проверка Второй");
  await wait(1200);
  const composer = await waitFor(
    one,
    `Boolean(document.querySelector("textarea")) ? "есть" : ""`,
  );
  ok("переписка открылась, поле ввода на месте", composer === "есть");

  await click(one, "textarea");
  const MESSAGE = "privet 42";
  await type(one, MESSAGE);
  await press(one, "Enter");

  const mine = await waitFor(one, `document.body.innerText.includes(${JSON.stringify(MESSAGE)}) ? "да" : ""`);
  ok("сообщение появилось у отправителя", mine === "да");

  const theirs = await waitFor(two, `document.body.innerText.includes(${JSON.stringify(MESSAGE)}) ? "да" : ""`);
  ok("сообщение дошло до собеседника", theirs === "да");
  await shot(two, "приложение-2-сообщение-дошло");

  /* Ссылка в сообщении должна быть ссылкой, а не текстом: их кидают
   * друг другу по десятку за вечер, и копировать адрес руками — самое
   * заметное неудобство, какое может быть в переписке. */
  await click(one, "textarea");
  const LINK = "https://example.com/stranica?a=1";
  await type(one, `smotri ${LINK} vot`);
  await press(one, "Enter");

  const linked = await waitFor(
    two,
    `(() => {
       const a = [...document.querySelectorAll("a")].find((n) => n.href.includes("example.com"));
       return a ? JSON.stringify({ href: a.getAttribute("href"), цель: a.target, rel: a.rel, текст: a.textContent }) : "";
     })()`,
    12_000,
  );
  const l = linked ? JSON.parse(linked) : null;
  ok("ссылка в сообщении стала ссылкой", Boolean(l), l ?? {});
  ok("ссылка ведёт по адресу и открывается снаружи", l?.href === LINK && l?.цель === "_blank", l ?? {});

  console.log("\n=== 5. Ответ собеседника ===");
  await click(two, "textarea");
  const REPLY = "i tebe privet";
  await type(two, REPLY);
  await press(two, "Enter");
  const gotReply = await waitFor(one, `document.body.innerText.includes(${JSON.stringify(REPLY)}) ? "да" : ""`);
  ok("ответ дошёл обратно", gotReply === "да");

  console.log("\n=== 6. Звонок ===");
  ok("в переписке есть трубка", Boolean(await box(one, 'button[aria-label="Позвонить"]')));
  await click(one, 'button[aria-label="Позвонить"]');
  ok("у звонящего «Звоню…»", (await waitFor(one, `document.body.innerText.includes("Звоню") ? "да" : ""`)) === "да");

  const ring = await waitFor(
    two,
    `(() => { const d = document.querySelector('[role="dialog"]');
              return d?.getAttribute("aria-label")?.includes("Входящий") ? d.getAttribute("aria-label") : ""; })()`,
  );
  ok("у второго зазвонило", Boolean(ring), { окно: ring });
  await shot(two, "приложение-3-входящий-звонок");

  await click(two, 'button[aria-label="Ответить"]');
  const inA = await waitFor(one, `Boolean(document.querySelector('button[aria-label="Выйти из разговора"]'))`, 15_000);
  const inB = await waitFor(two, `Boolean(document.querySelector('button[aria-label="Выйти из разговора"]'))`, 15_000);
  ok("оба в разговоре", inA && inB);

  // Задержку меряют по ответу сервера, и первое число появляется
  // через секунду-другую после соединения. Ждём его, а не хватаем
  // полоску сразу.
  const bar = await waitFor(
    one,
    `(() => { const m = document.body.innerText.match(/В разговоре[\\s\\S]{0,80}/);
              return m && /\\d+\\s*мс/.test(m[0]) ? m[0] : ""; })()`,
    15_000,
  );
  ok("полоска разговора показывает состав и задержку", Boolean(bar), {
    полоска: (bar ?? "").replace(/\n/g, " · ").slice(0, 70),
  });
  await shot(one, "приложение-4-разговор");

  /* Звонок живёт полосой в самой переписке, а не вместо неё:
   * во время разговора кидают ссылки и смотрят вчерашнюю переписку.
   * Проверяем, что переписка на месте, а в полосе есть и участники,
   * и кнопки. */
  const panel = await one.webContents.executeJavaScript(`
    JSON.stringify({
      перепискаНаМесте: Boolean(document.querySelector('textarea, [contenteditable="true"]')),
      естьЛента: Boolean(document.querySelector('[data-messages], main, .overflow-y-auto')),
      трубка: Boolean(document.querySelector('button[aria-label="Выйти из разговора"]')),
      микрофон: Boolean(document.querySelector('button[aria-label="Выключить микрофон"]')),
      камера: Boolean(document.querySelector('button[aria-label="Включить камеру"]')),
      именаВПолосе: [...document.querySelectorAll("li")]
        .map((n) => n.textContent.trim())
        .filter((t) => t.includes("Проверка")).length,
    })
  `);
  const p = JSON.parse(panel);
  ok("во время звонка переписка остаётся на месте", p.перепискаНаМесте, p);
  ok("в полосе звонка есть трубка, микрофон и камера", p.трубка && p.микрофон && p.камера, p);
  ok("в полосе звонка видны участники", p.именаВПолосе >= 1, { найдено: p.именаВПолосе });
  await shot(one, "приложение-9-звонок");

  console.log("\n=== 7. Микрофон и звук ===");
  await click(one, 'button[aria-label="Выключить микрофон"]');
  const muted = await waitFor(one, `Boolean(document.querySelector('button[aria-label="Включить микрофон"]'))`);
  ok("микрофон выключается", muted);
  await click(one, 'button[aria-label="Включить микрофон"]');
  ok("и включается обратно", await waitFor(one, `Boolean(document.querySelector('button[aria-label="Выключить микрофон"]'))`));

  await click(one, 'button[aria-label="Отключить звук"]');
  const deaf = await waitFor(one, `Boolean(document.querySelector('button[aria-label="Включить звук"]'))`);
  ok("звук отключается", deaf);

  /* Выключенный звук должен быть виден собеседнику — и вместо
   * микрофона, а не рядом с ним. «Молчу» и «не слышу вас» — разные
   * вещи, и вторая важнее: такому человеку бесполезно что-либо
   * говорить, а раньше он выглядел просто с закрытым микрофоном. */
  const heardOff = await waitFor(
    two,
    `(() => {
       const deaf = document.querySelectorAll('[title="Звук выключен — не слышит"]').length;
       const mic = document.querySelectorAll('[title="Микрофон выключен"]').length;
       return deaf > 0 ? JSON.stringify({ deaf, mic }) : "";
     })()`,
    10_000,
  );
  const d0 = heardOff ? JSON.parse(heardOff) : null;
  ok("собеседник видит, что человек выключил звук", Boolean(d0), d0 ?? {});
  ok("значок звука вытесняет значок микрофона, а не встаёт рядом", d0?.mic === 0, d0 ?? {});

  await click(one, 'button[aria-label="Включить звук"]');
  ok(
    "вернули звук — значок у собеседника пропал",
    (await waitFor(
      two,
      `document.querySelector('[title="Звук выключен — не слышит"]') ? "" : "пропал"`,
      10_000,
    )) === "пропал",
  );

  /* ── Показ экрана и просмотр ────────────────────────────────────
   *
   * Здесь проверяется главное правило красной кнопки: пока смотришь
   * чужой показ, она прекращает просмотр, а не разговор. Промах мимо
   * неё стоил бы всем возвращения в разговор заново, поэтому выход
   * обязан остаться на виду — в полоске разговора слева.
   *
   * Показ настоящий: первый отдаёт свой экран, кадры идут по тому же
   * прямому соединению, что и голос, и второй нажимает «смотреть»
   * мышью. */
  console.log("\n=== 8. Показ экрана и просмотр ===");
  await fakeScreen(one);
  await click(one, 'button[aria-label="Показать экран"]');
  const sharing = await waitFor(
    one,
    `Boolean(document.querySelector('button[aria-label^="Прекратить показ"]'))`,
    20_000,
  );
  ok("показ экрана включился", sharing);

  const offered = await waitFor(
    two,
    `[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Смотреть") ? "да" : ""`,
    25_000,
  );
  ok("собеседнику предложили посмотреть, а не открыли сами", offered === "да");

  // Свой показ — это зеркало, а не просмотр: у показывающего красная
  // кнопка обязана остаться трубкой, иначе выйти из разговора нельзя
  // будет ровно тогда, когда что-то показываешь.
  const ownStill = await one.webContents.executeJavaScript(
    `document.querySelectorAll('button[aria-label="Прекратить просмотр"]').length`,
  );
  ok("у показывающего кнопка просмотра не появилась", ownStill === 0, { найдено: ownStill });

  await clickText(two, "Смотреть", "button");
  const watchingLabel = await waitFor(
    two,
    `Boolean(document.querySelector('button[aria-label="Прекратить просмотр"]'))`,
    20_000,
  );
  ok("у смотрящего красная кнопка стала «прекратить просмотр»", watchingLabel);

  const escape = await two.webContents.executeJavaScript(`
    (() => {
      const leave = [...document.querySelectorAll('button[aria-label="Выйти из разговора"]')];
      const stop = document.querySelector('button[aria-label="Прекратить просмотр"]');
      return JSON.stringify({
        выходов: leave.length,
        выходСлева: leave.length ? Math.round(leave[0].getBoundingClientRect().x) < 450 : false,
        картинкаИдёт: [...document.querySelectorAll("video")].some((v) => v.videoWidth > 0),
        стопСправа: stop ? Math.round(stop.getBoundingClientRect().x) : null,
      });
    })()
  `);
  const e = JSON.parse(escape);
  ok("выход из разговора остался на виду — в полоске слева", e.выходов === 1 && e.выходСлева, e);
  ok("кадры чужого экрана действительно идут", e.картинкаИдёт, e);
  await shot(two, "приложение-10-смотрю-показ");

  await click(two, 'button[aria-label="Прекратить просмотр"]');
  const stopped = await waitFor(
    two,
    `(() => {
       const offer = [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Смотреть");
       const inCall = Boolean(document.querySelector('button[aria-label="Выйти из разговора"]'));
       return offer && inCall ? "да" : "";
     })()`,
    10_000,
  );
  ok("просмотр прекращается, а разговор остаётся", stopped === "да");

  await click(one, 'button[aria-label^="Прекратить показ"]');
  ok(
    "показ выключается обратно",
    (await waitFor(one, `document.querySelector('button[aria-label^="Прекратить показ"]') ? "" : "выключен"`)) ===
      "выключен",
  );

  console.log("\n=== 9. Выход из разговора ===");
  await click(one, 'button[aria-label="Выйти из разговора"]');
  ok(
    "первый вышел",
    (await waitFor(one, `document.querySelector('button[aria-label="Выйти из разговора"]') ? "" : "вышел"`)) === "вышел",
  );
  const secondAlone = await waitFor(
    two,
    `document.body.innerText.match(/В разговоре/) ? "да" : ""`,
    5000,
  );
  ok("второй остаётся в канале один", secondAlone === "да");
  await click(two, 'button[aria-label="Выйти из разговора"]');

  console.log("\n=== 10. Свой сервер и канал ===");
  await click(one, 'button[aria-label="Создать сервер"]');
  const dialog = await waitFor(one, `Boolean(document.querySelector('[role="dialog"] input'))`);
  ok("окно создания сервера открылось", dialog);
  await click(one, '[role="dialog"] input');
  await selectAll(one);
  await type(one, "Proverka");
  await clickText(one, "Создать");
  const madeServer = await waitFor(one, `document.body.innerText.includes("Proverka") ? "да" : ""`, 12_000);
  ok("сервер создан", madeServer === "да");
  await shot(one, "приложение-5-сервер");

  // Регистр не сверяем: заголовки разделов нарисованы заглавными
  // стилями, и со страницы текст приходит тоже заглавными.
  const madeChannel = await waitFor(
    one,
    `/текстовые каналы/i.test(document.body.innerText) && /голосовые каналы/i.test(document.body.innerText) ? "да" : ""`,
    8000,
  );
  ok("в новом сервере сразу есть каналы, текстовый и голосовой", madeChannel === "да");

  /* ── Голосовой канал сервера ────────────────────────────────────
   *
   * Ровно тот случай со снимка: человек в разговоре, а в канале
   * «никого нет». Проверяем, что он видит в составе сам себя — и после
   * входа, и после повторного входа в тот же канал (так мессенджер
   * возвращается после любого обрыва связи). */
  console.log("\n=== 11. Голосовой канал сервера ===");
  await clickText(one, "Разговор", "button");
  const inVoice = await waitFor(
    one,
    `Boolean(document.querySelector('button[aria-label="Выйти из разговора"]'))`,
    12_000,
  );
  ok("зашли в голосовой канал сервера", inVoice);

  const selfInRoster = await waitFor(
    one,
    `(() => { const m = document.body.innerText.match(/Разговор · (\\d+)/);
              return m && Number(m[1]) >= 1 ? m[0] : ""; })()`,
    10_000,
  );
  ok("в канале виден сам вошедший", Boolean(selfInRoster), { полоска: selfInRoster ?? "нет" });

  const aloneText = await text(one);
  ok("на месте разговора не написано «никого нет»", !aloneText.includes("Здесь пока никого нет"));

  // Повторный вход в тот же канал — то же самое, что возврат после
  // обрыва связи. Раньше после него состав обнулялся.
  await clickText(one, "Разговор", "button");
  await wait(1500);
  const stillThere = await waitFor(
    one,
    `(() => { const m = document.body.innerText.match(/Разговор · (\\d+)/);
              return m && Number(m[1]) >= 1 ? m[0] : ""; })()`,
    10_000,
  );
  ok("после повторного входа состав не обнулился", Boolean(stillThere), {
    полоска: stillThere ?? "нет",
  });

  /* ── Поддержка сервера ──────────────────────────────────────────
   *
   * Буст без денег: один голос от каждого, уровень считается сам,
   * и каждый уровень что-то открывает. Проверяем не кнопку, а цепочку
   * целиком — от нажатия до того, что уровень стал первым. */
  console.log("\n=== 12. Поддержка сервера ===");
  await click(one, 'button[aria-label="Настройки сервера"]');
  // Регистр не сверяем: заголовок нарисован заглавными стилями,
  // и со страницы текст приходит тоже заглавным.
  const boostPanel = await waitFor(
    one,
    `/поддержка сервера/i.test(document.body.innerText) ? "да" : ""`,
    10_000,
  );
  ok("в настройках сервера есть поддержка", boostPanel === "да");
  ok(
    "пока не поддержали — уровня нет",
    (await one.webContents.executeJavaScript(
      `document.body.innerText.includes("Уровня пока нет") ? "да" : ""`,
    )) === "да",
  );

  await clickText(one, "Поддержать");
  const boosted = await waitFor(
    one,
    `(() => { const t = document.body.innerText;
              return t.includes("Уровень 1") && t.includes("1 буст") ? "да" : ""; })()`,
    12_000,
  );
  ok("после поддержки сервер стал первого уровня", boosted === "да");

  // Награда первого уровня — не надпись, а другой предел вложений.
  // Проверяем то, что видно человеку: сколько теперь можно.
  const limitShown = await one.webContents.executeJavaScript(
    `document.body.innerText.includes("Вложения до 25 МБ") ? "да" : ""`,
  );
  ok("написано, что именно открылось", limitShown === "да");

  /* Третий уровень открывает свои эмодзи. Одному человеку четырёх
   * бустов не набрать, поэтому здесь проверяем обратное и не менее
   * важное: пока уровня нет, раздела эмодзи в настройках тоже нет.
   * Обещание, которого не выполняют, хуже отсутствия обещания. */
  // Ищем сам раздел, а не слова «свои эмодзи»: они теперь стоят
  // и в списке уровней — как обещание третьего. Раздел узнаётся
  // по полю имени, которого без него нет.
  const рано = await one.webContents.executeJavaScript(
    `document.querySelector('input[aria-label="Название эмодзи"]') ? "есть" : ""`,
  );
  ok("до третьего уровня эмодзи не предлагают", рано === "");
  ok(
    "но написано, что они за него дают",
    (await one.webContents.executeJavaScript(
      `document.body.innerText.includes("Свои эмодзи сервера") ? "да" : ""`,
    )) === "да",
  );

  await clickText(one, "Убрать");
  ok(
    "поддержку можно снять тем же нажатием",
    (await waitFor(
      one,
      `document.body.innerText.includes("Уровня пока нет") ? "да" : ""`,
      10_000,
    )) === "да",
  );
  await click(one, 'button[aria-label="Закрыть"]');
  await wait(600);

  /* ── Тот же человек с другого устройства ────────────────────────
   *
   * Один человек — один разговор. Второе окно того же человека должно
   * забрать разговор себе, а первое — выйти. */
  console.log("\n=== 13. Тот же человек со второго устройства ===");
  const third = await openFor(A, "persist:app-check-a2", 380);
  // Сервер в ленте слева — кружок с буквой; имя у него только
  // в подсказке, поэтому ищем по ней. И дожидаемся: список серверов
  // приезжает с сервера, а не рисуется сразу.
  const railReady = await waitFor(
    third,
    `Boolean(document.querySelector('button[title="Proverka"]'))`,
    15_000,
  );
  ok("на втором устройстве видно сервер", railReady, {
    // Без этого «не вижу сервер» неотличимо от «не вошёл» и «не
    // загрузилось»: три разные причины с одинаковым видом.
    видно: railReady
      ? "да"
      : await third.webContents.executeJavaScript(`
          JSON.stringify({
            текст: document.body.innerText.slice(0, 90).replace(/\\n/g, " "),
            кнопкиЛенты: [...document.querySelectorAll('nav[aria-label="Серверы"] button')]
              .map((b) => b.title || b.getAttribute("aria-label") || "?"),
          })
        `),
  });
  await click(third, 'button[title="Proverka"]');

  const channelsReady = await waitFor(
    third,
    `[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Разговор")`,
    10_000,
  );
  ok("на втором устройстве открылись каналы", channelsReady);
  await clickText(third, "Разговор", "button");
  const thirdIn = await waitFor(
    third,
    `Boolean(document.querySelector('button[aria-label="Выйти из разговора"]'))`,
    12_000,
  );
  ok("второе устройство вошло в разговор", thirdIn);

  const firstKicked = await waitFor(
    one,
    `document.querySelector('button[aria-label="Выйти из разговора"]') ? "" : "вышел"`,
    12_000,
  );
  ok("первое устройство вышло само", firstKicked === "вышел");
  third.destroy();

  console.log("\n=== 14. Настройки ===");
  await click(one, 'button[aria-label="Настройки"]');
  const settings = await waitFor(one, `document.body.innerText.includes("НАСТРОЙКИ") ? "да" : ""`);
  ok("настройки открылись", settings === "да");

  for (const tab of ["Голос", "Уведомления", "Вид", "Вход"]) {
    await clickText(one, tab);
    await wait(700);
    ok(`вкладка «${tab}» открывается`, (await text(one)).includes(tab));
  }

  /* Список входов. Проверка идёт из такой же оболочки, что и само
   * приложение, — значит и называться она должна приложением,
   * а не «Chrome»: раньше все входы выглядели одинаково, и понять,
   * где ты сидишь с приложением, а где открыл вкладку, было нельзя. */
  const logins = await waitFor(
    one,
    `(() => {
       const строки = [...document.querySelectorAll("div")]
         .map((n) => n.textContent.trim())
         .filter((t) => t.startsWith("Приложение") || t.startsWith("Chrome") || t.startsWith("Браузер"));
       return строки.length ? JSON.stringify(строки.slice(0, 3)) : "";
     })()`,
    10_000,
  );
  const входы = logins ? JSON.parse(logins) : [];
  ok(
    "вход из приложения так и подписан — приложением",
    входы.some((s) => s.startsWith("Приложение")),
    { первые: входы.slice(0, 2) },
  );

  // Шумодав: проверяем, что он есть, стоит на своём и это именно наш,
  // а не браузерный.
  //
  // Вкладку выбираем строго в списке разделов: слово «Голос»
  // встречается и в содержимом, а нажатие по нему вкладку не меняет.
  await click(one, 'nav[aria-label="Разделы настроек"] button:nth-of-type(2)');
  await waitFor(one, `Boolean(document.querySelector('#denoise'))`, 6000);
  const denoise = await one.webContents.executeJavaScript(`
    (() => {
      const select = document.querySelector('#denoise');
      return select ? JSON.stringify({ выбрано: select.value, вариантов: select.options.length }) : "";
    })()
  `);
  const d = denoise ? JSON.parse(denoise) : null;
  ok("в настройках есть выбор шумоподавления", Boolean(d), d ?? {});
  ok("по умолчанию стоит своё сильное", d?.выбрано === "strong", d ?? {});
  await shot(one, "приложение-6-настройки");
  await click(one, 'button[aria-label="Закрыть"]');
  ok(
    "настройки закрылись",
    (await waitFor(one, `document.body.innerText.includes("НАСТРОЙКИ") ? "" : "закрыто"`)) === "закрыто",
  );

  console.log("\n=== 15. Телефонная раскладка ===");
  one.setSize(390, 820);
  // Ждём саму перерисовку, а не «полторы секунды на всякий случай»:
  // после тяжёлых шагов окно успевает не всё, и замер заставал ещё
  // широкую раскладку.
  await waitFor(
    one,
    `innerWidth < 500 && Boolean(document.querySelector('button[aria-label="Каналы и серверы"]'))`,
    10_000,
  );
  await wait(400);
  const narrow = await one.webContents.executeJavaScript(`
    JSON.stringify({
      ширина: innerWidth,
      едетВбок: document.documentElement.scrollWidth > innerWidth + 1,
      естьКнопкаКаналов: Boolean(document.querySelector('button[aria-label="Каналы и серверы"]')),
    })
  `);
  const n = JSON.parse(narrow);
  ok("на узком экране страница не едет вбок", !n.едетВбок, n);
  ok("появилась кнопка каналов", n.естьКнопкаКаналов);

  // Кнопка должна стоять слева: шторка выезжает оттуда же.
  const toggle = await box(one, 'button[aria-label="Каналы и серверы"]');
  ok("кнопка каналов у левого края", toggle !== null && toggle.x < n.ширина / 2, {
    x: toggle?.x,
    ширина: n.ширина,
  });

  await clickAt(one, toggle);
  await wait(900);
  // Сама панель стоит на месте всегда — ездит переписка поверх неё.
  // Поэтому мерить надо обе: панель у левого края, а переписка
  // отъехала вправо ровно на её ширину. По одной панели судить нельзя:
  // её край на месте и при закрытой шторке.
  const drawer = await one.webContents.executeJavaScript(`
    (() => {
      const panel = document.querySelector('nav[aria-label="Серверы"]')?.parentElement;
      const chat = document.querySelector('button[aria-label="Вернуться к переписке"]');
      if (!panel || !chat) return JSON.stringify({ нет: true });
      return JSON.stringify({
        левыйПанели: Math.round(panel.getBoundingClientRect().x),
        левыйПереписки: Math.round(chat.getBoundingClientRect().x),
        шириной: Math.round(panel.getBoundingClientRect().width),
      });
    })()
  `);
  const left = JSON.parse(drawer);
  ok(
    "шторка открылась слева, переписка отъехала вправо",
    !left.нет && Math.abs(left.левыйПанели) <= 2 && Math.abs(left.левыйПереписки - left.шириной) <= 2,
    left,
  );
  await shot(one, "приложение-7-телефон");

  // Закрываем шторку и смотрим участников — они выезжают справа
  // и только на сервере.
  //
  // Нажимаем не в середину кнопки возврата, а в видимую полоску
  // переписки справа. Кнопка эта — во всю ширину переписки, а сама
  // переписка отъехала: её середина оказывается за краем окна,
  // и нажатие туда не попадает никуда.
  await clickAt(one, { x: n.ширина - 20, y: 400 });
  await waitFor(
    one,
    `document.querySelector('button[aria-label="Вернуться к переписке"]') ? "" : "закрыто"`,
    6000,
  );
  await wait(600);
  const people = await box(one, 'button[aria-label="Участники"]');
  ok("на сервере есть кнопка участников", people !== null, { x: people?.x });
  if (people) {
    ok("кнопка участников у правого края", people.x > n.ширина / 2, { x: people.x });
    await clickAt(one, people);
    await wait(900);
    const right = await one.webContents.executeJavaScript(`
      (() => {
        const chat = document.querySelector('button[aria-label="Вернуться к переписке"]');
        if (!chat) return JSON.stringify({ нет: true });
        return JSON.stringify({ левыйПереписки: Math.round(chat.getBoundingClientRect().x) });
      })()
    `);
    const r = JSON.parse(right);
    ok("участники выехали справа — переписка ушла влево", !r.нет && r.левыйПереписки < -100, r);
    await shot(one, "приложение-8-участники");
    // Возвращаемся тем же способом — нажатием в видимую часть переписки,
    // только теперь она видна слева.
    await clickAt(one, { x: 20, y: 400 });
    await wait(600);
  }
  one.setSize(1180, 820);
  await wait(800);

  /* ── Итог ─────────────────────────────────────────────────── */
  const failed = results.filter((r) => !r.ок);
  console.log(
    `\n${failed.length === 0 ? "Всё сходится" : `Провалов: ${failed.length}`} — проверок ${results.length}\n`,
  );
  if (failed.length > 0) console.log(JSON.stringify(failed, null, 1));
  console.log(JSON.stringify({ снимки: shots }, null, 1));

  powerSaveBlocker.stop(блокировка);
  one.destroy();
  two.destroy();
  app.exit(failed.length === 0 ? 0 : 1);
}

app.on("window-all-closed", () => undefined);

void app.whenReady().then(() =>
  main().catch((error) => {
    console.error("проверка сорвалась:", error);
    app.exit(2);
  }),
);
