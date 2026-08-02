import type { Realtime } from "./index.js";

/** Обработчики REST-запросов должны уметь разослать событие в сокет:
 *  сообщение создаётся обычным POST, а доставляется через WebSocket.
 *  Держим ссылку на сервер сокетов здесь, чтобы не протаскивать её
 *  параметром через все роутеры. */
let instance: Realtime | null = null;

export function setRealtime(io: Realtime): void {
  instance = io;
}

export function realtime(): Realtime {
  if (!instance) throw new Error("Сервер сокетов ещё не создан");
  return instance;
}
