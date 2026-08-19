// Мост между страницей мессенджера и оболочкой.
//
// Всё, чем приложение отличается от сайта, проходит через него: трей,
// уведомления, рация, своя рамка окна. Сайт этих возможностей не
// получает и получить не может — там нет никакого моста вовсе, там
// обычная вкладка браузера.
//
// Отсюда же клиент узнаёт, где он запущен: интерфейс должен рисовать
// свою шапку в приложении и не рисовать её в браузере.

const { contextBridge, ipcRenderer } = require("electron");

/** Мост даём только своей странице.
 *
 *  Оболочка умеет открыть чужой адрес — человек может сменить адрес
 *  сервера в меню, да и ошибиться недолго. Отдать чужому сайту право
 *  вешать глобальные горячие клавиши и слать уведомления от нашего
 *  имени нельзя, поэтому origin сверяется с тем, что передал главный
 *  процесс, и при несовпадении на странице просто нет window.messenger.
 *
 *  Проверка обязана быть здесь, а не в главном процессе: preload
 *  выполняется для каждого документа, и решать надо на месте, зная
 *  адрес именно этого документа. */
const expected = process.argv
  .find((argument) => argument.startsWith("--messenger-origin="))
  ?.slice("--messenger-origin=".length);

const allowed = Boolean(expected) && location.origin === expected;

/** Кружок с числом непрочитанных поверх иконки в панели задач.
 *
 *  Рисуется здесь, а не в главном процессе: там нет холста, а класть
 *  готовые картинки на каждое число — двенадцать файлов ради того,
 *  что рисуется десятью строками. В самом клиенте ему тоже не место:
 *  это свойство панели задач Windows, а не интерфейса мессенджера. */
function drawBadge(count) {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#e05252";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  // Больше девяноста девяти — это уже «много», и точное число
  // на кружке в шестнадцать точек всё равно не прочитать.
  const label = count > 99 ? "99+" : String(count);
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${label.length > 2 ? 14 : 20}px "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, size / 2, size / 2 + 1);

  return canvas.toDataURL("image/png");
}

// Вложенные рамки исключаем отдельно: страница может открыть iframe
// с нашего же адреса, и он унаследовал бы все права главного окна.
const isMainFrame = window.top === window;

