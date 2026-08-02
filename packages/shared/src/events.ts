import type { PublicUser } from "./schemas/common.js";
import type { FriendshipDto } from "./schemas/friends.js";
import type { ChannelType, MemberRole, UserStatus } from "./constants.js";

export interface AttachmentDto {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  url: string;
  width: number | null;
  height: number | null;
}

/** Короткая выжимка родительского сообщения. Полный объект здесь
 *  не нужен: над ответом показывается одна строка. */
export interface ReplyPreview {
  id: string;
  authorName: string;
  content: string;
  deleted: boolean;
}

/** Реакции приходят уже сгруппированными по эмодзи: клиенту нужны
 *  только счётчик и признак «я тоже нажал». Список всех, кто нажал,
 *  на ста участниках весил бы больше самого сообщения. */
export interface ReactionDto {
  emoji: string;
  count: number;
  me: boolean;
}

export interface MessageDto {
  id: string;
  channelId: string;
  content: string;
  author: PublicUser;
  attachments: AttachmentDto[];
  reactions: ReactionDto[];
  replyTo: ReplyPreview | null;
  editedAt: string | null;
  createdAt: string;
}

export interface ChannelDto {
  id: string;
  serverId: string | null;
  type: ChannelType;
  name: string | null;
  topic: string | null;
  position: number;
}

export interface ServerDto {
  id: string;
  name: string;
  iconUrl: string | null;
  role: MemberRole;
  channels: ChannelDto[];
}

export interface MemberDto extends PublicUser {
  role: MemberRole;
}

/** Личная переписка. Это тот же Channel, только без сервера,
 *  поэтому вся логика сообщений работает для неё без изменений. */
export interface DmChannelDto {
  id: string;
  type: "DM" | "GROUP_DM";
  participants: PublicUser[];
  lastMessageAt: string | null;
}

/** Участник голосового канала. Имя и аватар клиент и так знает
 *  из списка участников — здесь только то, что меняется в разговоре. */
export interface VoicePeer {
  userId: string;
  muted: boolean;
}

/** Служебные сообщения WebRTC.
 *
 *  Три вида: предложение соединиться, ответ на него и «кандидат» —
 *  вариант сетевого пути, по которому стороны могут друг друга
 *  достать. Сервер в их содержимое не заглядывает. */
export type VoiceSignal =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "candidate"; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };

/** События сервер → клиент. Типизированы, чтобы обе стороны
 *  ломались при сборке, а не в проде. */
export interface ServerToClientEvents {
  "message:new": (message: MessageDto) => void;
  /** В канале появилось сообщение.
   *
   *  Полное message:new уходит только тем, кто подписан на канал,
   *  то есть смотрит его прямо сейчас. Но подсветку непрочитанного
   *  надо показывать и в каналах, которые не открыты, — а значит
   *  нужно событие, доходящее до всех участников сервера. Содержимое
   *  здесь ни к чему: важен лишь факт и идентификатор. */
  "channel:activity": (data: {
    channelId: string;
    messageId: string;
    authorId: string;
  }) => void;
  "message:update": (data: {
    id: string;
    channelId: string;
    content: string;
    editedAt: string;
  }) => void;
  "message:delete": (data: { id: string; channelId: string }) => void;
  /** Реакция приходит как «кто, к чему, что» — каждый клиент сам
   *  пересчитывает свой счётчик и признак «я тоже нажал». Слать
   *  готовую сводку нельзя: у разных людей она разная. */
  "reaction:add": (data: {
    channelId: string;
    messageId: string;
    userId: string;
    emoji: string;
  }) => void;
  "reaction:remove": (data: {
    channelId: string;
    messageId: string;
    userId: string;
    emoji: string;
  }) => void;
  typing: (data: { channelId: string; userId: string }) => void;
  "presence:update": (data: { userId: string; status: UserStatus }) => void;
  "channel:create": (channel: ChannelDto) => void;
  "channel:update": (channel: ChannelDto) => void;
  "channel:delete": (data: { id: string; serverId: string | null }) => void;
  "member:join": (data: { serverId: string; user: PublicUser }) => void;
  "member:leave": (data: { serverId: string; userId: string }) => void;
  /** Кто-то начал с вами переписку — она должна появиться в списке
   *  сразу, а не после перезагрузки страницы. */
  "dm:created": (dm: DmChannelDto) => void;
  /** Человек сменил имя. Оно подписано под каждым его сообщением
   *  и стоит в списке участников, поэтому обновлять надо везде,
   *  а не только у него самого. */
  "user:update": (user: PublicUser) => void;
  /** Появилась или изменилась дружба: заявка пришла, её приняли.
   *  Каждой стороне уходит свой вариант — направление заявки
   *  у отправителя и получателя противоположное. */
  "friend:update": (friendship: FriendshipDto) => void;
  "friend:remove": (data: { id: string }) => void;
  /** Вас упомянули. Отдельным событием, а не выводом из message:new:
   *  сообщение приходит только подписчикам канала, а упоминание должно
   *  дойти, даже если канал сейчас не открыт. */
  "mention": (data: {
    channelId: string;
    messageId: string;
    serverId: string | null;
  }) => void;

  // ─── Голос ───────────────────────────────────────────────────
  /** Полный состав голосового канала — приходит при входе.
   *  Дальше состав поддерживается точечными событиями. */
  "voice:peers": (data: { channelId: string; peers: VoicePeer[] }) => void;
  "voice:joined": (data: { channelId: string; peer: VoicePeer }) => void;
  "voice:left": (data: { channelId: string; userId: string }) => void;
  /** Обмен служебными сообщениями WebRTC.
   *
   *  Сервер их не читает и не хранит — только передаёт от одного
   *  участника другому. Сам звук через сервер не идёт вовсе: он
   *  ходит напрямую между людьми, поэтому нагрузки на ноутбук
   *  от разговора почти нет. */
  "voice:signal": (data: { from: string; channelId: string; signal: VoiceSignal }) => void;
  "voice:state": (data: { channelId: string; userId: string; muted: boolean }) => void;
}

/** События клиент → сервер.
 *  Отправка сообщений сюда сознательно не входит: она идёт обычным
 *  POST-запросом. Так проще с валидацией, лимитами и повторами,
 *  а сокет остаётся только каналом доставки. */
export interface ClientToServerEvents {
  /** Подтверждение обязательно: клиент должен знать, что подписка
   *  состоялась, прежде чем грузить историю. Иначе сообщения,
   *  пришедшие между подпиской и загрузкой, потеряются. */
  "channel:subscribe": (
    data: { channelId: string },
    ack?: (subscribed: boolean) => void,
  ) => void;
  "channel:unsubscribe": (data: { channelId: string }) => void;
  "typing:start": (data: { channelId: string }) => void;
  "presence:set": (data: { status: UserStatus }) => void;

  /** Вход в голосовой канал. Подтверждение обязательно: пока сервер
   *  не подтвердил, соединяться не с кем — список участников придёт
   *  отдельным событием. */
  "voice:join": (data: { channelId: string }, ack?: (ok: boolean) => void) => void;
  "voice:leave": () => void;
  "voice:signal": (data: { to: string; signal: VoiceSignal }) => void;
  "voice:state": (data: { muted: boolean }) => void;
}

export const room = {
  user: (userId: string) => `user:${userId}`,
  server: (serverId: string) => `server:${serverId}`,
  channel: (channelId: string) => `channel:${channelId}`,
};
