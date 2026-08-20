// Хозяйская панель — отдельное приложение.
//
//   npm start -w @messenger/admin
//
// Отдельное, а не вкладка в мессенджере, и это главное решение здесь.
// Кнопка «удалить человека» не должна лежать в двух нажатиях
// от переписки, даже если она невидима остальным: невидима — не значит
// недоступна, достаточно ошибиться в одной проверке доступа. Здесь
// же ошибиться негде: приложения просто нет ни у кого, кроме хозяина,
// а сервер отвечает его разделу только тому, чьё имя вписано
// в настройки.
//
// Внутри — обычная страница без сборки. Панель открывают раз в месяц;
// тащить ради неё сборочный конвейер незачем.

const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");

function создатьОкно() {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 720,
    backgroundColor: "#101114",
    title: "Хозяйство мессенджера",
    autoHideMenuBar: true,
    webPreferences: {
      // Панель ходит только на свой сервер и ничего не исполняет
      // из сети: страница лежит рядом, на диске. Мост в систему
      // ей не нужен — значит его и не будет.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Ссылки наружу — во внешнем браузере, а не подменой окна панели.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // Адрес сервера можно передать доводом — пригодится, если мессенджер
  // переедет, и нужно для проверки на своей машине.
  const адрес = process.argv.find((a) => a.startsWith("--site="))?.slice(7);
  void win.loadFile(
    path.join(__dirname, "index.html"),
    адрес ? { query: { site: адрес } } : undefined,
  );
}

void app.whenReady().then(() => {
  создатьОкно();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) создатьОкно();
  });
});

app.on("window-all-closed", () => {
  // Панель — не мессенджер: закрыли окно, значит закрыли приложение.
  app.quit();
});
