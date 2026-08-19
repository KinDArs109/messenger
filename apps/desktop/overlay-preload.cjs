const { contextBridge, ipcRenderer } = require("electron");

/**
 * Мост для окон оверлея — и постоянного окошка, и меню.
 *
 * Один на оба намеренно. Окошко из него берёт только состояние:
 * оно висит поверх чужих игр, сквозное для мыши и нажимать в нём
 * нечего. Меню берёт и состояние, и отправку — но живёт секунды,
 * пока его держат открытым.
 *
 * Ничего, кроме этих двух вещей, здесь нет и быть не должно: это окна
 * поверх всего, и чем меньше они умеют, тем меньше с ними может
 * случиться.
 */
contextBridge.exposeInMainWorld("overlay", {
  onState: (callback) => {
    ipcRenderer.on("overlay:state", (_event, state) => callback(state));
  },
  /** Меню показывают или прячут. Появление и исчезновение рисует сама
   *  страница: окно живёт весь разговор и только показывается, поэтому
   *  «открылось» — это событие, а не загрузка. */
  onToggle: (callback) => {
    ipcRenderer.on("overlay:open", () => callback(true));
    ipcRenderer.on("overlay:hide", () => callback(false));
  },
  /** Нажали кнопку. Уходит в главный процесс, оттуда — в мессенджер:
   *  сам разговор живёт там, здесь только кнопки. */
  action: (action) => ipcRenderer.send("overlay:action", action),

  /** Что можно показать: экраны и окна с миниатюрами. Приходит,
   *  когда показ начали отсюда же, из меню. */
  onScreenPick: (callback) => {
    ipcRenderer.on("screen:pick", (_event, sources) => callback(sources));
  },
  /** Выбрали источник или передумали (null). */
  screenPicked: (id) => ipcRenderer.send("screen:picked", id ?? null),
});
