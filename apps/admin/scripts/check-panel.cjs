// Проверка живой панели.
//
//   npm run check:panel -w @messenger/admin
//
// Панель показывала снимок на момент входа: удалил кого-то в мессенджере,
// зашёл друг, кончились приглашения — она об этом не узнавала. Теперь
// перечитывает хозяйство сама, и проверять надо именно это: что она
// перечитывает, что не мигает попусту, что продлевает вход и что честно
// говорит, когда дверь закрылась.
//
// Открывается настоящее окно панели — то самое, с которым работает
// хозяин, — а разговор с сервером в нём подменяется. Проверять хочется
// панель, а не сеть.

const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const окно = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  await окно.loadFile(path.join(__dirname, "..", "index.html"));

  const сценарий = fs.readFileSync(path.join(__dirname, "panel-scenario.js"), "utf8");

  let итог;
  try {
    итог = await окно.webContents.executeJavaScript(сценарий, true);
  } catch (беда) {
    console.log(`\n  ✘ ПРОВАЛ: сценарий не отработал — ${беда.message}\n`);
    app.exit(1);
    return;
  }

  console.log("\nЖивая панель\n");
  let провалов = 0;
  for (const { что, вышло } of итог) {
    if (!вышло) провалов += 1;
    console.log(`${вышло ? "  ✔" : "  ✘ ПРОВАЛ"} ${что}`);
  }

  console.log(
    провалов === 0
      ? `\nПанель живая — проверок ${итог.length}\n`
      : `\nПровалов: ${провалов} из ${итог.length}\n`,
  );

  app.exit(провалов === 0 ? 0 : 1);
});
