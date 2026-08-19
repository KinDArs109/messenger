// Оболочка мессенджера для рабочего стола.
//
// Внутри — тот же клиент, что открывается в браузере: отдельной
// сборки под десктоп нет и не нужно. Смысл оболочки в другом —
// своё окно, своя иконка в панели задач и отсутствие адресной
// строки, из-за которой приложение выглядит как сайт.

const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  powerMonitor,
  screen,
  session,
  shell,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const fs = require("node:fs");

/** Адрес по умолчанию. Он же лежит в настройках: туннель может
 *  переехать, и требовать ради этого пересборку .exe у каждого
 *  друга — плохая идея. */
const DEFAULT_URL = "https://45.130.42.77.sslip.io";

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
/** Выходим по-настоящему, а не прячемся в трей. */
let quitting = false;

const iconPath = () => path.join(__dirname, "build", "icon.ico");

function createWindow({ hidden = false } = {}) {
  const url = readUrl();

  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    // Окно появляется уже с содержимым: без этого секунду видно
    // белый прямоугольник, и запуск выглядит как сбой.
    show: false,
    backgroundColor: "#16171a",
    title: "Мессенджер",
    icon: iconPath(),
    // Своя шапка вместо системной полосы — но кнопки окна родные.
    //
    // Не frame: false: нарисованные самим приложением кнопки ломают
    // Snap Layouts (всплывающие раскладки при наведении на «развернуть»)
    // и двойной щелчок по краю. titleBarOverlay оставляет кнопки
    // системе и отдаёт нам только цвет и остальную полосу.
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0b0c0e",
      symbolColor: "#d3d6db",
      height: 40,
    },
    webPreferences: {
      // Страница не получает доступа ни к Node, ни к внутренностям
      // Electron. Мост из preload — единственное, что ей доступно,
      // и он сам сверяет, с нашего ли она адреса.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
      // Не засыпать, оказавшись позади.
      //
      // По умолчанию Chromium перестаёт рисовать окно, которое ничем
      // не видно, и замедляет в нём таймеры до одного раза в секунду.
      // Для вкладки браузера это разумно, для мессенджера — нет.
      //
      // Видно это было так: меняешь голосовой канал через меню поверх
      // игры — в самом меню всё меняется, а в приложении нет, и оно
      // «догоняет» ровно в тот момент, когда меню закрылось. Ничего
      // не ломалось: канал менялся честно, окно просто не
      // перерисовывалось, потому что его в этот момент никто не видел.
      //
      // Заодно чинится и то, чего никто не замечал: определение
      // «говорит» считает уровень звука по таймеру, и в свёрнутом окне
      // замедленный таймер делал кружки вокруг говорящих рваными.
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.cjs"),
      // Адрес передаём аргументом, потому что preload обязан решать
      // на месте, своя это страница или чужая.
      additionalArguments: [
        `--messenger-origin=${new URL(url).origin}`,
        `--messenger-version=${app.getVersion()}`,
      ],
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

  // Перезагрузка с клавиатуры выключена: в приложении это привычка
  // из браузера, а не действие. Случайное нажатие посреди разговора
  // выбрасывало из него. Гасим явно, не полагаясь на то, что пункта
  // меню больше нет.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const reload =
      input.key === "F5" || ((input.control || input.meta) && input.key.toLowerCase() === "r");
    if (reload) event.preventDefault();
  });

  // Скрытый запуск — окно не показываем вовсе. Показать и сразу
  // спрятать нельзя: получается заметный мигающий кадр при каждом
  // входе в Windows.
  if (!hidden) win.once("ready-to-show", () => win.show());

  // Обработчики держатся за само окно, а не за переменную win: при
  // смене адреса окно пересоздаётся, и переменная успевает указать
  // на другое, пока старое ещё доживает свои события.
  const self = win;

  // Кнопка «развернуть» — системная, и клиент о её нажатии сам
  // не узнает. А отступы в шапке от этого зависят.
  const tellMaximized = () => self.webContents.send("window:maximized", self.isMaximized());
  self.on("maximize", tellMaximized);
  self.on("unmaximize", tellMaximized);

  // Крестик прячет окно, а не закрывает приложение: разговор
  // продолжается, уведомления приходят. Настоящий выход — из трея.
  self.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    self.hide();
  });

  // Окно всё-таки уничтожили — забываем ссылку. Она переживала окно
  // и превращалась в мину: следующее «покажи окно» падало на мёртвом
  // объекте, и мессенджер переставал открываться совсем.
  self.on("closed", () => {
    if (win === self) win = null;
  });

  void win.loadURL(url);

  // Обновление могло докачаться, пока окна не было. Тогда кнопка
  // в углу должна появиться сразу, а не после следующей проверки.
  self.webContents.on("did-finish-load", () => {
    if (updateReady) self.webContents.send("update:ready", updateReady);
  });

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
  if (response !== 1) return;

  writeUrl(DEFAULT_URL);
  // Окно пересоздаём, а не просто грузим другой адрес: preload узнаёт
  // разрешённый origin из аргументов, а они задаются один раз при
  // создании окна. После простой перезагрузки мост остался бы настроен
  // на прежний адрес — то есть не появился бы вовсе.
  const old = win;
  win = null;
  old.destroy();
  createWindow();
}

/* ── Трей ───────────────────────────────────────────────────────────
 *
 * Приложение живёт после закрытия окна: разговор не обрывается,
 * сообщения приходят, значок показывает непрочитанное. Ровно этим
 * приложение и отличается от вкладки браузера, которую закрыли.
 */

let tray = null;

/** Идёт ли разговор — для пункта «Меню разговора» в трее. Отдельной
 *  переменной, потому что меню трея собирается разом и о состоянии
 *  разговора узнаёт только в этот момент. */
let trayInCall = false;

