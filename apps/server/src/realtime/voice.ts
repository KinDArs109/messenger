import { room, type VoicePeer, type VoiceSignal } from "@messenger/shared";
import { canAccessChannel, isOnline, type Realtime, type RealtimeSocket } from "./index.js";
import { prisma } from "../db/client.js";
import { notify, pushEnabled } from "../modules/push/service.js";

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
  /** Звук выключен целиком — человек никого не слышит. Хранится
   *  рядом с микрофоном и по той же причине: вошедший позже должен
   *  сразу видеть, с кем говорить бесполезно. */
  deafened: boolean;
  /** Идентификатор потока с экраном; null — не показывает.
   *
   *  Хранится вместе с составом, чтобы вошедший позже сразу увидел,
   *  что показ уже идёт. Без этого он узнавал бы об экране только
   *  когда показывающий его выключит и включит заново. */
  screenId: string | null;
  /** То же самое для камеры. Два поля, а не одно: экран и камера
   *  идут одновременно и независимо, и вошедшему позже надо узнать
   *  про оба сразу. */
  videoId: string | null;
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

/**
 * Сказать остальным, что кто-то зашёл в разговор.
 *
 * Тем, у кого мессенджер открыт, об этом расскажет живое событие,
 * и уведомление им рисует сам клиент. Здесь — только те, у кого он
 * закрыт: телефон в кармане, ноутбук выключен. Иначе человек узнаёт,
 * что друзья собрались, последним.
 *
 * В уведомлении должно быть видно и кто зашёл, и куда: голосовых
 * каналов у сервера несколько, а серверов — тоже несколько, и «кто-то
 * где-то зашёл» не отвечает ни на один вопрос.
 *
 * Личных звонков это не касается: там звонит телефон, и второе
 * уведомление о том же событии только мешает.
 */
async function announceJoin(channelId: string, userId: string): Promise<void> {
  if (!pushEnabled) return;

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      name: true,
      serverId: true,
      server: { select: { name: true, members: { select: { userId: true } } } },
    },
  });
  if (!channel?.server) return;

  const who = await prisma.user.findUnique({
    where: { id: userId },
    select: { displayName: true },
  });
  if (!who) return;

  // Сколько там уже сидит. При заходе троих подряд это разница между
  // тремя одинаковыми уведомлениями и понятным «уже трое».
  const count = rooms.get(channelId)?.size ?? 1;
  const where = `${channel.server.name} · ${channel.name ?? "голосовой канал"}`;

  await Promise.all(
    channel.server.members
      .map((member) => member.userId)
      .filter((id) => id !== userId && !isOnline(id))
      .map((id) =>
        notify(id, {
          title: `${who.displayName} зашёл в разговор`,
          body: count > 1 ? `${where} · уже ${count}` : where,
          channelId,
          // Один канал — одно уведомление: зашли трое, а плашка одна
          // и с последним числом.
          tag: `voice:${channelId}`,
        }),
      ),
  );
}

const toPeers = (channelId: string): VoicePeer[] =>
  [...(rooms.get(channelId) ?? new Map())].map(([userId, member]) => ({
    userId,
    muted: member.muted,
    deafened: member.deafened,
    screenId: member.screenId,
    videoId: member.videoId,
  }));

export function voiceChannelOf(userId: string): string | undefined {
  return userChannel.get(userId);
}

/**
 * Отдать только что подключившемуся состав всех голосовых каналов,
 * которые ему видны.
 *
 * Без этого узнать, что в канале кто-то сидит, было нельзя: состав
 * (voice:peers) сервер слал одному лишь входящему, а voice:joined —
 * только в момент чужого входа. Кто открыл приложение позже, видел
 * пустые каналы и понимал, что друзья уже собрались, лишь зайдя туда
 * сам. Ровно на это и жаловались.
 *
 * Комнаты сокета — готовый ответ на вопрос «что ему видно»: это те же
 * самые адреса, по которым расходятся события канала. Обращения к базе
 * не нужно вовсе, а перебирать приходится только каналы, где кто-то
 * есть — пустые из rooms удаляются сами.
 */
