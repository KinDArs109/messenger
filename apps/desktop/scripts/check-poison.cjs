// Проверка того, что испорченный запас лечится сам.
//
//   npm run check:poison -w @messenger/desktop
//
// Мессенджер держит файлы сборки в запасе service worker'а и берёт их
// оттуда, минуя сеть: имя файла содержит хеш содержимого, так что
// устаревшего ответа под ним быть не может. Не может — пока сервер
// отвечает тем, что просили.
//
// Однажды не ответил: на несуществующий файл стилей пришли двести
// и страница мессенджера. Запас честно её сохранил — код-то удачный, —
// и дальше отдавал разметку вместо стилей. Сервер починили в тот же
// час, а у человека мессенджер так и открывался голым: до сети дело
// не доходило.
//
// Проверка подкладывает ровно такую подделку в запас и смотрит, что
// мессенджер всё равно откроется одетым.

const { app, BrowserWindow, session } = require("electron");

app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.on("window-all-closed", () => undefined);

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const SITE = arg("site") ?? "https://45.130.42.77.sslip.io";

const результаты = [];
const ok = (пункт, значение, ещё) => {
  результаты.push(Boolean(значение));
  console.log(
    `${значение ? "  ✔" : "  ✘ ПРОВАЛ"} ${пункт}${ещё === undefined ? "" : " " + JSON.stringify(ещё)}`,
  );
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Одет ли мессенджер: приехали ли стили и применились ли они. */
const осмотр = `
  (() => {
    const стили = Array.from(document.styleSheets).map((s) => s.href).filter(Boolean);
    const правил = Array.from(document.styleSheets).reduce((всего, s) => {
      try { return всего + s.cssRules.length; } catch { return всего; }
    }, 0);
    return {
      одет: правил > 0 && getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)",
      правил,
      стилей: стили.length,
    };
  })()
`;

void app
  .whenReady()
  .then(async () => {
    console.log("\n=== Испорченный запас ===");

    const ses = session.fromPartition("persist:poison");
    await ses.clearStorageData();

    const win = new BrowserWindow({ width: 1100, height: 760, show: true, backgroundColor: "#101114" });
    await win.loadURL(SITE);
    await wait(4000);

    // Ждём, пока service worker возьмёт страницу под своё крыло:
    // без этого подделка легла бы в запас, которым никто не управляет.
    const свой = await win.webContents.executeJavaScript(`
      navigator.serviceWorker.ready.then((r) => Boolean(r.active)).catch(() => false)
    `);
    ok("service worker на месте", свой);

    const доПодделки = await win.webContents.executeJavaScript(осмотр);
    ok("до подделки мессенджер одет", доПодделки.одет, доПодделки);

    // Подделка: под именем файла стилей — разметка, как её отдавал
    // сервер до починки. Имя берём то самое, на которое ссылается
    // страница, — иначе подделка легла бы мимо.
    const подложено = await win.webContents.executeJavaScript(`
      (async () => {
        const href = Array.from(document.querySelectorAll("link[rel=stylesheet]")).map((l) => l.href)[0];
        if (!href) return null;
        const имена = await caches.keys();
        const имя = имена.find((k) => k.startsWith("assets")) ?? "assets-v5";
        const cache = await caches.open(имя);
        await cache.put(
          href,
          new Response("<!doctype html><html><body>не стили</body></html>", {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        );
        const проверка = await cache.match(href);
        return { имя, href, тип: проверка ? проверка.headers.get("content-type") : null };
      })()
    `);
    ok("подделка легла в запас", подложено?.тип?.includes("text/html"), подложено);

    await win.loadURL(SITE);
    await wait(4000);

    const послеПодделки = await win.webContents.executeJavaScript(осмотр);
    ok("после подделки мессенджер всё равно одет", послеПодделки.одет, послеПодделки);

    // И подделка не осталась лежать: раз её не отдают, пусть и место
    // не занимает — вместо неё в запас ляжет настоящий ответ.
    const стало = await win.webContents.executeJavaScript(`
      (async () => {
        const href = Array.from(document.querySelectorAll("link[rel=stylesheet]")).map((l) => l.href)[0];
        const имена = await caches.keys();
        for (const имя of имена.filter((k) => k.startsWith("assets"))) {
          const cache = await caches.open(имя);
          const ответ = await cache.match(href);
          if (ответ) return { имя, тип: ответ.headers.get("content-type") };
        }
        return null;
      })()
    `);
    ok("в запасе снова настоящие стили", стало?.тип?.includes("text/css"), стало);

    win.destroy();

    const провалов = результаты.filter((x) => !x).length;
    console.log(
      `\n${провалов === 0 ? "Лечится сам" : `Провалов: ${провалов}`} — проверок ${результаты.length}\n`,
    );
    app.exit(провалов === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.log(`\n  ✘ Проверка сорвалась: ${String(error?.stack ?? error).slice(0, 400)}\n`);
    app.exit(2);
  });