function showWindow() {
  // Пока идёт запуск, главного окна ещё нет — и создавать его отсюда
  // нельзя: startup() создаст своё, и окон окажется два. Нажали
  // на значок в трее в этот момент — поднимаем окно запуска, оно
  // и есть ответ на вопрос «оно вообще запускается?».
  if (starting) {
    if (splashWin && !splashWin.isDestroyed()) splashWin.focus();
    return;
  }
  // Уничтоженное окно — это то же самое, что его отсутствие, и лечится
  // тем же: новым окном.
  //
  // Проверка не лишняя, а выстраданная. Окно уничтожается, когда
  // человек нажимает «перезапустить» в окне обновления: Electron
  // закрывает все окна и передаёт дело установщику. Если установщик
  // почему-то не подхватился, приложение остаётся жить — с мёртвой
  // ссылкой. Дальше любое нажатие на ярлык или значок в трее падало
  // с «Object has been destroyed», и открыть мессенджер было нельзя
  // вообще ничем, кроме снятия задачи.
  if (!win || win.isDestroyed()) return createWindow();
  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

function setupTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath()));
  tray.setToolTip("Мессенджер");
  tray.on("click", showWindow);
  tray.on("double-click", showWindow);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Открыть мессенджер", click: showWindow },
      // Второй путь к меню разговора, мимо горячей клавиши. Её может
      // забрать другая программа или сама игра — и тогда клавиша молча
      // перестаёт работать, а понять, что случилось, неоткуда.
      { label: "Меню разговора", enabled: trayInCall, click: () => openOverlayMenu() },
      // Единственный оставшийся способ перезагрузить окно: сюда
      // не попадёшь случайным нажатием клавиши.
      { label: "Перезагрузить окно", click: () => win?.reload() },
      { type: "separator" },
      {
        label: "Запускать вместе с Windows",
        type: "checkbox",
        checked: isAutostart(),
        click: (item) => {
          setAutostart(item.checked);
          refreshTrayMenu();
        },
      },
      { type: "separator" },
      {
        label: "Выход",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

/* ── Запуск вместе с Windows ──────────────────────────────────────── */

function isAutostart() {
  return app.getLoginItemSettings().openAtLogin;
}

function setAutostart(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    // Свёрнутым: приложение, разворачивающееся во весь экран при
    // каждом входе в систему, выключают в первый же день.
    args: ["--hidden"],
  });
}

/* ── Уведомления ──────────────────────────────────────────────────── */

/**
 * Картинка для уведомления.
 *
 * Аватар приходит из окна готовым png в виде данных: там его есть чем
 * нарисовать, а здесь — нечем. Аватары лежат в webp, и nativeImage
 * такие не открывает вовсе; плюс у кого аватара нет, нужен кружок
 * с буквой, а рисовать его в оболочке пришлось бы второй раз.
 *
 * Всё, что пришло не тем, чем ожидалось, молча заменяем иконкой
 * приложения: уведомление без картинки лучше, чем уведомление,
 * упавшее на картинке.
 */
function notificationIcon(icon) {
  if (typeof icon !== "string" || !icon.startsWith("data:image/png;base64,")) return iconPath();
  try {
    const image = nativeImage.createFromDataURL(icon);
    return image.isEmpty() ? iconPath() : image;
  } catch {
    return iconPath();
  }
}

function notify({ title, body, channelId, icon }) {
  if (!Notification.isSupported()) return;

  const notification = new Notification({
    title: String(title ?? "Мессенджер").slice(0, 120),
    body: String(body ?? "").slice(0, 400),
    icon: notificationIcon(icon),
    silent: false,
  });

  notification.on("click", () => {
    showWindow();
    if (channelId) win?.webContents.send("open-channel", String(channelId));
  });

  notification.show();

  // Подсветка кнопки в панели задач: уведомление живёт секунды,
  // а вернувшийся через полчаса человек должен увидеть, что его звали.
  if (win && !win.isFocused()) win.flashFrame(true);
}

/* ── Рация ────────────────────────────────────────────────────────── */
//
// Честное «говорить, пока нажата» Electron не умеет: globalShortcut
// сообщает о нажатии и молчит об отпускании. Обходимся автоповтором —
// Windows шлёт горячую клавишу снова и снова, пока её держат. Значит
// «отпустили» — это «повторы прекратились».
//
// Отсюда хвост: микрофон закрывается не мгновенно, а через
// PTT_RELEASE_MS после отпускания. Небольшой хвост даже полезен —
// он не срезает концы слов. Но если в системе выставлена большая
// задержка автоповтора, удержание будет срываться; на этот случай
// есть режим «переключать», где нажатие просто меняет состояние.

const PTT_RELEASE_MS = 450;

let pttMode = "off";
let pttKey = null;
let pttTimer = null;
let pttActive = false;

function pttSend(active) {
  if (pttActive === active) return;
  pttActive = active;
  win?.webContents.send("ptt", active);
}

function pttTriggered() {
  if (pttMode === "toggle") return pttSend(!pttActive);

  pttSend(true);
  if (pttTimer) clearTimeout(pttTimer);
  pttTimer = setTimeout(() => pttSend(false), PTT_RELEASE_MS);
}

/** Возвращает, удалось ли занять клавишу: её мог забрать кто-то другой,
 *  и молча притвориться, что рация работает, нельзя. */
function setPushToTalk({ mode, accelerator }) {
  if (pttKey) {
    globalShortcut.unregister(pttKey);
    pttKey = null;
  }
  if (pttTimer) clearTimeout(pttTimer);
  pttSend(false);

  pttMode = mode === "hold" || mode === "toggle" ? mode : "off";
  if (pttMode === "off" || !accelerator) return { ok: true, mode: pttMode };

  try {
    const ok = globalShortcut.register(accelerator, pttTriggered);
    if (!ok) return { ok: false, reason: "Клавишу уже занимает другая программа" };
    pttKey = accelerator;
    return { ok: true, mode: pttMode };
  } catch {
    return { ok: false, reason: "Windows не принял такое сочетание" };
  }
}

/* ── Обработчики моста ────────────────────────────────────────────── */

