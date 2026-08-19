import { room } from "@messenger/shared";
import { prisma } from "../db/client.js";
import { isOnline, type Realtime, type RealtimeSocket } from "./index.js";

/**
 * Звонки в личной переписке.
 *
 * Сам разговор — это обычный голосовой канал, только каналом служит
 * переписка. Всё, чего не хватало для звонка, — это вызов: чтобы
 * телефон у собеседника зазвонил, а не чтобы он однажды сам заметил,
 * что кто-то сидит в канале и ждёт.
 *
 * Поэтому здесь нет ни звука, ни соединений — только «звоню»,
 * «ответил», «отклонил» и часы, которые кладут трубку, если никто
 * не подошёл.
 */

/** Сколько звонить, прежде чем считать, что не подошли. Сорок пять
 *  секунд — примерно восемь гудков: меньше выглядит как сбой связи,
 *  больше уже раздражает обоих. */
const RING_MS = 45_000;

interface Pending {
  from: string;
  to: string;
  timer: NodeJS.Timeout;
}

/** Звонки, которые сейчас звонят. Ключ — канал: в одной переписке
 *  одновременно может звонить только один звонок. */
const pending = new Map<string, Pending>();

function clear(channelId: string): Pending | null {
  const call = pending.get(channelId);
  if (!call) return null;
  clearTimeout(call.timer);
  pending.delete(channelId);
  return call;
}

/** Второй участник переписки. null — это не переписка на двоих
 *  или мы в ней не состоим. */
async function otherSide(channelId: string, userId: string): Promise<string | null> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { serverId: true, participants: { select: { userId: true } } },
  });
  // Только личные: в канале сервера звонок бессмысленен — туда просто
  // заходят.
  if (!channel || channel.serverId) return null;

  const ids = channel.participants.map((p) => p.userId);
  if (!ids.includes(userId)) return null;

  const other = ids.find((id) => id !== userId);
  return other ?? null;
}

/** Прекратить звонок и сказать обоим, чем он кончился. */
function finish(
  io: Realtime,
  channelId: string,
  state: "accepted" | "declined" | "cancelled" | "missed",
): void {
  const call = clear(channelId);
  if (!call) return;

  io.to(room.user(call.from)).emit("call:state", { channelId, state });
  io.to(room.user(call.to)).emit("call:state", { channelId, state });
}

export function registerCallHandlers(
  io: Realtime,
  socket: RealtimeSocket,
  userId: string,
): void {
  socket.on("call:invite", (data, ack) => {
    void (async () => {
      const channelId = String(data?.channelId ?? "");
      const to = channelId ? await otherSide(channelId, userId) : null;
      if (!to) {
        ack?.(false, "Позвонить можно только в личной переписке");
        return;
      }

      // Уже звонит — второй раз не звоним. Обычно это просто двойное
      // нажатие, но бывает и встречный звонок: тогда правильно
      // сказать «занято», а не заводить второй.
      if (pending.has(channelId)) {
        ack?.(false, "Уже звоню");
        return;
      }

      if (!isOnline(to)) {
        socket.emit("call:state", { channelId, state: "offline" });
        ack?.(false, "Собеседник не в сети");
        return;
      }

      const timer = setTimeout(() => finish(io, channelId, "missed"), RING_MS);
      pending.set(channelId, { from: userId, to, timer });

      const from = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, displayName: true, avatarUrl: true, status: true },
      });
      if (!from) {
        clear(channelId);
        ack?.(false, "Не удалось позвонить");
        return;
      }

      // В личную комнату, а не в комнату канала: переписка у человека
      // может быть закрыта, а звонок обязан дойти.
      // Состояние берём не из базы, а «в сети»: он нам сейчас звонит,
      // значит точно в сети, а в базе поле обновляется своим чередом.
      // Заодно это снимает несовпадение типов — там строка, здесь
      // перечисление.
      io.to(room.user(to)).emit("call:ring", {
        channelId,
        from: { ...from, status: "online" },
      });
      ack?.(true);
    })();
  });

  socket.on("call:accept", ({ channelId }) => {
    const call = pending.get(String(channelId ?? ""));
    // Отвечать может только тот, кому звонят: иначе звонящий мог бы
    // «принять» свой же звонок и затащить собеседника в разговор.
    if (!call || call.to !== userId) return;
    finish(io, String(channelId), "accepted");
  });

  socket.on("call:decline", ({ channelId }) => {
    const call = pending.get(String(channelId ?? ""));
    if (!call || call.to !== userId) return;
    finish(io, String(channelId), "declined");
  });

  socket.on("call:cancel", ({ channelId }) => {
    const call = pending.get(String(channelId ?? ""));
    if (!call || call.from !== userId) return;
    finish(io, String(channelId), "cancelled");
  });
}

/** Человек отключился — его звонки закрываем. Иначе у собеседника
 *  звонил бы телефон от того, кто уже закрыл ноутбук. */
export function dropCallsOf(io: Realtime, userId: string): void {
  for (const [channelId, call] of pending) {
    if (call.from !== userId && call.to !== userId) continue;
    finish(io, channelId, call.from === userId ? "cancelled" : "declined");
  }
}
