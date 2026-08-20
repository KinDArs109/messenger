// Проверка того, что мессенджер, открывшийся без оформления,
// приводит себя в порядок сам.
//
//   npm run check:undressed -w @messenger/desktop -- --site=http://localhost:3001
//
// Страница без стилей — не «некрасиво», а сломано: списки вместо
// переписки, огромные картинки, системный шрифт. И человек ничего
// не может с этим сделать: перезагрузка не помогает, потому что
// испорченное лежит в запасе и отдаётся минуя сеть.
//
// Проверка устраивает ровно это: гасит файл стилей на первой попытке
// и смотрит, что мессенджер сам заметит, сотрёт запас и перезагрузится
// одетым. И отдельно — что он делает это один раз, а не по кругу:
// вечная перезагрузка была бы хуже некрасивой страницы.

const { app, BrowserWindow, session } = require("electron");

app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.on("window-all-closed", () => undefined);

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const SITE = arg("site") ?? "http://localhost:3001";

const результаты = [];
const ok = (пункт, значение, ещё) => {
  результаты.push(Boolean(значение));
  console.log(
    `${значение ? "  ✔" : "  ✘ ПРОВАЛ"} ${пункт}${ещё === undefined ? "" : " " + JSON.stringify(ещё)}`,
  );
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Одет или голый — по цвету фона, а не по числу таблиц стилей:
// таблицу-другую библиотеки подкладывают на ходу, и их наличие
// ничего не говорит о том, приехало ли оформление.
const осмотр = `
  (() => {
    const фон = getComputedStyle(document.body).backgroundColor;
    return { фон, одет: фон !== "" && фон !== "transparent" && фон !== "rgba(0, 0, 0, 0)" };
  })()
`;

void app
  .whenReady()
  .then(async () => {
    console.log("\n=== Мессенджер без оформления ===");

    const ses = session.fromPartition("persist:undressed");
    await ses.clearStorageData();

    // Гасим стили ровно один раз — как если бы в запасе лежало
    // испорченное, а сеть была в порядке.
    let погашено = 0;
    let загрузок = 0;
    // Образец адреса берём широкий, а разбираемся сами: узкие
    // образцы Electron молча не применяет, и проверка тогда ничего
    // не гасит — что и случилось в первый раз.
    ses.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (подробности, callback) => {
      const стили = подробности.url.includes("/assets/") && подробности.url.endsWith(".css");
      if (стили && погашено === 0) {
        погашено += 1;
        callback({ cancel: true });
        return;
      }
      callback({});
    });

    // Окно обязательно в том же сеансе, где стоит заслонка: без
    // этого оно ходит в сеть мимо неё, и гасить оказывается нечего.
    const win = new BrowserWindow({
      width: 1000,
      height: 720,
      show: true,
      backgroundColor: "#101114",
      webPreferences: { session: ses },
    });
    win.webContents.on("did-finish-load", () => {
      загрузок += 1;
    });

    await win.loadURL(SITE);
    await wait(2000);

    const сразу = await win.webContents.executeJavaScript(осмотр);
    ok("сначала мессенджер и правда голый", !сразу.одет, сразу);

    // Ждём: две с половиной секунды на осмотр, потом перезагрузка
    // и обычная загрузка страницы.
    await wait(7000);

    const потом = await win.webContents.executeJavaScript(осмотр);
    ok("сам оделся", потом.одет, потом);
    ok("перезагрузился один раз, а не по кругу", загрузок === 2, { загрузок });

    // Ещё немного — на случай, если он всё-таки крутится.
    await wait(6000);
    ok("и дальше не перезагружается", загрузок === 2, { загрузок });

    win.destroy();

    const провалов = результаты.filter((x) => !x).length;
    console.log(
      `\n${провалов === 0 ? "Приводит себя в порядок" : `Провалов: ${провалов}`} — проверок ${результаты.length}\n`,
    );
    app.exit(провалов === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.log(`\n  ✘ Проверка сорвалась: ${String(error?.stack ?? error).slice(0, 400)}\n`);
    app.exit(2);
  });
