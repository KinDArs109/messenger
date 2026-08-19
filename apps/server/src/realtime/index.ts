import { Server as SocketServer, type Socket } from "socket.io";
import type { Server as HttpServer } from "node:http";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  UserStatus,
} from "@messenger/shared";
import { CHOSEN_STATUSES, room, type ChosenStatus } from "@messenger/shared";
import { env } from "../config/env.js";
import { verifyAccessToken } from "../lib/tokens.js";
import { prisma } from "../db/client.js";
import { leaveVoice, registerVoiceHandlers, sendVoiceSnapshot } from "./voice.js";
import { setQuiet } from "./quiet.js";
import { dropCallsOf, registerCallHandlers } from "./calls.js";

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

/** Есть ли у человека хоть одно живое соединение. Звонку это нужно
 *  до того, как звонить: звонить в пустоту сорок пять секунд, а потом
 *  сказать «не ответил», — обман. */
export function isOnline(userId: string): boolean {
  return (connections.get(userId) ?? 0) > 0;
}

/** Что человек выбрал о себе. Здесь — как подсказка, чтобы не ходить
 *  в базу на каждое соединение; хранится же оно в базе, иначе выбор
 *  не пережил бы перезапуск сервера. */
const chosenStatus = new Map<string, ChosenStatus>();

/** Кто отошёл от компьютера. Считает клиент — молчание мыши
 *  и клавиатуры видно только там; сервер лишь помнит.
 *
 *  Отдельно от выбора: «неактивен» появляется само и само же
 *  исчезает, а выбранное «не беспокоить» оно отменять не вправе. */
const away = new Set<string>();

/** Статус, который видят друзья.
 *
 *  Три правила и все три важные: невидимый снаружи неотличим
 *  от «не в сети», отошедший показывается неактивным только если
 *  выбрал «в сети», и любой выбор перестаёт что-либо значить, когда
 *  закрылось последнее соединение. */
