import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@messenger/shared";
import { getAccessToken } from "./api";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

export function connectSocket(): AppSocket {
  socket?.disconnect();

  socket = io({
    // Токен берём функцией, а не значением: при переподключении
    // socket.io вызовет её заново и подставит свежий. Иначе клиент
    // после пятнадцати минут простоя вечно бился бы в дверь
    // с истёкшим токеном.
    auth: (cb) => cb({ token: getAccessToken() }),
    transports: ["websocket", "polling"],
  });

  return socket;
}

export function getSocket(): AppSocket | null {
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
