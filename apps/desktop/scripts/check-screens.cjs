// Проверка того, что мессенджер доехал до всех экранов целиком.
//
//   npm run check:screens -w @messenger/desktop
//   npm run check:screens -w @messenger/desktop -- --site=http://localhost:3001
//
// Появилась после выкладки, в которой страница уехала на сервер
// раньше, чем файл оформления рядом с ней. Снаружи всё отвечало
// двумястами, здоровье было в порядке, сторож молчал — а мессенджер
// открывался голой разметкой: списками, огромными картинками,
// системным шрифтом. «Сайт открывается» и «мессенджером можно
// пользоваться» оказались разными вещами.
//
// Поэтому проверяется не код ответа, а то, что видно человеку:
// приехало ли оформление, поместилось ли окно входа в экран телефона,
// не ругается ли что-нибудь в консоли. И отдельно — то, без чего
// приложение на телефоне перестаёт быть приложением: подпись связи
// сайта с ним и манифест.
//
// Движок здесь один, хромовский: это честно для компьютера и Android,
// но не для айфона — там свой Safari, и его этой проверкой не заменить.
// Размеры и вёрстку она про айфон говорит, про поведение движка — нет.

const { app, BrowserWindow, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const SITE = arg("site") ?? "https://45.130.42.77.sslip.io";
const OUT = arg("out") ?? path.join(__dirname, "..", "release", "экраны");

// Между экранами окон не остаётся ни на мгновение, а Electron
// по умолчанию считает это концом работы и выходит — молча, посреди
// проверки, с нулевым кодом. Держим приложение живым сами.
app.on("window-all-closed", () => undefined);

const результаты = [];
const ok = (пункт, значение, ещё) => {
  результаты.push(Boolean(значение));
  console.log(
    `${значение ? "  ✔" : "  ✘ ПРОВАЛ"} ${пункт}${ещё === undefined ? "" : " " + JSON.stringify(ещё)}`,
  );
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Запрос без окна — для того, что проверяется до всякой отрисовки. */
async function достать(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    return { ok: res.ok, status: res.status, type: res.headers.get("content-type") ?? "", text: await res.text() };
  } catch (error) {
    return { ok: false, status: 0, type: "", text: "", error: String(error) };
  }
}

/*
 * Экраны, на которых мессенджер живут. Ширина решает всё: вёрстка
 * переключается на телефонную ниже 768 точек, и именно там ломается
 * то, чего не видно на большом экране.
 */
const ЭКРАНЫ = [
  {
    имя: "компьютер",
    ширина: 1280,
    высота: 800,
    // Оболочка представляется отдельным словом — по нему сервер
    // отличает вход из приложения от входа из браузера.
    заголовок: "app-desktop",
  },
  { имя: "сайт-в-браузере", ширина: 1280, высота: 800 },
  {
    имя: "android",
    ширина: 393,
    высота: 851,
    агент:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  },
  {
    имя: "iphone",
    ширина: 390,
    высота: 844,
    агент:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  },
];

async function посмотреть(экран) {
  // Один сеанс на все экраны: у каждого свой означал бы, что клиент
  // в семьсот килобайт скачивается заново на каждый — по разу на
  // экран, по минуте на разу. Между экранами стираем только вход,
  // чтобы каждый начинал с чистой формы.
  const ses = session.fromPartition("persist:screens");
  await ses.clearStorageData({ storages: ["cookies", "localstorage", "indexdb"] });

  const win = new BrowserWindow({
    width: экран.ширина,
    height: экран.высота,
    show: true,
    backgroundColor: "#101114",
    useContentSize: true,
    webPreferences: { session: ses },
  });

  if (экран.агент) win.webContents.setUserAgent(экран.агент);

  const ошибки = [];
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2) ошибки.push(message.slice(0, 200));
  });
  const неприехало = [];
  // Отказ отказу рознь. 401 на попытке поднять сессию — это не сбой,
  // а обычный ответ незалогиненному: клиент всегда пробует и всегда
  // получает от ворот поворот, пока никто не вошёл. Ловим то, из-за
  // чего мессенджер выглядит сломанным: файлы, которые не доехали,
  // и любую беду на стороне сервера.
  win.webContents.session.webRequest.onCompleted((подробности) => {
    const код = подробности.statusCode;
    const свой = подробности.url.startsWith(SITE);
    const файл = /\.(js|css|png|svg|woff2?|webmanifest|json)(\?|$)/.test(подробности.url);
    if (свой && (код >= 500 || (код >= 400 && файл))) {
      неприехало.push(`${код} ${подробности.url.slice(0, 80)}`);
    }
  });

  await win.loadURL(SITE);
  await wait(3500);

  const видно = await win.webContents.executeJavaScript(`
    (() => {
      const корень = document.querySelector("#root");
      const стили = Array.from(document.styleSheets).map((s) => s.href).filter(Boolean);
      // Без выражений с косыми чертами: этот кусок едет в страницу
      // строкой, и «\/» в нём превращается в начало примечания —
      // весь остаток строки пропадает, и страница падает молча.
      const наша = стили.some((href) => href.includes("/assets/index-") && href.endsWith(".css"));
      // Правил в таблице стилей — вернейший признак того, что файл
      // не только запрошен, но и разобран: страница вместо стилей
      // отдаёт двести и разметку, и таблица оказывается пустой.
      const правил = Array.from(document.styleSheets).reduce((всего, s) => {
        try { return всего + s.cssRules.length; } catch { return всего; }
      }, 0);
      const тело = getComputedStyle(document.body).backgroundColor;
      const карточка = document.querySelector("form, [role=dialog]");
      const рамка = карточка ? карточка.getBoundingClientRect() : null;
      return {
        пусто: !корень || корень.children.length === 0,
        стилей: стили.length,
        наша,
        откуда: стили[0] ? стили[0].split("/").pop() : null,
        правил,
        фон: тело,
        шире: document.documentElement.scrollWidth > window.innerWidth + 1,
        карточка: рамка ? { ширина: Math.round(рамка.width), низ: Math.round(рамка.bottom) } : null,
        экран: { ширина: window.innerWidth, высота: window.innerHeight },
        текст: (document.body.innerText || "").slice(0, 120).replace(/\\s+/g, " "),
      };
    })()
  `);

  fs.mkdirSync(OUT, { recursive: true });
  const image = await win.webContents.capturePage();
  if (!image.isEmpty()) fs.writeFileSync(path.join(OUT, `${экран.имя}.png`), image.toPNG());

  win.destroy();
  return { ...видно, ошибки, неприехало };
}