export async function sendVoiceSnapshot(socket: RealtimeSocket): Promise<void> {
  for (const channelId of rooms.keys()) {
    const targets = await audience(channelId);
    if (!targets.some((target) => socket.rooms.has(target))) continue;
    socket.emit("voice:peers", { channelId, peers: toPeers(channelId) });
  }
}

/**
 * Выход. Вызывается и по кнопке, и при обрыве связи, и при исключении
 * с сервера.
 *
 * socketId — какое именно соединение оборвалось. Если оно не то,
 * из которого зашли в канал, выходить не надо: мессенджер часто открыт
 * и приложением, и вкладкой браузера сразу, и закрытие лишнего окна
 * выкидывало человека из разговора у всех на глазах. Разговор при этом
 * продолжал звучать — звук идёт мимо сервера, — но из списка человек
 * пропадал, и собеседники считали, что он ушёл.
 *
 * Без socketId — выход безусловный: так уходят по кнопке и так
 * выставляют с сервера.
 */
/**
 * Выход из голосового канала.
 *
 * Обещание возвращается не для красоты: вход обязан его дождаться.
 * Раньше «вышел» рассылался отложенно — сразу после того, как список
 * адресатов приедет из базы, — а вход тем временем успевал отправить
 * новый состав канала. Порядок на проводе получался обратный смыслу:
 * сначала «вот кто в канале», потом «а этот вышел» — про того же
 * человека, который только что вошёл.
 *
 * Ловилось это не в первый вход, а во второй: при возврате в тот же
 * канал после обрыва связи (а его вызывает любой перезапуск сервера).
 * Человек оставался в разговоре, слышал всех — и пропадал из состава
 * у себя и у остальных. Снаружи: «я в разговоре, а в канале никого».
 */
export async function leaveVoice(
  io: Realtime,
  userId: string,
  socketId?: string,
): Promise<void> {
  const channelId = userChannel.get(userId);
  if (!channelId) return;

  if (socketId && rooms.get(channelId)?.get(userId)?.socketId !== socketId) return;

  userChannel.delete(userId);
  const members = rooms.get(channelId);
  members?.delete(userId);
  if (members && members.size === 0) rooms.delete(channelId);

  const targets = await audience(channelId);
  emitToAudience(io, targets, (to) => to.emit("voice:left", { channelId, userId }));
}

