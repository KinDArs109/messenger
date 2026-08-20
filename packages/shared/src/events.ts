import type { PublicUser } from "./schemas/common.js";
import type { FriendshipDto } from "./schemas/friends.js";
import type { ChannelType, ChosenStatus, MemberRole, UserStatus } from "./constants.js";

export interface AttachmentDto {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  url: string;
  /** Уменьшенная копия для ленты. null — показывать нечего кроме
   *  оригинала: картинка и так мелкая, либо это не картинка.
   *
   *  Нужна потому, что в ленте изображение всё равно ужимается
   *  стилями, а браузер до этого честно скачивает его целиком —
   *  все мегабайты ради картинки шириной в палец. */
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  /** Секунды — только у голосовых сообщений. Приходит с сервера,
   *  потому что в самой записи её нет: браузер её туда не кладёт. */
  duration?: number | null;
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

/** Своё эмодзи сервера. В сообщении стоит как `:название:`,
 *  поэтому имя здесь — то самое, что человек пишет. */
export interface EmojiDto {
  id: string;
  name: string;
  url: string;
}

export interface ServerDto {
  id: string;
  name: string;
  iconUrl: string | null;
  /** Картинка над списком каналов. Открывается со второго уровня —
   *  до него всегда null, даже если когда-то была загружена. */
  bannerUrl: string | null;
  role: MemberRole;
  channels: ChannelDto[];
  /** Кто поддержал сервер. Не число, а имена: значок бустера стоит
   *  рядом с человеком в списке участников, и без списка его негде
   *  было бы взять. Четверо друзей — список короткий по определению. */
  boostedBy: string[];
  /** Уровень считается из числа бустов. Приезжает готовым, чтобы
   *  клиент и сервер не считали его каждый по-своему. */
  level: number;
  /** Свои эмодзи — открываются на третьем уровне. Приезжают вместе
   *  с сервером: они нужны сразу, чтобы нарисовать уже написанные
   *  сообщения, а не только когда человек полезет их выбирать. */
  emoji: EmojiDto[];
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
  /** Человек отключил звук — он не слышит никого.
   *
   *  Отдельно от микрофона, потому что означает совсем другое:
   *  выключенный микрофон — «сейчас не говорю», выключенный звук —
   *  «не слышу вовсе, говорить мне бесполезно». Без этого признака
   *  собеседники видели только перечёркнутый микрофон и продолжали
   *  разговаривать с тем, кто их не слышит. */
  deafened?: boolean;
  /** Идентификатор потока с экраном, если человек его показывает.
   *
   *  Не просто «да/нет»: получателю надо знать, какой из приходящих
   *  потоков — экран, а какой — микрофон. Различать их по наличию
   *  видеодорожки нельзя, дорожки одного потока приходят порознь
   *  и в непредсказуемом порядке. Идентификатор же переживает
   *  дорогу до собеседника без изменений. */
  screenId?: string | null;
  /** Идентификатор потока с камерой — по тем же причинам, что и экран.
   *
   *  Отдельно от экрана, а не вместо: одно другому не мешает, и
   *  показывать экран, оставаясь в кадре, — обычное дело. Значит,
   *  получателю могут прийти два видеопотока сразу, и различить их
   *  можно только по объявленному идентификатору. */
  videoId?: string | null;
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
  /** Свой собственный выбор — обратно себе.
   *
   *  Нужен, когда устройств несколько: выбрал «не беспокоить»
   *  на ноутбуке — телефон должен показать то же самое, иначе
   *  на телефоне галочка стоит в одном месте, а работает другое. */
  "presence:self": (data: { status: ChosenStatus }) => void;
  /** Во что человек играет прямо сейчас. null — уже ни во что.
   *
   *  Отдельным событием от статуса, а не полем в нём: игра меняется
   *  своим чередом, а статус своим, и слать одно из-за другого значило
   *  бы будить всех, кому это событие приходит, вдвое чаще. */
  "presence:game": (data: { userId: string; game: string | null }) => void;
  /** Кто во что играет — целиком. Приходит при подключении: игра
   *  живёт в памяти сервера, и вошедший о ней иначе не узнает, пока
   *  кто-нибудь не запустит или не закроет свою. */
  "presence:games": (data: { playing: { userId: string; game: string }[] }) => void;

