import { Server as SocketServer, type Socket } from "socket.io";
import type { Server as HttpServer } from "node:http";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  UserStatus,
} from "@messenger/shared";
import { room } from "@messenger/shared";
import { env } from "../config/env.js";
import { verifyAccessToken } from "../lib/tokens.js";
import { prisma } from "../db/client.js";
import { leaveVoice, registerVoiceHandlers } from "./voice.js";

interface SocketData {
  userId: string;
}

export type Realtime = SocketServer<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export type RealtimeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

/** Сколько живых сокетов у пользователя. Вкладок может быть несколько,
 *  и «не в сети» ставим только когда закрылась последняя. */
const connections = new Map<string, number>();

/** Пользователь мог выбрать «не беспокоить» — тогда при подключении
 *  новой вкладки нельзя молча вернуть его в «в сети». */
const chosenStatus = new Map<string, UserStatus>();

export function createRealtime(httpServer: HttpServer): Realtime {
  const io: Realtime = new SocketServer(httpServer, {
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
  });

  // Аутентификация на handshake, а не после подключения.
  // Неопознанный сокет не должен существовать даже секунду.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    const userId = token ? await verifyAccessToken(token) : null;

    if (!userId) {
      next(new Error("UNAUTHORIZED"));
      return;
    }

    socket.data.userId = userId;
    next();
  });

  io.on("connection", (socket) => {
    const { userId } = socket.data;

    // ВАЖНО: обработчики и счётчик — синхронно, до любого await.
    //
    // Socket.IO не придерживает события для обработчиков, которых ещё
    // нет. Клиент присылает channel:subscribe сразу после connect, и
    // если мы в этот момент ждём ответа базы, событие просто исчезает.
    // Так же теряется disconnect у короткоживущих соединений — и тогда
    // счётчик не уменьшается, а пользователь навсегда остаётся «в сети».

    connections.set(userId, (connections.get(userId) ?? 0) + 1);

    socket.on("channel:subscribe", async ({ channelId }, ack) => {
      const allowed = await canAccessChannel(userId, channelId);
      if (allowed) await socket.join(room.channel(channelId));
      ack?.(allowed);
    });

    socket.on("channel:unsubscribe", ({ channelId }) => {
      void socket.leave(room.channel(channelId));
    });

    socket.on("typing:start", ({ channelId }) => {
      // Отправителю своё же «печатает» показывать не нужно.
      socket.to(room.channel(channelId)).emit("typing", { channelId, userId });
    });

    socket.on("presence:set", ({ status }) => {
      chosenStatus.set(userId, status);
      void syncPresence(io, userId);
    });

    registerVoiceHandlers(io, socket, userId);

    socket.on("disconnect", () => {
      // Из голосового канала выходим первым делом: иначе оборвавшийся
      // участник остался бы висеть в списке говорящих навсегда.
      leaveVoice(io, userId);

      const left = (connections.get(userId) ?? 1) - 1;
      if (left <= 0) {
        connections.delete(userId);
        chosenStatus.delete(userId);
      } else {
        connections.set(userId, left);
      }
      void syncPresence(io, userId);
    });

    // Всё, что требует базы, — уже после регистрации обработчиков.
    void (async () => {
      // Личная комната — для событий, адресованных пользователю,
      // а не каналу: приглашения, изменения профиля, уведомления.
      await socket.join(room.user(userId));

      const memberships = await prisma.serverMember.findMany({
        where: { userId },
        select: { serverId: true },
      });
      await Promise.all(
        memberships.map((m) => socket.join(room.server(m.serverId))),
      );

      await syncPresence(io, userId);
    })();
  });

  return io;
}

/** Очередь синхронизаций на пользователя.
 *
 *  Без неё возникает гонка «прочитал — записал»: обработчик читает
 *  счётчик соединений, уходит в базу, а за это время счётчик меняется.
 *  Отключение старой вкладки успевает записать «не в сети» уже после
 *  того, как новая вкладка записала «в сети», — и пользователь висит
 *  офлайном, сидя в приложении.
 *
 *  Цепочка промисов гарантирует, что для одного пользователя две
 *  синхронизации никогда не выполняются одновременно. */
const presenceQueue = new Map<string, Promise<void>>();

function syncPresence(io: Realtime, userId: string): Promise<void> {
  const next = (presenceQueue.get(userId) ?? Promise.resolve())
    .then(() => applyPresence(io, userId))
    .catch((error: unknown) => {
      console.error("Не удалось обновить статус:", error);
    });

  presenceQueue.set(userId, next);
  void next.finally(() => {
    // Убираем за собой, только если после нас никто не встал в очередь.
    if (presenceQueue.get(userId) === next) presenceQueue.delete(userId);
  });
  return next;
}

async function applyPresence(io: Realtime, userId: string): Promise<void> {
  // Счётчик читаем здесь: очередь гарантирует, что предыдущая
  // синхронизация уже завершилась, а значит значение актуально.
  const alive = connections.get(userId) ?? 0;
  const status: UserStatus =
    alive > 0 ? (chosenStatus.get(userId) ?? "online") : "offline";

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true },
  });
  if (!before || before.status === status) return;

  await prisma.user.update({ where: { id: userId }, data: { status } });

  const memberships = await prisma.serverMember.findMany({
    where: { userId },
    select: { serverId: true },
  });
  for (const { serverId } of memberships) {
    io.to(room.server(serverId)).emit("presence:update", { userId, status });
  }
}

/** Подписка на комнату канала — это доступ к чтению.
 *  Проверяем так же строго, как REST-запрос: клиент может прислать
 *  любой идентификатор, какой захочет. */
export async function canAccessChannel(
  userId: string,
  channelId: string,
): Promise<boolean> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { serverId: true },
  });
  if (!channel) return false;

  if (channel.serverId) {
    const member = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId: channel.serverId, userId } },
      select: { userId: true },
    });
    return member !== null;
  }

  const participant = await prisma.channelParticipant.findUnique({
    where: { channelId_userId: { channelId, userId } },
    select: { userId: true },
  });
  return participant !== null;
}