function visibleStatus(userId: string): UserStatus {
  if ((connections.get(userId) ?? 0) === 0) return "offline";

  const chosen = chosenStatus.get(userId) ?? "online";
  if (chosen === "invisible") return "offline";
  if (chosen === "online" && away.has(userId)) return "idle";
  return chosen;
}

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
      // Чужая строка: берём только то, что знаем. «Не в сети» сюда
      // тоже не пройдёт — это не выбор, а факт.
      if (!CHOSEN_STATUSES.includes(status)) return;

      chosenStatus.set(userId, status);
      setQuiet(userId, status === "dnd");
      // Ручной выбор снимает автоматическое «отошёл»: человек только
      // что нажал кнопку, значит он на месте.
      away.delete(userId);

      // В базу — чтобы выбор пережил перезапуск сервера. Не ждём:
      // остальным статус должен уехать сразу.
      void prisma.user
        .update({ where: { id: userId }, data: { chosenStatus: status } })
        .catch((error: unknown) => console.warn("Не удалось запомнить статус:", error));

      // Своим же устройствам — чтобы галочка в меню стояла одинаково
      // и на ноутбуке, и на телефоне.
      io.to(room.user(userId)).emit("presence:self", { status });
      void syncPresence(io, userId);
    });

    /** Отошёл или вернулся. Мышь и клавиатуру видит только клиент. */
    socket.on("presence:away", ({ away: gone }) => {
      const before = away.has(userId);
      if (gone) away.add(userId);
      else away.delete(userId);
      if (before !== gone) void syncPresence(io, userId);
    });

    /** Во что играем. Название приходит от оболочки на компьютере:
     *  браузер списка запущенных программ не видит и прислать такое
     *  не может. Обрезаем на всякий случай — это чужая строка,
     *  и стоять она будет в чужих списках. */
    socket.on("presence:playing", ({ game }) => {
      const clean = typeof game === "string" ? game.trim().slice(0, 60) : null;
      void applyGame(io, userId, clean || null);
    });

    // Кто во что играет прямо сейчас. Игра живёт в памяти сервера,
    // и вошедший иначе не узнал бы о ней до следующей чужой смены —
    // то есть, возможно, никогда за весь вечер.
    //
    // Спрашиваем не «кому вижу я», а «кто рассылает мне»: у своего
    // круга общие серверы записаны комнатой сервера, а не поимённо,
    // и обратный вопрос дал бы неверный ответ. Играющих единицы,
    // так что запросов тут столько же.
    void (async () => {
      const list: { userId: string; game: string }[] = [];
      for (const [id, game] of playing) {
        if (id === userId) continue;
        const theirs = await audience(id);
        if (theirs.has(room.user(userId))) list.push({ userId: id, game });
      }
      if (list.length > 0) socket.emit("presence:games", { playing: list });
    })();

    registerVoiceHandlers(io, socket, userId);
    registerCallHandlers(io, socket, userId);

    // Замер задержки до сервера: просто отвечаем. Время считает
    // спрашивающая сторона — так в измерение не попадает наша
    // задержка на обработку.
    socket.on("net:ping", (ack) => ack?.());

    socket.on("disconnect", () => {
      // Из голосового канала выходим первым делом: иначе оборвавшийся
      // участник остался бы висеть в списке говорящих навсегда.
      //
      // Но только если оборвалось то самое соединение, из которого
      // в канал и заходили: у человека мессенджер бывает открыт
      // и приложением, и вкладкой сразу.
      void leaveVoice(io, userId, socket.id);

      const left = (connections.get(userId) ?? 1) - 1;
      if (left <= 0) {
        connections.delete(userId);
        // Выбор остаётся в базе, из памяти же его убираем: вернётся
        // человек — поднимем оттуда. «Отошёл» не переживает уход
        // совсем: это про сейчас, а не про человека.
        chosenStatus.delete(userId);
        away.delete(userId);
        // Ушёл совсем — уведомления снова можно слать: молчание
        // просили на время, пока сидишь в мессенджере.
        setQuiet(userId, false);
        // Ушёл совсем — его звонки закрываем. Иначе у собеседника
        // звонил бы телефон от того, кто уже закрыл ноутбук, все
        // сорок пять секунд.
        dropCallsOf(io, userId);
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

      // Строго после входа в комнаты: снимок состава голосовых каналов
      // считается по ним. Раньше — и человек не увидит ничего.
      await sendVoiceSnapshot(socket);

      // Свой выбор поднимаем из базы — но только если в памяти его нет.
      // В памяти он свежее: там уже могло появиться выбранное с другого
      // устройства секунду назад, а в базе запись идёт следом.
      if (!chosenStatus.has(userId)) {
        const saved = await prisma.user.findUnique({
          where: { id: userId },
          select: { chosenStatus: true },
        });
        const value = saved?.chosenStatus as ChosenStatus | undefined;
        if (value && CHOSEN_STATUSES.includes(value)) {
          chosenStatus.set(userId, value);
          setQuiet(userId, value === "dnd");
        }
      }

      // И говорим человеку, что он выбрал: у него могло не быть этого
      // выбора вовсе — например, он открыл мессенджер на новом
      // устройстве.
      socket.emit("presence:self", { status: chosenStatus.get(userId) ?? "online" });

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

/** Кто во что играет. В памяти, а не в базе: это состояние минуты,
 *  оно не переживает перезапуск сервера и не должно его переживать —
 *  после перезапуска оболочки сами скажут заново. */
const playing = new Map<string, string>();

/**
 * Кому есть дело до этого человека.
 *
 * Один и тот же набор нужен и статусу, и игре: и то и другое видно
 * в составе сервера, в списке переписок и в друзьях. Общей комнаты
 * сервера для последних двух может не быть вовсе — знакомство
 * начинается и без неё, — поэтому спрашиваем всех троих.
 */
async function audience(userId: string): Promise<Set<string>> {
  const [memberships, friends, talks] = await Promise.all([
    prisma.serverMember.findMany({ where: { userId }, select: { serverId: true } }),
    prisma.friendship.findMany({
      where: {
        status: "ACCEPTED",
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      select: { requesterId: true, addresseeId: true },
    }),
    prisma.channelParticipant.findMany({
      where: { channel: { participants: { some: { userId } } } },
      select: { userId: true },
    }),
  ]);

  const rooms = new Set<string>();
  // Себе — всегда и первым делом. Свой кружок иначе не загорался бы
  // вовсе у того, кто ни в одном сервере не состоит: карточка
  // приезжает до подключения сокета, то есть когда мы и правда
  // ещё не в сети, а другого сообщения потом не приходит.
  rooms.add(room.user(userId));
  for (const { serverId } of memberships) rooms.add(room.server(serverId));
  for (const pair of friends) {
    rooms.add(room.user(pair.requesterId === userId ? pair.addresseeId : pair.requesterId));
  }
  for (const talk of talks) rooms.add(room.user(talk.userId));
  return rooms;
}

/** Сказать всем, кому есть дело, во что человек играет. */
async function applyGame(io: Realtime, userId: string, game: string | null): Promise<void> {
  if ((playing.get(userId) ?? null) === game) return;

  if (game) playing.set(userId, game);
  else playing.delete(userId);

  for (const name of await audience(userId)) {
    io.to(name).emit("presence:game", { userId, game });
  }
}

async function applyPresence(io: Realtime, userId: string): Promise<void> {
  // Счётчик читаем здесь: очередь гарантирует, что предыдущая
  // синхронизация уже завершилась, а значит значение актуально.
  const status = visibleStatus(userId);

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true },
  });
  if (!before || before.status === status) return;

  await prisma.user.update({ where: { id: userId }, data: { status } });

  // Ушёл из сети — играть он больше не может, что бы там ни осталось
  // в памяти. Без этого «играет в Rust» висело бы у выключенного
  // компьютера до перезапуска сервера.
  if (status === "offline" && playing.has(userId)) {
    playing.delete(userId);
    for (const name of await audience(userId)) {
      io.to(name).emit("presence:game", { userId, game: null });
    }
  }

  for (const name of await audience(userId)) {
    io.to(name).emit("presence:update", { userId, status });
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
