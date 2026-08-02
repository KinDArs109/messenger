// Оболочка мессенджера для рабочего стола.
//
// Внутри — тот же клиент, что открывается в браузере: отдельной
// сборки под десктоп нет и не нужно. Смысл оболочки в другом —
// своё окно, своя иконка в панели задач и отсутствие адресной
// строки, из-за которой приложение выглядит как сайт.

const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

/** Адрес по умолчанию. Он же лежит в настройках: туннель может
 *  переехать, и требовать ради этого пересборку .exe у каждого
 *  друга — плохая идея. */
const DEFAULT_URL = "https://eagerly-winning-frog.cloudpub.ru";

const configPath = () => path.join(app.getPath("userData"), "config.json");

function readUrl() {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.url === "string" && /^https?:\/\//.test(parsed.url)) return parsed.url;
  } catch {
    // Файла нет или он битый — берём адрес по умолчанию.
  }
  return DEFAULT_URL;
}

function writeUrl(url) {
  fs.writeFileSync(configPath(), JSON.stringify({ url }, null, 2), "utf8");
}

let win = null;

function createWindow() {
  const url = readUrl();

  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    // Окно появляется уже с содержимым: без этого секунду видно
    // белый прямоугольник, и запуск выглядит как сбой.
    show: false,
    backgroundColor: "#313338",
    title: "Мессенджер",
    webPreferences: {
      // Страница не получает доступа ни к Node, ни к внутренностям
      // Electron. Оболочка не должна давать сайту больше прав,
      // чем даёт обычный браузер.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });

  // Полоса меню скрыта насовсем.
  //
  // Не autoHideMenuBar: он прячет её только до нажатия Alt — а Shift+Alt
  // в Windows переключает раскладку, и меню выскакивало при каждой смене
  // языка. setMenuBarVisibility(false) без autoHideMenuBar убирает её
  // совсем, при этом само меню остаётся зарегистрированным, и горячие
  // клавиши из него продолжают работать.
  win.setMenuBarVisibility(false);

  win.once("ready-to-show", () => win.show());
  void win.loadURL(url);

  // Не открылось — молчать нельзя: человек увидит пустое окно
  // и решит, что сломалось приложение, а не выключен ноутбук.
  win.webContents.on("did-fail-load", (_event, code, description, failedUrl) => {
    if (code === -3) return; // прерванная загрузка при переходе — не ошибка
    void dialog
      .showMessageBox(win, {
        type: "warning",
        title: "Нет связи",
        message: "Не удалось открыть мессенджер",
        detail:
          `${failedUrl}\n${description}\n\n` +
          "Скорее всего, компьютер с сервером выключен или спит. " +
          "Попробуйте позже или проверьте адрес.",
        buttons: ["Повторить", "Сменить адрес", "Закрыть"],
        defaultId: 0,
        cancelId: 2,
      })
      .then(({ response }) => {
        if (response === 0) win.reload();
        if (response === 1) void promptForUrl();
      });
  });

  // Ссылки наружу открываем в системном браузере. Внутри оболочки
  // им делать нечего: она без адресной строки, и из чужого сайта
  // человек уже не выберется.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, target) => {
    const home = new URL(readUrl());
    if (new URL(target).origin !== home.origin) {
      event.preventDefault();
      void shell.openExternal(target);
    }
  });
}

async function promptForUrl() {
  const current = readUrl();
  const { response } = await dialog.showMessageBox(win, {
    type: "question",
    title: "Адрес сервера",
    message: "Текущий адрес",
    detail: `${current}\n\nСбросить на адрес по умолчанию?`,
    buttons: ["Оставить", `Сбросить на ${DEFAULT_URL}`],
    defaultId: 0,
    cancelId: 0,
  });
  if (response === 1) {
    writeUrl(DEFAULT_URL);
    win.loadURL(DEFAULT_URL);
  }
}

function buildMenu() {
  // Меню скрыто (autoHideMenuBar), но живо: без него перестают
  // работать Ctrl+C, Ctrl+V и Ctrl+A — в Electron это пункты меню,
  // а не встроенное поведение.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Мессенджер",
        submenu: [
          { label: "Обновить", accelerator: "F5", click: () => win?.reload() },
          { label: "Адрес сервера…", click: () => void promptForUrl() },
          { type: "separator" },
          { label: "Выход", role: "quit" },
        ],
      },
      {
        label: "Правка",
        submenu: [
          { role: "undo", label: "Отменить" },
          { role: "redo", label: "Повторить" },
          { type: "separator" },
          { role: "cut", label: "Вырезать" },
          { role: "copy", label: "Копировать" },
          { role: "paste", label: "Вставить" },
          { role: "selectAll", label: "Выделить всё" },
        ],
      },
      {
        label: "Вид",
        submenu: [
          { role: "zoomIn", label: "Крупнее" },
          { role: "zoomOut", label: "Мельче" },
          { role: "resetZoom", label: "Обычный размер" },
          { type: "separator" },
          { role: "togglefullscreen", label: "Во весь экран" },
          { role: "toggleDevTools", label: "Инструменты разработчика" },
        ],
      },
    ]),
  );
}

// Второй экземпляр не нужен: две копии одного мессенджера — это два
// сокета и раздвоенные уведомления. Вместо запуска поднимаем окно.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  void app.whenReady().then(() => {
    buildMenu();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