/* Здесь жила временная запись в журнал: чем именно обмениваются
   стороны при соединении и какие у них адреса. Её заводили под разбор
   жалобы «не слышу друга»; разбор кончился — ретранслятор поставлен
   и проверен, — а запись осталась и висела в бою.

   Дело не только в лишних строках журнала. Она копила счётчики
   по парам собеседников в обычной Map и не убирала их никогда:
   разговор кончился, а пара в памяти осталась. За месяцы работы это
   растёт. Понадобится снова — вернуть на время недолго. */

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

      /*
       * Тот же человек с другого устройства.
       *
       * Один человек — один разговор. Пришёл с телефона, сидя в нём
       * с ноутбука, — с ноутбука его надо вывести, и наоборот.
       *
       * Без этого начиналась путаница, которую трудно связать
       * с причиной: состав канала помнит один socketId на человека,
       * и все служебные сообщения — «выключил микрофон», «показывает
       * экран», сигналы соединения — уходили на то устройство, которое
       * записалось последним. Второе продолжало показывать разговор,
       * в котором его уже нет: звук идёт, а кнопки не работают.
       *
       * Старому устройству говорим отдельно: само оно об этом узнать
       * не может, а молча оборванный разговор выглядит поломкой.
       */
      const previous = userChannel.get(userId);
      const oldSocket = previous ? rooms.get(previous)?.get(userId)?.socketId : null;
      if (oldSocket && oldSocket !== socket.id) {
        io.to(oldSocket).emit("voice:evicted", { channelId: previous ?? null });
      }

      // Из прежнего канала выходим до входа в новый — иначе человек
      // остался бы висеть в двух местах сразу.
      //
      // Именно await: рассылка «вышел» уходит не мгновенно, и без
      // ожидания она обгоняла состав канала, отправленный ниже.
      // Человек вошёл — и тут же «вышел», по мнению всех остальных.
      await leaveVoice(io, userId);

      const members = rooms.get(channelId) ?? new Map<string, VoiceMember>();
      members.set(userId, {
        muted: false,
        deafened: false,
        screenId: null,
        videoId: null,
        socketId: socket.id,
      });
      rooms.set(channelId, members);
      userChannel.set(userId, channelId);

      // Сначала подтверждение и состав — потом извещаем остальных.
      // В обратном порядке чужое «я вошёл» пришло бы раньше, чем
      // клиент узнал, что он сам уже в канале.
      ack?.(true);
      socket.emit("voice:peers", { channelId, peers: toPeers(channelId) });

      // socket.to, а не io.to: вошедшему это событие не нужно, он
      // только что получил полный состав через voice:peers. Иначе он
      // узнаёт о собственном входе вторым сообщением и добавляет себя
      // в список повторно.
      const targets = await audience(channelId);
      for (const target of targets) {
        socket
          .to(target)
          .emit("voice:joined", {
            channelId,
            peer: { userId, muted: false, deafened: false, screenId: null, videoId: null },
          });
      }

      // И тем, у кого мессенджер закрыт, — уведомлением на телефон.
      // Ради этого мессенджер, в общем, и заводили: узнать, что друзья
      // собрались, раньше было нельзя никак.
      void announceJoin(channelId, userId).catch((error: unknown) => {
        console.warn("Уведомление о входе в разговор не ушло:", error);
      });
    })();
  });

  socket.on("voice:leave", () => void leaveVoice(io, userId));

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
    // Поля может не быть: рация шлёт одно только состояние микрофона,
    // да и клиент постарше про звук не знает вовсе. Отсутствие — это
    // «не менялось», а не «включён»: иначе первое же нажатие рации
    // снимало бы с человека признак выключенного звука, и собеседники
    // снова говорили бы с тем, кто их не слышит.
    if (data && "deafened" in data) member.deafened = Boolean(data.deafened);

    void audience(channelId).then((targets) =>
      emitToAudience(io, targets, (to) =>
        to.emit("voice:state", {
          channelId,
          userId,
          muted: member.muted,
          deafened: member.deafened,
        }),
      ),
    );
  });

  // Показ экрана и камера. Сервер знает только, что показ идёт, и под
  // каким идентификатором придёт поток. Само изображение через него
  // не проходит — оно идёт напрямую, как и звук.
  //
  // Длину ограничиваем: это чужая строка, которая разойдётся всем
  // в канале, и незачем позволять слать через неё что попало.
  const clean = (raw: unknown): string | null =>
    typeof raw === "string" && raw.length > 0 ? raw.slice(0, 64) : null;

  socket.on("voice:screen", (data) => {
    const channelId = userChannel.get(userId);
    if (!channelId) return;

    const member = rooms.get(channelId)?.get(userId);
    if (!member) return;

    member.screenId = clean(data?.screenId);

    void audience(channelId).then((targets) =>
      emitToAudience(io, targets, (to) =>
        to.emit("voice:screen", { channelId, userId, screenId: member.screenId }),
      ),
    );
  });

  socket.on("voice:video", (data) => {
    const channelId = userChannel.get(userId);
    if (!channelId) return;

    const member = rooms.get(channelId)?.get(userId);
    if (!member) return;

    member.videoId = clean(data?.videoId);

    void audience(channelId).then((targets) =>
      emitToAudience(io, targets, (to) =>
        to.emit("voice:video", { channelId, userId, videoId: member.videoId }),
      ),
    );
  });
}