void app
  .whenReady()
  .then(async () => {
    console.log(`\n=== Как мессенджер выглядит везде ===\n  ${SITE}\n`);

    for (const экран of ЭКРАНЫ) {
      console.log(`— ${экран.имя} (${экран.ширина}×${экран.высота})`);
      const r = await посмотреть(экран);

      ok(`${экран.имя}: мессенджер нарисовался`, !r.пусто, { видно: r.текст });
      // Голая разметка — это ноль таблиц стилей или пустая таблица.
      // Правил в таблице немного даже у большого оформления: свёрстано
      // слоями, и слой считается одним правилом. Важно не сколько их,
      // а что таблица наша и она разобралась.
      ok(`${экран.имя}: оформление приехало`, r.стилей > 0 && r.правил > 0 && r.наша, {
        таблиц: r.стилей,
        правил: r.правил,
        откуда: r.откуда,
      });
      // Тёмный фон — не украшение, а признак того, что применились
      // именно наши стили, а не умолчания браузера.
      ok(`${экран.имя}: тёмный фон на месте`, r.фон !== "rgba(0, 0, 0, 0)" && r.фон !== "rgb(255, 255, 255)", {
        фон: r.фон,
      });
      ok(`${экран.имя}: ничего не торчит вбок`, !r.шире, r.экран);
      if (r.карточка) {
        ok(`${экран.имя}: окно входа помещается в экран`, r.карточка.низ <= r.экран.высота + 1, r.карточка);
      }
      ok(`${экран.имя}: в консоли тихо`, r.ошибки.length === 0, r.ошибки.slice(0, 3));
      ok(`${экран.имя}: всё запрошенное доехало`, r.неприехало.length === 0, r.неприехало.slice(0, 3));
      console.log("");
    }

    console.log("— приложение на телефоне");

    // Без этой подписи Android откроет приложение с адресной строкой
    // Chrome наверху — то есть вкладкой, а не приложением.
    const links = await достать(`${SITE}/.well-known/assetlinks.json`);
    let отпечатков = 0;
    try {
      отпечатков = JSON.parse(links.text)?.[0]?.target?.sha256_cert_fingerprints?.length ?? 0;
    } catch {
      отпечатков = 0;
    }
    ok("сайт подтверждает приложение на Android", links.ok && отпечатков > 0, { отпечатков });

    const manifest = await достать(`${SITE}/manifest.webmanifest`);
    let м = null;
    try {
      м = JSON.parse(manifest.text);
    } catch {
      м = null;
    }
    ok("манифест читается", Boolean(м), { код: manifest.status });
    ok("манифест просит отдельное окно, а не вкладку", м?.display === "standalone" || м?.display === "fullscreen", {
      display: м?.display,
    });

    const иконки = м?.icons ?? [];
    let целых = 0;
    for (const иконка of иконки) {
      const r = await достать(new URL(иконка.src, SITE).href);
      if (r.ok && r.type.startsWith("image/")) целых += 1;
    }
    ok("иконки приложения на месте", иконки.length > 0 && целых === иконки.length, {
      всего: иконки.length,
      целых,
    });

    const sw = await достать(`${SITE}/sw.js`);
    ok("рабочий сценарий страницы отдаётся", sw.ok && sw.type.includes("javascript"), { код: sw.status });

    console.log("\n— обновление приложения на компьютере");
    const yml = await достать(`${SITE}/updates/latest.yml`);
    const версия = /version:\s*(\S+)/.exec(yml.text)?.[1] ?? "";
    ok("объявление об обновлении на месте", yml.ok && Boolean(версия), { версия });

    const setup = await достать(`${SITE}/updates/Messenger-Setup.exe.blockmap`);
    ok("карта блоков установщика на месте", setup.ok);

    const провалов = результаты.filter((x) => !x).length;
    console.log(
      `\n${провалов === 0 ? "Везде одинаково хорошо" : `Провалов: ${провалов}`} — проверок ${результаты.length}`,
    );
    console.log(`Снимки: ${OUT}\n`);
    app.exit(провалов === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.log(`\n  ✘ Проверка сорвалась: ${String(error?.stack ?? error).slice(0, 400)}\n`);
    app.exit(2);
  });
