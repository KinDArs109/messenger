const { contextBridge, ipcRenderer } = require("electron");

/**
 * Мост для окна запуска.
 *
 * Односторонний и на одно событие: окно ничего не решает и никуда
 * ничего не отправляет — оно только показывает, что сейчас делает
 * оболочка. Всё, что можно нажать, появится в самом мессенджере,
 * когда он откроется.
 */
contextBridge.exposeInMainWorld("splash", {
  onState: (callback) => {
    ipcRenderer.on("splash:state", (_event, state) => callback(state));
  },
});