if (allowed && isMainFrame) {
  contextBridge.exposeInMainWorld("messenger", {
    isApp: true,
    version: process.argv
      .find((argument) => argument.startsWith("--messenger-version="))
      ?.slice("--messenger-version=".length),

    // ── Окно ────────────────────────────────────────────────────
    window: {
      minimize: () => ipcRenderer.send("window:minimize"),
      toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
      // Не close(): крестик прячет в трей, а не выходит.
      hide: () => ipcRenderer.send("window:hide"),
      isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
      /** Развернуть окно во весь экран — для просмотра чужого показа.
       *  Полноэкранный режим средствами страницы в приложении мигал
       *  и оставлял поля по краям. */
      setFullscreen: (on) => ipcRenderer.send("window:fullscreen", Boolean(on)),
      /** Перезапустить мессенджер целиком.
       *
       *  Нужен, когда вышла новая версия. Раньше в этом месте
       *  перезагружалась страница — но в приложении это не то же самое:
       *  перезагрузка обновляет сайт внутри старой оболочки, а сама
       *  оболочка со всем нативным (оверлей, горячие клавиши, значок
       *  в трее) остаётся прежней. Перезапуск заодно даёт установщику
       *  сделать своё дело, если обновление уже скачано. */
      restart: () => ipcRenderer.send("app:restart"),
      onMaximizedChange: (callback) => {
        const handler = (_event, value) => callback(Boolean(value));
        ipcRenderer.on("window:maximized", handler);
        return () => ipcRenderer.off("window:maximized", handler);
      },
    },

    // ── Система ─────────────────────────────────────────────────
    system: {
      /** Сколько секунд не трогали мышь и клавиатуру — во всей
       *  системе. Для статуса «неактивен»: по событиям самой страницы
       *  играющий в полноэкранную игру выглядел бы отошедшим, хотя
       *  он-то как раз на месте. */
      idleSeconds: () => ipcRenderer.invoke("system:idle"),
    },

    // ── Значок в панели задач ───────────────────────────────────
    /** Число непрочитанных. 0 — снять пометку. */
    setBadge: (count) => {
      const value = Number(count) || 0;
      ipcRenderer.send("badge:set", { count: value, icon: value > 0 ? drawBadge(value) : null });
    },

    // ── Уведомления ─────────────────────────────────────────────
    /** Показывает системное уведомление. Решение «а надо ли» остаётся
     *  за клиентом: он один знает, открыт ли этот канал и не своё ли
     *  это сообщение. */
    notify: (data) => ipcRenderer.send("notify", data),
    /** Человек щёлкнул по уведомлению — открыть нужный канал. */
    onOpenChannel: (callback) => {
      const handler = (_event, channelId) => callback(String(channelId));
      ipcRenderer.on("open-channel", handler);
      return () => ipcRenderer.off("open-channel", handler);
    },

    // ── Оверлей поверх игры ─────────────────────────────────────
    /** Всё состояние разговора разом: состав, кто говорит, громкости,
     *  каналы для перехода, где стоит окошко и какой клавишей
     *  открывать меню. Решение «показывать ли» остаётся за клиентом:
     *  только он знает, идёт ли разговор и что стоит в настройках. */
    setOverlay: (data) => ipcRenderer.send("overlay:set", data),
    /** Что сейчас запущено — для выбора игры в настройках. Самое
     *  тяжёлое сверху, системное отсеяно. */
    listApps: () => ipcRenderer.invoke("apps:list"),
    /** Запустилась или закрылась игра из списка. Приходит имя файла
     *  или null. Дальше мессенджер сам решает, как её назвать людям
     *  и говорить ли об этом серверу. */
    onGame: (callback) => {
      const handler = (_event, name) => callback(name ?? null);
      ipcRenderer.on("game:changed", handler);
      return () => ipcRenderer.off("game:changed", handler);
    },
    /** Что запущено прямо сейчас. Про перемены оболочка рассказывает
     *  сама, но после обрыва связи мессенджеру нужно то, что не менялось:
     *  сервер за это время мог перезапуститься и всё забыть. */
    currentGame: () => ipcRenderer.invoke("game:current"),

    // ── Обновление ──────────────────────────────────────────────
    /** Скачано и ждёт перезапуска. Показывать это окном посреди экрана
     *  оказалось плохо: вопрос приходил не вовремя и отвечали не глядя.
     *  Теперь решает сам мессенджер — кнопкой в углу. */
    onUpdateReady: (callback) => {
      const handler = (_event, version) => callback(String(version));
      ipcRenderer.on("update:ready", handler);
      return () => ipcRenderer.off("update:ready", handler);
    },
    installUpdate: () => ipcRenderer.send("update:install"),
    /** Обратная сторона: что нажали в меню поверх игры. */
    onOverlayAction: (callback) => {
      const handler = (_event, action) => callback(action);
      ipcRenderer.on("overlay:action", handler);
      return () => ipcRenderer.off("overlay:action", handler);
    },

    // ── Запуск вместе с Windows ─────────────────────────────────
    getAutostart: () => ipcRenderer.invoke("autostart:get"),
    setAutostart: (enabled) => ipcRenderer.invoke("autostart:set", Boolean(enabled)),

    // ── Выбор того, что показывать ──────────────────────────────
    /** Оболочка просит показать выбор источников. Рисует его сам
     *  мессенджер, своим оформлением: отдельное окно системы посреди
     *  приложения выглядит как чужая программа. */
    onScreenPick: (callback) => {
      const handler = (_event, sources) => callback(sources);
      ipcRenderer.on("screen:pick", handler);
      return () => ipcRenderer.off("screen:pick", handler);
    },
    /** Ответ: идентификатор источника или null, если передумали. */
    screenPicked: (id) => ipcRenderer.send("screen:picked", id ?? null),

    // ── Рация ───────────────────────────────────────────────────
    /** mode: "off" | "hold" | "toggle". Возвращает, удалось ли занять
     *  клавишу: её мог уже забрать другой запущенный ярлык. */
    setPushToTalk: (options) => ipcRenderer.invoke("ptt:set", options),
    /** Микрофон открыть (true) или закрыть (false). */
    onPushToTalk: (callback) => {
      const handler = (_event, active) => callback(Boolean(active));
      ipcRenderer.on("ptt", handler);
      return () => ipcRenderer.off("ptt", handler);
    },
  });
}
