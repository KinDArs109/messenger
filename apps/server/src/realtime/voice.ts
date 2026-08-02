import { room, type VoicePeer, type VoiceSignal } from "@messenger/shared";
import { canAccessChannel, type Realtime, type RealtimeSocket } from "./index.js";
import { prisma } from "../db/client.js";

/**
 * Голосовые каналы: сервер знает только, кто где сидит.
 *
 * Звук через него не проходит вообще. Участники соединяются напрямую
 * друг с другом (WebRTC), а сервер лишь сводит их и передаёт служебные
 * сообщения. Поэтому разговор впятером не грузит ноутбук ничем, кроме
 * пары десятков килобайт переписки о том, как соединиться.
 *
 * Обратная сторона выбора: соединения идут «каждый с каждым», и на
 * больших компаниях трафик у участника растёт линейно. Для десятка
 * друзей это правильный размен — SFU-сервер, который свёл бы всё
 * в один поток, надо где-то держать, а держать его негде.
 */

interface VoiceMember {
  muted: boolean;
  /** Одно устройство на человека. Второй вход из другой вкладки
   *  вытесняет первый: два микрофона одного человека в комнате —
   *  это эхо, а не удобство. */
  socketId: string;
}

const rooms = new Map<string, Map<string, VoiceMember>>();
const userChannel = new Map<string, string>();

/** Кому рассылать новости голосового канала.
 *
 *  Не комната канала: на неё клиент подписывается, только когда канал
 *  открыт, а состав разговора виден в сайдбаре всегда. Из-за этого
 *  вышедший оставался в списке у всех, включая себя, — событие просто
 *  никому не доходило.
 *
 *  Поэтому шлём всем участникам сервера, а для личных переписок —
 *  каждому собеседнику в его личную комнату. Кэшируем: канал не
 *  переезжает между серверами, и спрашивать базу на каждое движение
 *  микрофона незачем. */
const audienceCache = new Map<string, string[]>();

async function audience(channelId: string): Promise<string[]> {
  const cached = audienceCache.get(channelId);
  if (cached) return cached;

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { serverId: true, participants: { select: { userId: true } } },
  });
  if (!channel) return [];

  const targets = channel.serverId
    ? [room.server(channel.serverId)]
    : channel.participants.map((p) => room.user(p.userId));

  audienceCache.set(channelId, targets);
  return targets;
}

function emitToAudience(
  io: Realtime,
  targets: string[],
  send: (io: ReturnType<Realtime["to"]>) => void,
): void {
  for (const target of targets) send(io.to(target));
}

const toPeers = (channelId: string): VoicePeer[] =>
  [...(rooms.get(channelId) ?? new Map())].map(([userId, member]) => ({
    userId,
    muted: member.muted,
  }));

export function voiceChannelOf(userId: string): string | undefined {
  return userChannel.get(userId);
}

/** Выход. Вызывается и по кнопке, и при обрыве связи. */
export function leaveVoice(io: Realtime, userId: string): void {
  const channelId = userChannel.get(userId);
  if (!channelId) return;

  userChannel.delete(userId);
  const members = rooms.get(channelId);
  members?.delete(userId);
  if (members && members.size === 0) rooms.delete(channelId);

  void audience(channelId).then((targets) =>
    emitToAudience(io, targets, (to) => to.emit("voice:left", { channelId, userId })),
  );
}

export function registerVoiceHandlers(
  io: Realtime,
  socket: RealtimeSocket,
  userId: string,
): void {

  socket.on("voice:join", (data, ack) => {
    void (async () => {
      const channelId = String(data?.channelId ?? "");
      // Доступ проверяем здесь же: без этого по угаданному
      // идентификатору можно было бы подслушивать чужой канал.
      const allowed = channelId ? await canAccessChannel(userId, channelId) : false;
      if (!allowed) {
        ack?.(false);
        return;
      }

      // Из прежнего канала выходим до входа в новый — иначе человек
      // остался бы висеть в двух местах сразу.
      leaveVoice(io, userId);

      const members = rooms.get(channelId) ?? new Map<string, VoiceMember>();
      members.set(userId, { muted: false, socketId: socket.id });
      rooms.set(channelId, members);
      userChannel.set(userId, channelId);

      // Сначала подтверждение и состав — потом извещаем остальных.
      // В обратном порядке чужое «я вошёл» пришло бы раньше, чем
      // клиент узнал, что он сам уже в канале.
      ack?.(true);
      socket.emit("voice:peers", { channelId, peers: toPeers(channelId) });

      const targets = await audience(channelId);
      emitToAudience(io, targets, (to) =>
        to.emit("voice:joined", { channelId, peer: { userId, muted: false } }),
      );
    })();
  });

  socket.on("voice:leave", () => leaveVoice(io, userId));

  socket.on("voice:signal", (data) => {
    const channelId = userChannel.get(userId);
    const target = String(data?.to ?? "");
    // Передаём только внутри своего канала: иначе сокет превращается
    // в способ слать что угодно кому угодно.
    if (!channelId || userChannel.get(target) !== channelId) return;

    io.to(room.user(target)).emit("voice:signal", {
      from: userId,
      channelId,
      signal: data.signal as VoiceSignal,
    });
  });

  socket.on("voice:state", (data) => {
    const channelId = userChannel.get(userId);
    if (!channelId) return;

    const member = rooms.get(channelId)?.get(userId);
    if (!member) return;
    member.muted = Boolean(data?.muted);

    void audience(channelId).then((targets) =>
      emitToAudience(io, targets, (to) =>
        to.emit("voice:state", { channelId, userId, muted: member.muted }),
      ),
    );
  });
}
