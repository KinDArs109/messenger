import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@messenger/shared";
import { freshAccessToken } from "./api";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

export function connectSocket(): AppSocket {
  socket?.disconnect();

  socket = io({
    /*
     * Токен берём функцией, а не значением: при переподключении
     * socket.io вызывает её заново.
     *
     * И берём именно свежий. Раньше здесь стояло текущее значение —
     * а оно живёт пятнадцать минут и обновляется только запросами.
     * У свёрнутого мессенджера запросов нет: токен протухал, сокет
     * при первом же обрыве переподключался с мёртвым и получал отказ
     * за отказом. Человек разворачивал окно через час и видел, что
     * связи нет.
     */
    auth: (cb) => {
      void freshAccessToken().then((token) => cb({ token }));
    },
    transports: ["websocket", "polling"],
  });

  /*
   * Отказ по токену — не повод сдаваться, а повод обновиться.
   *
   * Своя попытка нужна потому, что socket.io переподключается сам,
   * но с тем же результатом: сервер видит просроченную подпись
   * и снова отказывает. Обновляем сессию и стучимся заново — уже
   * с новым токеном.
   */
  socket.on("connect_error", (error) => {
    if (error.message !== "UNAUTHORIZED") return;
    void freshAccessToken().then((token) => {
      if (token) socket?.connect();
    });
  });

  return socket;
}

/**
 * Мессенджер снова на глазах — проверим, на месте ли связь.
 *
 * socket.io и сам переподключается, но между попытками у него пауза,
 * а система, будившая ноутбук, могла оборвать соединение молча.
 * Дешевле подтолкнуть его в тот момент, когда человек смотрит
 * на окно: именно тогда отсутствие связи и замечают.
 */
if (typeof document !== "undefined") {
  const подтолкнуть = () => {
    if (document.visibilityState !== "visible") return;
    if (socket && !socket.connected) socket.connect();
  };
  document.addEventListener("visibilitychange", подтолкнуть);
  window.addEventListener("focus", подтолкнуть);
  window.addEventListener("online", подтолкнуть);
}

export function getSocket(): AppSocket | null {
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