  /** Вам звонят. Приходит в личную комнату, а не в комнату канала:
   *  звонок должен догнать человека, что бы он ни читал в этот
   *  момент. */
  "call:ring": (data: { channelId: string; from: PublicUser }) => void;
  /** Чем кончился звонок — и для звонящего, и для того, кому звонят.
   *
   *  Одно событие на все исходы, а не пять: получатель в любом случае
   *  делает одно и то же — убирает окно звонка и, если приняли,
   *  заходит в разговор. Причина нужна только чтобы её показать. */
  "call:state": (data: {
    channelId: string;
    state: "accepted" | "declined" | "cancelled" | "missed" | "busy" | "offline";
  }) => void;
  /** Сервер переименовали или сменили ему значок. Название стоит
   *  в шапке и в левой ленте у каждого участника — без рассылки
   *  остальные видели бы старое до перезагрузки страницы. */
  "server:update": (data: {
    id: string;
    name: string;
    iconUrl: string | null;
    bannerUrl: string | null;
  }) => void;
  /** Эмодзи сервера добавили или убрали. Целиком списком: их
   *  десятки, а не тысячи, и слать по одному ради экономии
   *  нескольких байт — лишний повод разойтись состояниям. */
  "server:emoji": (data: { serverId: string; emoji: EmojiDto[] }) => void;
  /** Сервер поддержали — или поддержку сняли. Уровень считает сервер:
   *  два места, считающих одно и то же, однажды посчитают по-разному. */
  "server:boost": (data: {
    serverId: string;
    boostedBy: string[];
    level: number;
    bannerUrl: string | null;
  }) => void;
  "channel:create": (channel: ChannelDto) => void;
  "channel:update": (channel: ChannelDto) => void;
  "channel:delete": (data: { id: string; serverId: string | null }) => void;
  /**
   * Сервера больше нет.
   *
   * Раньше такого события не было вовсе: сервер удаляли из хозяйской
   * панели прямо в базе, а у всех, кто в этот момент сидел
   * в мессенджере, он так и оставался в списке — с каналами, в которые
   * уже никого не пустят. Узнать правду можно было только перезагрузкой.
   */
  "server:delete": (data: { id: string }) => void;
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
  /** Тот же человек вошёл в разговор с другого устройства — это
   *  устройство из разговора выводится. Один человек — один разговор:
   *  иначе служебные сообщения уходят на одно устройство, а второе
   *  показывает разговор, в котором его уже нет. */
  "voice:evicted": (data: { channelId: string | null }) => void;
  /** Обмен служебными сообщениями WebRTC.
   *
   *  Сервер их не читает и не хранит — только передаёт от одного
   *  участника другому. Сам звук через сервер не идёт вовсе: он
   *  ходит напрямую между людьми, поэтому нагрузки на ноутбук
   *  от разговора почти нет. */
  "voice:signal": (data: { from: string; channelId: string; signal: VoiceSignal }) => void;
  "voice:state": (data: {
    channelId: string;
    userId: string;
    muted: boolean;
    deafened: boolean;
  }) => void;
  "voice:screen": (data: { channelId: string; userId: string; screenId: string | null }) => void;
  "voice:video": (data: { channelId: string; userId: string; videoId: string | null }) => void;
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
  /** Выбрать статус. «Не в сети» здесь нет: это не выбор, а факт. */
  "presence:set": (data: { status: ChosenStatus }) => void;
  /** Человек отошёл — или вернулся.
   *
   *  Считает клиент: молчание мыши и клавиатуры видно только там.
   *  Отдельно от выбранного статуса, потому что отменять чужой выбор
   *  оно не должно: выбравший «не беспокоить» остаётся с ним и через
   *  час тишины, а вот «в сети» превращается в «неактивен». */
  "presence:away": (data: { away: boolean }) => void;
  /** Сообщить, во что играем. Знает об этом только оболочка
   *  на компьютере: браузер списка запущенных программ не видит. */
  "presence:playing": (data: { game: string | null }) => void;

  /** Позвонить собеседнику в личной переписке. Подтверждение
   *  обязательно: звонок может не начаться — человек не в сети,
   *  занят другим звонком или это вообще не переписка. */
  "call:invite": (
    data: { channelId: string },
    ack?: (ok: boolean, reason?: string) => void,
  ) => void;
  "call:accept": (data: { channelId: string }) => void;
  "call:decline": (data: { channelId: string }) => void;
  /** Передумал звонить, пока не ответили. */
  "call:cancel": (data: { channelId: string }) => void;

  /** Вход в голосовой канал. Подтверждение обязательно: пока сервер
   *  не подтвердил, соединяться не с кем — список участников придёт
   *  отдельным событием. */
  "voice:join": (data: { channelId: string }, ack?: (ok: boolean) => void) => void;
  "voice:leave": () => void;
  "voice:signal": (data: { to: string; signal: VoiceSignal }) => void;
  /** deafened можно не присылать — тогда сервер считает, что звук
   *  включён. Так старый клиент, который про это поле не знает,
   *  не выглядит навсегда оглохшим. */
  "voice:state": (data: { muted: boolean; deafened?: boolean }) => void;
  /** screenId — идентификатор потока с экраном; null — показ прекращён. */
  "voice:screen": (data: { screenId: string | null }) => void;
  /** videoId — идентификатор потока с камерой; null — камера выключена. */
  "voice:video": (data: { videoId: string | null }) => void;
  /** Замер задержки до сервера. Нужен, когда в голосовом канале
   *  никого больше нет: звук идёт напрямую между собеседниками,
   *  и мерить дорогу до них не по чему. Сервер только отвечает —
   *  время считает сама сторона, которая спрашивала. */
  "net:ping": (ack: () => void) => void;
}

export const room = {
  user: (userId: string) => `user:${userId}`,
  server: (serverId: string) => `server:${serverId}`,
  channel: (channelId: string) => `channel:${channelId}`,
};