function setupBridge() {
  ipcMain.on("window:minimize", () => win?.minimize());
  ipcMain.on("window:toggle-maximize", () => {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on("window:hide", () => win?.hide());

  /** Полноэкранный режим — самим окном, а не средствами страницы.
   *
   *  Страничный полноэкранный режим в приложении и мигал, и оставлял
   *  поля: Chromium переключает при этом собственный слой отрисовки,
   *  а окно у нас и так своё. Окно во весь экран делает ровно то,
   *  чего от него ждут, и без единого кадра черноты. */
  ipcMain.on("window:fullscreen", (_event, on) => {
    if (!win || win.isDestroyed()) return;
    win.setFullScreen(Boolean(on));
  });
  ipcMain.handle("window:is-maximized", () => Boolean(win?.isMaximized()));

  ipcMain.on("badge:set", (_event, { count, icon }) => {
    if (!win) return;
    // На Windows нет счётчика на значке — есть наложение поверх него.
    // Картинку рисует preload: в главном процессе рисовать нечем.
    win.setOverlayIcon(
      icon ? nativeImage.createFromDataURL(icon) : null,
      count > 0 ? `Непрочитанных: ${count}` : "",
    );
    if (count === 0) win.flashFrame(false);
  });

  ipcMain.on("notify", (_event, data) => notify(data ?? {}));

  ipcMain.handle("autostart:get", () => isAutostart());
  ipcMain.handle("autostart:set", (_event, enabled) => {
    setAutostart(Boolean(enabled));
    refreshTrayMenu();
    return isAutostart();
  });

  ipcMain.handle("ptt:set", (_event, options) => setPushToTalk(options ?? {}));

  ipcMain.on("overlay:set", (_event, data) => setOverlay(data ?? {}));

  /** Что сейчас запущено — чтобы игру выбирали из списка, а не
   *  вписывали имя файла по памяти.
   *
   *  Отдаём не всё подряд: полный список — это полторы сотни служб
   *  Windows, среди которых игру не найти. Игра — самое прожорливое,
   *  что есть на машине, поэтому сортируем по памяти и отсекаем
   *  заведомо системное. */
  ipcMain.handle("apps:list", async () => {
    const [rows, titles] = await Promise.all([runningProcesses(), windowTitles()]);
    return pickable(rows).map((row) => ({
      ...row,
      title: titles.get(row.name.replace(/\.exe$/i, "").toLowerCase()),
    }));
  });

  /** Какая игра идёт прямо сейчас.
   *
   *  Про запуск и закрытие мессенджер узнаёт сам, без вопросов. Спросить
   *  нужно ровно в одном случае: связь оборвалась и поднялась заново,
   *  а игра всё это время шла та же самая — сказать о ней было нечего,
   *  и у друзей она пропала. */
  ipcMain.handle("game:current", () => currentGame);

  /** Сколько человек не трогал мышь и клавиатуру — во всей системе.
   *
   *  Для статуса «неактивен». Считать по событиям самой страницы
   *  нельзя: играющий в полноэкранную игру не трогает мессенджер
   *  часами и выглядел бы отошедшим ровно тогда, когда он на месте
   *  и ждёт, пока друзья соберутся в разговор. */
  ipcMain.handle("system:idle", () => powerMonitor.getSystemIdleTime());

  /** Вышла новая версия клиента — мессенджер перезапускается сам.
   *
   *  Раньше страница просто перезагружалась. В браузере это правильно,
   *  в приложении — нет: обновляется сайт, а оболочка остаётся старой,
   *  и всё нативное (оверлей, горячие клавиши, обновление самой
   *  оболочки) продолжает работать по-прежнему.
   *
   *  Если установщик новой версии уже скачан — ставим его: перезапуск
   *  всё равно предстоит, и делать его дважды незачем. */
  ipcMain.on("app:restart", () => {
    quitting = true;

    if (updateReady) {
      autoUpdater.quitAndInstall(true, true);
      // Тот же сторож, что и у кнопки «обновление готово»: установщик
      // может не подхватиться, и тогда приложение осталось бы жить
      // с закрытыми окнами — значок в трее есть, а открыть нечего.
      setTimeout(() => {
        quitting = false;
        if (!win || win.isDestroyed()) createWindow();
      }, 15_000);
      return;
    }

    app.relaunch();
    app.exit(0);
  });

  /** Нажали «обновление готово» в углу окна. */
  ipcMain.on("update:install", () => {
    if (!updateReady) return;

    // Тихая установка с автозапуском: показывать окно установщика тому,
    // кто только что попросил перезапуск, незачем.
    quitting = true;
    autoUpdater.quitAndInstall(true, true);

    // Сторож. Установщик может не подхватиться — файл занят, защитник
    // задумался, — и тогда приложение остаётся жить с закрытыми окнами:
    // значок в трее есть, а открыть нечего. Так однажды и случилось.
    setTimeout(() => {
      quitting = false;
      if (!win || win.isDestroyed()) createWindow();
      win?.webContents.send("update:ready", updateReady);
    }, 15_000);
  });

  /** Нажали кнопку в меню поверх игры.
   *
   *  Сам разговор живёт в мессенджере, поэтому здесь только пересылка.
   *  Исключение — «закрыть»: закрывать своё окно главный процесс умеет
   *  и сам, гонять это через мессенджер и обратно незачем. */
  ipcMain.on("overlay:action", (event, action) => {
    // Только от своего меню: чужая страница до этого канала дотянуться
    // не должна, а окон у нас наперечёт.
    if (!menuWin || event.sender !== menuWin.webContents) return;
    if (!action || typeof action !== "object") return;

    if (action.type === "close") {
      closeOverlayMenu();
      return;
    }

    win?.webContents.send("overlay:action", action);

    // Вышли из разговора — меню больше не о чем. Закрываем не дожидаясь
    // ответа: мессенджер пришлёт новое состояние и так, но человек уже
    // нажал «выйти» и ждёт, что экран освободится.
    if (action.type === "leave") closeOverlayMenu();

    // Начинают показ — список источников покажем здесь же, в меню,
    // а не в мессенджере: человек сейчас в игре, и выводить ради
    // выбора окно на весь экран — ровно то, чего оверлей должен
    // избегать.
    if (action.type === "screen" && !overlayState.sharing) pickInOverlay = true;
  });
}

/* ── Оверлей поверх игры ────────────────────────────────────────────
 *
 * Два окна с разными обязанностями.
 *
 * Первое — маленькое окошко в углу: кто в разговоре и кто сейчас
 * говорит. Висит всё время разговора, сквозное для мыши, фокуса
 * не берёт. Ради него мессенджер и держат запущенным во время игры.
 *
 * Второе — меню по горячей клавише: экран затемняется, и оттуда можно
 * выключить микрофон, звук, выйти из разговора, подкрутить громкость
 * каждому и перейти в соседний канал. Оно ловит мышь и забирает фокус,
 * поэтому создаётся на время и закрывается насовсем. Разделены они
 * именно поэтому: то, что перехватывает мышь на весь экран, не должно
 * висеть постоянно — если что-то пойдёт не так, закроется меню,
 * а окошко останется таким же безобидным.
 *
 * Честное ограничение: поверх ИСКЛЮЧИТЕЛЬНОГО полноэкранного режима
 * не рисуется ни то, ни другое — там игра владеет экраном целиком
 * и Windows поверх неё ничего не пускает. Работает поверх «оконного
 * без рамки» (borderless), на котором сидит большинство. Отключить —
 * в настройках приложения.
 */

let overlayWin = null;
let menuWin = null;

/** Последнее, что прислал мессенджер.
 *
 *  Меню открывается клавишей в произвольный момент, когда никто ничего
 *  не присылал, — и нарисовать ему что-то надо сразу. Спрашивать
 *  у мессенджера в этот момент значило бы показывать пустое окно
 *  первые полкадра. */
let overlayState = { inCall: false, hudMode: "always", games: [], people: [], channels: [] };

/** Размер окошка при обычном масштабе. Высота — потолок: страница
 *  внутри короче, а лишнее прозрачно. */
const OVERLAY_BASE = { width: 260, height: 264 };

/** Отступ от края экрана. Ноль смотрелся бы приклеенным, а в играх
 *  у самого края обычно и стоит своё. */
const OVERLAY_GAP = 12;

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

function overlaySize() {
  const scale = Number(overlayState.scale) || 1;
  return {
    width: Math.round(OVERLAY_BASE.width * scale),
    height: Math.round(OVERLAY_BASE.height * scale),
  };
}

/** Куда поставить окошко.
 *
 *  Положение приходит долей свободного места, а не точкой в пикселях:
 *  у монитора дома и у монитора на даче разное разрешение, и окошко,
 *  поставленное в угол на одном, должно оказаться в углу и на другом. */
/** Последние выставленные границы. Состояние приезжает по десять раз
 *  в секунду, пока кто-то говорит, и двигать окно на каждое такое
 *  обновление — это лишняя работа оконному менеджеру и заметное
 *  подрагивание окна на слабых машинах. */
let placedAt = "";

function placeOverlay() {
  if (!overlayWin) return;
  const { workArea } = screen.getPrimaryDisplay();
  const size = overlaySize();
  const pos = overlayState.pos ?? { x: 0, y: 0 };
  const freeX = Math.max(0, workArea.width - size.width - OVERLAY_GAP * 2);
  const freeY = Math.max(0, workArea.height - size.height - OVERLAY_GAP * 2);

  const bounds = {
    ...size,
    x: workArea.x + OVERLAY_GAP + Math.round(freeX * clamp01(pos.x)),
    y: workArea.y + OVERLAY_GAP + Math.round(freeY * clamp01(pos.y)),
  };

  const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
  if (key === placedAt) return;
  placedAt = key;
  overlayWin.setBounds(bounds);
}

function createOverlay() {
  if (overlayWin) return overlayWin;

  overlayWin = new BrowserWindow({
    ...overlaySize(),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    // Не отбирать фокус у игры ни при каких обстоятельствах: единственный
    // способ испортить человеку перестрелку — увести у него курсор.
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    // Не участвует в захвате экрана: показывая игру друзьям, показывать
    // им же список говорящих незачем — он у них свой.
    webPreferences: {
      preload: path.join(__dirname, "overlay-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // "screen-saver" — самый высокий уровень: обычного alwaysOnTop
  // не хватает, поверх полноэкранных окон он уходит вниз.
  overlayWin.setAlwaysOnTop(true, "screen-saver");
  // Сквозное для мыши: окно висит поверх игры и не должно перехватывать
  // ни одного щелчка. forward — чтобы наведение всё же доходило до игры.
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.setContentProtection(true);

  void overlayWin.loadFile(path.join(__dirname, "overlay.html"));

  // Состояние отдаём сразу, как страница отрисовалась.
  //
  // Без этого окошко оставалось пустым, а значит невидимым: фон
  // у него прозрачный, рисовать без списка нечего. Рассылка состояния
  // идёт раньше, чем окно создаётся, — на первом обновлении рассылать
  // ещё некуда, а второго можно ждать сколько угодно, если в разговоре
  // все молчат. Меню при этом список показывало, потому что просит
  // состояние само, когда открывается, — отсюда и «видно только
  // по клавише».
  overlayWin.webContents.on("did-finish-load", () => {
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.webContents.send("overlay:state", overlayState);
    }
  });

  overlayWin.on("closed", () => {
    overlayWin = null;
    // Запомненные границы относились к тому окну, которого больше нет.
    // Не сбросить — и новое окошко осталось бы стоять там, где его
    // создали, потому что «двигать не надо, оно уже там».
    placedAt = "";
  });

  return overlayWin;
}

/* ── Запущена ли игра ───────────────────────────────────────────────
 *
 * Окошко нужно не всегда. Сидя в переписке, человек и так видит, кто
 * говорит, — а поверх браузера или документа список висит просто так
 * и мешает.
 *
 * Честно определить «идёт игра» нельзя: в игру мы не встраиваемся,
 * а спросить у Windows «это игра?» негде — она сама этого не знает.
 * Поэтому спрашиваем у человека, какие у него игры, и просто смотрим,
 * запущено ли что-то из названного. Скучно, зато не врёт и работает
 * с любой игрой, включая ту, о которой никто не слышал.
 *
 * Смотрим только во время разговора: вне его окошко не появится
 * в любом случае, и опрашивать список процессов незачем.
 */

const {
  runningProcesses,
  anyRunning,
  pickable,
  windowTitles,
  hasWindow,
  steamGame,
} = require("./games.cjs");

/** Как часто смотреть, что запущено.
 *
 *  В разговоре чаще: от этого зависит окошко поверх игры, и появиться
 *  оно должно к началу игры, а не спустя полминуты. Вне разговора
 *  спешить некуда — там это нужно только строчке «играет в …»
 *  в чужих списках, и четверть минуты там никто не заметит. */
const GAME_CHECK_MS = 5000;
const GAME_IDLE_MS = 15_000;

let gameTimer = null;
/** С каким шагом идёт нынешний таймер: чтобы не пересоздавать его
 *  на каждое обновление состояния, а их десятки в минуту. */
let gameEvery = 0;
let gameRunning = false;
/** Какая именно игра запущена. Нужна не только окошку: во что человек
 *  играет, видят друзья в своих списках. */
let currentGame = null;

/** Ответ «есть ли окно» и когда он получен. Спрашивать это на каждом
 *  шаге нельзя — пол секунды на запрос, — а меняется оно редко. */
let windowSeen = { name: null, open: false, at: 0 };
const WINDOW_TTL = 15_000;

async function checkGame() {
  // Сначала Steam. Он сам записывает, что запустил, сам стирает запись
  // при выходе и знает настоящее название — это точнее любого списка
  // имён файлов и работает с любой игрой, включая вышедшую вчера.
  const steam = await steamGame();
  if (steam) {
    windowSeen = { name: null, open: false, at: 0 };
    setGame(steam);
    return;
  }

  const wanted = overlayState.games ?? [];
  if (wanted.length === 0) {
    setGame(null);
    return;
  }

  // Множеством, а не перебором: известных игр под две сотни, запущенного
  // на машине столько же, и перебирать одно по другому пришлось бы
  // сорок тысяч раз каждые несколько секунд.
  const running = new Set((await runningProcesses()).map((row) => row.name.toLowerCase()));
  const found = wanted.find((name) => running.has(String(name).toLowerCase())) ?? null;

  if (!found) {
    windowSeen = { name: null, open: false, at: 0 };
    setGame(null);
    return;
  }

  // Процесс есть — но это ещё не значит, что играют. Roblox, лаунчеры
  // и половина игр остаются висеть в трее после выхода: память занята,
  // окна нет, а друзьям писали, что человек играет. Спрашиваем окно.
  const now = Date.now();
  const stale = windowSeen.name !== found || now - windowSeen.at > WINDOW_TTL;
  if (stale) {
    windowSeen = { name: found, open: await hasWindow(found), at: now };
  }

  setGame(windowSeen.open ? found : null);
}

function setGame(name) {
  const running = Boolean(name);
  const changed = currentGame !== (name ?? null);
  currentGame = name ?? null;

  if (gameRunning !== running) {
    gameRunning = running;
    // Показать или спрятать окошко прямо сейчас: следующего обновления
    // от мессенджера можно ждать долго, если все молчат.
    applyHud();
  }

  // Мессенджеру — название: он один умеет разговаривать с сервером
  // и знает, как эта игра называется по-человечески.
  if (changed) win?.webContents.send("game:changed", currentGame);
}

/**
 * Следим за играми, пока в списке хоть что-то есть.
 *
 * Раньше следили только во время разговора и только в режиме
 * «показывать окошко в игре» — потому что больше это никому не было
 * нужно. Теперь нужно: во что человек играет, видят друзья, и видеть
 * они это должны и тогда, когда он ни с кем не говорит.
 */
function watchGames() {
  const need = (overlayState.games ?? []).length > 0;
  const every = overlayState.inCall ? GAME_CHECK_MS : GAME_IDLE_MS;
  if (need === Boolean(gameTimer) && every === gameEvery) return;

  if (gameTimer) {
    clearInterval(gameTimer);
    gameTimer = null;
  }

  if (!need) {
    gameEvery = 0;
    setGame(null);
    return;
  }

  gameEvery = every;
  void checkGame();
  gameTimer = setInterval(() => void checkGame(), every);
}

/** Разослать состояние в оба окна. Окно, которое ещё грузится,
 *  получит его сразу после загрузки: иначе первое состояние теряется,
 *  и меню открывается пустым. */
function pushOverlayState() {
  for (const target of [overlayWin, menuWin]) {
    if (!target || target.isDestroyed()) continue;
    const send = () => {
      if (!target.isDestroyed()) target.webContents.send("overlay:state", overlayState);
    };
    if (target.webContents.isLoading()) target.webContents.once("did-finish-load", send);
    else send();
  }
}

/**
 * Показать, обновить или убрать оверлей.
 *
 * Решение «нужен ли он сейчас» принимает клиент: он один знает, идёт ли
 * разговор и что стоит в настройках. Сюда приходит уже готовый ответ.
 */
function setOverlay(data) {
  overlayState = {
    inCall: Boolean(data.inCall),
    hudMode: ["always", "game", "never"].includes(data.hudMode) ? data.hudMode : "always",
    games: Array.isArray(data.games) ? data.games : [],
    people: Array.isArray(data.people) ? data.people : [],
    channels: Array.isArray(data.channels) ? data.channels : [],
    channelName: String(data.channelName ?? ""),
    muted: Boolean(data.muted),
    deafened: Boolean(data.deafened),
    sharing: Boolean(data.sharing),
    pos: data.pos ?? { x: 0, y: 0 },
    scale: Number(data.scale) || 1,
    key: typeof data.key === "string" ? data.key : null,
  };

  applyOverlayKey();
  pushOverlayState();

  // Пункт в трее включается и гаснет вместе с разговором. Пересобираем
  // меню только на переключении: состояние приезжает по десять раз
  // в секунду, пока кто-то говорит.
  if (trayInCall !== overlayState.inCall) {
    trayInCall = overlayState.inCall;
    refreshTrayMenu();
  }

  // Разговор кончился — окно меню убираем совсем: держать поверх
  // экрана кнопки от разговора, которого нет, нельзя. Начался —
  // готовим его заранее, чтобы по клавише оно появлялось мгновенно,
  // а не запускалось.
  if (overlayState.inCall) ensureMenu();
  else dropMenu();

  watchGames();
  applyHud();
}

/** Нужно ли окошко прямо сейчас. */
function hudWanted() {
  if (!overlayState.inCall || overlayState.people.length === 0) return false;
  if (overlayState.hudMode === "never") return false;
  if (overlayState.hudMode === "game") return gameRunning;
  return true;
}

/** Показать или спрятать окошко. Отдельно от setOverlay, потому что
 *  причин передумать две: пришло новое состояние от мессенджера
 *  и запустилась или закрылась игра. */
function applyHud() {
  if (!hudWanted()) {
    overlayWin?.hide();
    return;
  }

  const overlay = createOverlay();
  placeOverlay();

  // Пока открыто меню, окошко спрятано нарочно: в меню его рисует
  // сама страница, и два одинаковых списка на экране — это ошибка,
  // а не подсказка. Проверяем «открыто», а не «существует»: окно меню
  // теперь живёт весь разговор, просто спрятанное.
  if (!menuOpen && !overlay.isVisible()) {
    // showInactive, а не show: обычный show забирает фокус, и человек
    // вылетает из игры каждый раз, когда кто-то заходит в разговор.
    overlay.showInactive();
  }
}

/* ── Меню оверлея ─────────────────────────────────────────────────── */

/** Клавиша занята, только пока идёт разговор. Держать её занятой всё
 *  время работы приложения — значит отбирать её у игр без надобности,
 *  причём молча: занятая горячая клавиша до игры просто не доходит. */
let overlayKey = null;

function applyOverlayKey() {
  const wanted = overlayState.inCall ? overlayState.key : null;
  if (overlayKey === wanted) return;

  if (overlayKey) {
    globalShortcut.unregister(overlayKey);
    overlayKey = null;
  }
  if (!wanted) return;

  try {
    // Не вышло — молчим: клавишу мог занять кто-то другой, и падать
    // из-за этого посреди разговора незачем. Меню всё равно
    // открывается из самого мессенджера.
    if (globalShortcut.register(wanted, toggleOverlayMenu)) overlayKey = wanted;
  } catch {
    // Windows не принял сочетание.
  }
}

/** Открыто ли меню сейчас. Не по существованию окна: окно живёт весь
 *  разговор, просто спрятанное. */
let menuOpen = false;
/** Когда показали — чтобы не закрыться от собственного мелькания
 *  фокуса в момент показа. */
let menuShownAt = 0;
let menuHideTimer = null;

function toggleOverlayMenu() {
  if (menuOpen) closeOverlayMenu();
  else openOverlayMenu();
}

/**
 * Приготовить окно меню заранее.
 *
 * Раньше окно создавалось и грузило страницу на каждое нажатие
 * клавиши — и это было видно: меню открывалось как отдельно
 * запускающееся приложение, с паузой и рывком. У дискорда оверлей
 * появляется мгновенно ровно потому, что появляться там нечему:
 * всё уже готово и просто показывается.
 *
 * Поэтому окно делается один раз на разговор, спрятанным. Спрятанное
 * окно ничего не перехватывает и никому не мешает; закрывается оно
 * вместе с разговором.
 */
function ensureMenu() {
  if (menuWin && !menuWin.isDestroyed()) return menuWin;

  menuWin = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    // Тени и рамки нет, в панели задач не показывается, фокус берёт
    // только когда открыто.
    webPreferences: {
      preload: path.join(__dirname, "overlay-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  menuWin.setAlwaysOnTop(true, "screen-saver");
  menuWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Показывая экран друзьям, показывать им же своё меню незачем.
  menuWin.setContentProtection(true);

  void menuWin.loadFile(path.join(__dirname, "overlay-menu.html"));

  // Ушли в другое окно — закрываемся. Меню на весь экран, которое
  // осталось висеть поверх всего и при этом не в фокусе, — это
  // запертый человек; лучше лишний раз закрыться.
  //
  // Задержка обязательна: на Windows окно успевает моргнуть фокусом
  // в момент показа, и без неё меню закрывалось бы само, не успев
  // открыться.
  menuWin.on("blur", () => {
    if (menuOpen && Date.now() - menuShownAt > 400) closeOverlayMenu();
  });

  menuWin.on("closed", () => {
    menuWin = null;
    menuOpen = false;
    applyHud();
  });

  return menuWin;
}

function openOverlayMenu() {
  if (menuOpen || !overlayState.inCall) return;

  const menu = ensureMenu();
  clearTimeout(menuHideTimer);

  // Экран тот, где сейчас курсор: у кого два монитора, игра идёт
  // на одном, а мессенджер лежит на другом. Границы выставляем
  // на каждое открытие: монитор мог смениться с прошлого раза.
  // bounds, а не workArea: workArea — это экран без панели задач,
  // и по её высоте затемнение обрывалось, оставляя внизу светлую
  // полосу. Меню и так поверх всего, панель задач ему не помеха.
  const { bounds } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  menu.setBounds(bounds);

  // Окошко на время убираем: его же список рисует само меню.
  overlayWin?.hide();

  menuOpen = true;
  menuShownAt = Date.now();
  pushOverlayState();

  // Сначала показываем — страница в этот момент ещё полностью
  // прозрачна, видеть нечего, — и только потом просим её проявиться.
  // В обратном порядке проявление успевало пройти, пока окно
  // спрятано, и меню возникало рывком, без всякого появления.
  menu.show();
  menu.focus();
  setTimeout(() => {
    if (menuOpen && menuWin && !menuWin.isDestroyed()) {
      menuWin.webContents.send("overlay:open");
    }
  }, 16);
}

/** Закрыть меню. Не уничтожая окно: оно понадобится через минуту,
 *  а пересоздание — это та самая «новая страничка». */
function closeOverlayMenu() {
  if (!menuOpen) return;
  menuOpen = false;

  if (!menuWin || menuWin.isDestroyed()) return;

  // Сначала просим страницу погаснуть, прячем следом. Ждать её ответа
  // не надо: если она почему-то не ответит, окно всё равно спрячется
  // по таймеру.
  menuWin.webContents.send("overlay:hide");
  clearTimeout(menuHideTimer);
  menuHideTimer = setTimeout(() => {
    if (menuWin && !menuWin.isDestroyed()) menuWin.hide();
    applyHud();
  }, 140);
}

/** Убрать окно меню совсем — разговор кончился. */
function dropMenu() {
  menuOpen = false;
  clearTimeout(menuHideTimer);
  if (menuWin && !menuWin.isDestroyed()) menuWin.destroy();
  menuWin = null;
}

/* ── Показ экрана ───────────────────────────────────────────────────
 *
 * В браузере окно «что показать» рисует сам браузер. В Electron его
 * нет вовсе: без обработчика getDisplayMedia просто не срабатывает,
 * и кнопка показа экрана в оболочке молча ничего не делает. Поэтому
 * список источников и окно выбора — наши.
 *
 * Звук берём через loopback: без него показ игры или ролика идёт
 * немой, а это ровно то, что обычно и показывают.
 */

function setupScreenSharing() {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      void showPicker().then((source) => {
        // Пустой объект — отказ. Человек закрыл окно выбора,
        // и это не ошибка.
        callback(source ? { video: source, audio: "loopback" } : {});
      });
    },
    // Системное окно Windows умеет не всё, что нам нужно, и выглядит
    // чужим внутри приложения.
    { useSystemPicker: false },
  );
}

/** Выбор источника. Возвращает его или null, если человек передумал.
 *
 *  Рисует выбор сам мессенджер, внутри своего окна. Раньше здесь
 *  открывалось отдельное окно системы — со своей рамкой, своим
 *  заголовком и своей иконкой в панели задач. Посреди приложения оно
 *  выглядело как чужая программа, а заголовок «Что показать» ещё и
 *  дублировался: один раз в рамке окна, второй раз внутри. */
/** Где рисовать выбор источника. Ставится, когда показ начали
 *  из меню поверх игры: выводить ради выбора мессенджер на весь
 *  экран посреди боя — это ровно то, чего оверлей должен избегать. */
let pickInOverlay = false;

async function showPicker() {
  // Кому показывать список. Из меню поверх игры — ему же: человек
  // сейчас в игре, и всё должно происходить там, где он смотрит.
  const overlayReady = menuOpen && menuWin && !menuWin.isDestroyed();
  const target = pickInOverlay && overlayReady ? menuWin : win;
  if (!target) {
    pickInOverlay = false;
    return null;
  }

  // Просили показать в меню, а меню за это время закрылось — успели
  // уйти в другое окно, пока собирались миниатюры. Список уедет
  // в мессенджер, и его надо вывести вперёд: иначе окно выбора
  // окажется под игрой, ответа не будет никогда, и показ повиснет
  // молча — вместе со всеми следующими попытками его начать.
  if (pickInOverlay && !overlayReady) showWindow();

  // Миниатюры поменьше. Снимок каждого открытого окна делает сам
  // Windows, и делает это в главном процессе: пока он снимает два
  // десятка окон по 320 точек, приложение не отвечает — на что
  // и жаловались, «мышь залипает при нажатии на кнопку показа».
  // На 160 точках разница в качестве не видна, а ждать втрое меньше.
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 160, height: 90 },
    fetchWindowIcons: false,
  });

  // Сжимаем по одной, отпуская между ними управление: два десятка
  // картинок подряд — это заметный кусок времени, за который окно
  // не успевает даже перерисовать курсор.
  const list = [];
  for (const source of sources) {
    list.push({
      id: source.id,
      name: source.name,
      kind: source.id.startsWith("screen:") ? "screen" : "window",
      // JPEG, а не PNG: миниатюр бывает два десятка, и разница между
      // парой мегабайт и парой сотен килобайт заметна на глаз —
      // окно выбора не должно открываться с задержкой.
      thumbnail: `data:image/jpeg;base64,${source.thumbnail.toJPEG(60).toString("base64")}`,
    });
    await new Promise((resolve) => setImmediate(resolve));
  }

  target.webContents.send("screen:pick", list);

  const id = await new Promise((resolve) => {
    const done = (_event, value) => {
      ipcMain.off("screen:picked", done);
      resolve(value ?? null);
    };
    ipcMain.on("screen:picked", done);
  });

  pickInOverlay = false;

  // Выбрали из меню поверх игры — меню своё дело сделало, и человек
  // ждёт, что экран освободится. Передумали — меню остаётся, ему
  // ещё могут что-то поручить.
  if (target === menuWin && id) closeOverlayMenu();

  if (!id) return null;
  // Спрашиваем список заново: между показом и выбором окно могли
  // закрыть, и отдавать исчезнувший источник нельзя.
  const fresh = await desktopCapturer.getSources({ types: ["screen", "window"] });
  return fresh.find((source) => source.id === id) ?? null;
}

/* ── Автообновление оболочки ────────────────────────────────────────
 *
 * Обновляется только .exe: сам мессенджер живёт на сервере и доезжает
 * до всех сам, при перезапуске окна. Оболочку же приходится доставлять
 * файлом — и просить друзей раз в месяц что-то перекачивать вручную
 * значит гарантированно получить трёх человек на разных версиях.
 *
 * Файлы берём с GitHub, а не со своего сервера: обновление весит под
 * сотню мегабайт, и гонять его через туннель — тратить общий канал
 * ради того, что бесплатно раздаёт GitHub.
 */

const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;

/* ── Окно запуска ───────────────────────────────────────────────────
 *
 * Появляется раньше главного окна и держится, пока идёт проверка
 * обновлений.
 *
 * Раньше проверка была отложена на двадцать секунд после запуска
 * и шла молча в фоне. Выходило так: человек уже сидит в переписке,
 * и тут посреди разговора выскакивает «обновление готово,
 * перезапустить?». Соглашаться в этот момент никто не хочет —
 * и обновление откладывается до следующего раза, где повторяется
 * то же самое. Друзья месяцами живут на разных версиях.
 *
 * Правильное время обновляться — до того, как человек начал что-то
 * делать. Тогда же это и не мешает: приложение ещё не открылось,
 * терять нечего.
 */

let splashWin = null;
/** Пока true, события обновлений ведут окно запуска, а не всплывающие
 *  окна. После старта всё возвращается к прежнему поведению. */
let starting = false;

/** Сколько ждём ответа о новой версии, прежде чем плюнуть и запуститься.
 *  Сервер может быть выключен, интернета может не быть вовсе —
 *  и это не повод не пускать человека в мессенджер: он и без сети
 *  показывает сохранённую переписку. */
const UPDATE_WAIT_MS = 12_000;

/** Сколько ждать шевеления во время загрузки. Проценты идут часто,
 *  и полминуты тишины — это уже не медленная сеть, а вставшая. */
const STALLED_MS = 30_000;

const mb = (bytes) => Math.round((Number(bytes) || 0) / 1e6);

function createSplash() {
  splashWin = new BrowserWindow({
    width: 340,
    height: 400,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    center: true,
    icon: iconPath(),
    title: "Мессенджер",
    webPreferences: {
      preload: path.join(__dirname, "splash-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void splashWin.loadFile(path.join(__dirname, "splash.html"));
  splashWin.once("ready-to-show", () => {
    if (splashWin && !splashWin.isDestroyed()) splashWin.show();
  });
  splashWin.on("closed", () => {
    splashWin = null;
  });

  return splashWin;
}

/** Что написать в окне запуска. Молча ничего не делает, если окна нет:
 *  при скрытом запуске его и не создают. */
function splashSay(state) {
  if (!splashWin || splashWin.isDestroyed()) return;
  const send = () => {
    if (splashWin && !splashWin.isDestroyed()) {
      splashWin.webContents.send("splash:state", {
        version: `Версия ${app.getVersion()}`,
        icon: nativeImage.createFromPath(iconPath()).toDataURL(),
        ...state,
      });
    }
  };
  if (splashWin.webContents.isLoading()) splashWin.webContents.once("did-finish-load", send);
  else send();
}

function closeSplash() {
  if (!splashWin || splashWin.isDestroyed()) return;
  splashWin.close();
}

/**
 * Запуск: сперва обновления, потом само приложение.
 *
 * При скрытом запуске (вместе с Windows) окна запуска нет вовсе —
 * показывать его тому, кто ничего не открывал, значит выкидывать
 * окно поверх чужой работы при каждом входе в систему. Обновления
 * в этом случае проверяются как раньше, в фоне.
 */
function startup({ hidden }) {
  if (hidden || !updatesSupported()) {
    createWindow({ hidden });
    // Первую проверку откладываем: при запуске сеть занята загрузкой
    // самого мессенджера.
    setTimeout(checkUpdates, 20_000);
    setInterval(checkUpdates, UPDATE_EVERY_MS);
    return;
  }

  starting = true;
  createSplash();
  splashSay({ text: "Проверка обновлений…" });

  // Ответа может не быть никогда: сервер выключен, сеть за роутером,
  // который ещё поднимается. Ждём ограниченное время и идём дальше —
  // без сети мессенджер тоже открывается и показывает сохранённое.
  waitFor(UPDATE_WAIT_MS);
  checkUpdates();
}

/** Отложить запуск ещё немного: пришёл ответ, что-то происходит.
 *  Каждый шаг обновления переставляет этот срок заново, поэтому
 *  долгая загрузка не обрывается на середине, а зависшая — обрывается. */
let startupTimer = null;

function waitFor(ms, detail) {
  clearTimeout(startupTimer);
  startupTimer = setTimeout(() => launchApp(detail), ms);
}

/** Хватит ждать — открываем мессенджер. */
function launchApp(detail) {
  if (!starting) return;
  starting = false;
  clearTimeout(startupTimer);

  splashSay({ text: "Запуск…", detail, done: true });
  createWindow({ hidden: false });

  // Окно запуска убираем не раньше, чем главное готово показаться, —
  // иначе между ними остаётся дыра в полсекунды, когда на экране нет
  // вообще ничего и кажется, что приложение закрылось.
  win.once("ready-to-show", () => setTimeout(closeSplash, 150));
  // Страховка: не отрисовалось по какой-то причине — окно запуска
  // всё равно не должно остаться висеть навсегда.
  setTimeout(closeSplash, 20_000);

  setInterval(checkUpdates, UPDATE_EVERY_MS);
}

/** Проверку запустил человек из меню — тогда о результате надо
 *  сказать вслух. Фоновая проверка молчит: сообщение «обновлений
 *  нет» раз в шесть часов никому не нужно. */
let updateAsked = false;

/** Скачанная и ждущая версия — или null. Держим отдельно от события:
 *  окно могло ещё не открыться, когда обновление докачалось, и тогда
 *  сказать ему об этом надо при открытии. */
let updateReady = null;

function updatesSupported() {
  // В разработке обновлять нечего. Портативная сборка — один файл,
  // который человек носит с собой; подменить его на ходу нельзя,
  // и electron-updater честно это не умеет.
  return app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR;
}

function setupUpdates() {
  if (!updatesSupported()) return;

  autoUpdater.autoDownload = true;
  // Не успел человек нажать «перезапустить» — обновление всё равно
  // встанет при следующем закрытии приложения.
  autoUpdater.autoInstallOnAppQuit = true;

  // Пока идёт запуск, обо всём рассказывает окно запуска. Всплывающие
  // окна ниже — для проверок, которые случились потом, когда человек
  // уже работает.

  autoUpdater.on("update-available", (info) => {
    if (starting) {
      splashSay({ text: `Загрузка версии ${info.version}`, percent: 0 });
      // Ждём уже не ответа, а загрузки. Срок будет переставляться
      // на каждый пришедший процент.
      waitFor(STALLED_MS, "Обновление докачается в фоне");
      return;
    }
    if (!updateAsked) return;
    updateAsked = false;
    void dialog.showMessageBox(win, {
      type: "info",
      title: "Обновление",
      message: `Есть новая версия ${info.version}`,
      detail: "Скачиваю в фоне. Когда будет готово — предложу перезапустить.",
      buttons: ["Хорошо"],
    });
  });

  autoUpdater.on("download-progress", ({ percent, transferred, total }) => {
    if (!starting) return;
    splashSay({
      text: "Загрузка обновления",
      detail: `${mb(transferred)} из ${mb(total)} МБ`,
      percent,
    });
    // Пока проценты идут — ждём. Перестали идти на полминуты — значит
    // загрузка встала, и держать человека перед этим окном нельзя.
    waitFor(STALLED_MS, "Обновление докачается в фоне");
  });

  autoUpdater.on("update-not-available", () => {
    if (starting) {
      launchApp();
      return;
    }
    if (!updateAsked) return;
    updateAsked = false;
    void dialog.showMessageBox(win, {
      type: "info",
      title: "Обновление",
      message: "Установлена последняя версия",
      detail: `Версия ${app.getVersion()}.`,
      buttons: ["Хорошо"],
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    if (starting) {
      splashSay({
        text: "Установка обновления",
        detail: `Версия ${info.version}. Приложение перезапустится само.`,
        percent: 100,
      });
      // Небольшая пауза, чтобы надпись успели прочитать: установщик
      // закрывает всё мгновенно, и без неё окно просто моргает.
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 1200);
      // Если установщик почему-то не запустился — не оставляем человека
      // перед вечной надписью «установка».
      waitFor(30_000, "Обновление встанет при следующем закрытии");
      return;
    }

    // Не окном посреди экрана, а строкой в самом мессенджере.
    //
    // Вопрос «перезапустить сейчас?» приходил когда попало — посреди
    // разговора, посреди недописанного сообщения — и отвечали на него
    // не глядя. Теперь оболочка просто сообщает, что обновление
    // скачано, а решает человек: кнопка ждёт в углу окна сколько
    // угодно и ничего не перекрывает.
    updateReady = info.version;
    win?.webContents.send("update:ready", info.version);
  });

  autoUpdater.on("error", (error) => {
    // На запуске — просто идём дальше. Не проверились обновления и ладно:
    // мессенджер работает и без них, а держать человека перед окном
    // с ошибкой на старте — худшее, что можно сделать.
    if (starting) {
      launchApp("Обновления проверить не удалось");
      return;
    }

    // Молча: интернет моргнул, сервер недоступен — приложение от этого
    // не сломалось, а всплывающее окно об ошибке посреди разговора
    // раздражает сильнее, чем неустановленное обновление.
    if (!updateAsked) return;
    updateAsked = false;
    void dialog.showMessageBox(win, {
      type: "warning",
      title: "Обновление",
      message: "Не удалось проверить обновления",
      detail: String(error?.message ?? error),
      buttons: ["Закрыть"],
    });
  });

  // Первую проверку и повторные заводит startup(): на обычном запуске
  // она идёт до открытия окна и её видно, при скрытом — в фоне,
  // как раньше.
}

function checkUpdates() {
  if (!updatesSupported()) return;
  void autoUpdater.checkForUpdates().catch(() => {
    // Обработчик error выше уже всё решил.
  });
}

/** Ручная проверка из меню. */
function checkUpdatesManually() {
  if (!updatesSupported()) {
    void dialog.showMessageBox(win, {
      type: "info",
      title: "Обновление",
      message: "Эта сборка не обновляется сама",
      detail:
        "Портативная версия — один файл без установки, обновлять его на ходу нельзя. " +
        "Свежую можно скачать там же, где брали эту.",
      buttons: ["Понятно"],
    });
    return;
  }
  updateAsked = true;
  checkUpdates();
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
          // Перезагрузки страницы здесь нет намеренно.
          //
          // F5 и Ctrl+R — привычка из браузера, а приложение браузером
          // быть не должно: случайное нажатие посреди разговора
          // выбрасывало из него и обрывало связь всем собеседникам.
          // В дискорде их тоже нет.
          //
          // Способ перезагрузить окно остался — в меню значка в трее,
          // куда мимо не попадёшь.
          { label: "Проверить обновления…", click: () => checkUpdatesManually() },
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
  // Нажали ярлык, когда приложение уже висит в трее, — показать окно.
  app.on("second-instance", showWindow);

  void app.whenReady().then(() => {
    buildMenu();
    setupBridge();
    setupScreenSharing();
    setupTray();

    // Подписки на обновления заводим до запуска: startup() сразу же
    // спрашивает про новую версию, и ответ не должен прийти в пустоту.
    setupUpdates();

    // Запуск вместе с Windows — сразу в трей и без окна запуска:
    // разворачивать что-либо при каждом входе в систему никто
    // не просил.
    startup({ hidden: process.argv.includes("--hidden") });

    app.on("activate", showWindow);
  });

  // Ничего не делаем: закрытое окно — это спрятанное окно, приложение
  // продолжает работать в трее. Выход — только через меню трея,
  // и он выставляет quitting сам.
  app.on("window-all-closed", () => undefined);

  app.on("before-quit", () => {
    quitting = true;
  });

  // Чужие горячие клавиши за собой убираем: незанятая после выхода
  // клавиша иначе останется недоступной другим программам до
  // перезагрузки.
  app.on("will-quit", () => globalShortcut.unregisterAll());
}
