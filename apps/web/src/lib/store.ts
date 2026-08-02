import { create } from "zustand";
import type {
  DmChannelDto,
  FriendshipDto,
  MemberDto,
  MessageDto,
  PrivateUser,
  PublicUser,
  ReadStateDto,
  ServerDto,
} from "@messenger/shared";

interface State {
  me: PrivateUser | null;
  servers: ServerDto[];
  members: MemberDto[];
  dms: DmChannelDto[];
  /** null означает «личные сообщения», а не «ничего не выбрано»:
   *  так пространство ЛС становится обычным разделом рейла, а не
   *  третьим состоянием, которое надо всюду проверять отдельно. */
  serverId: string | null;
  channelId: string | null;

  messages: MessageDto[];
  nextCursor: string | null;
  loadingHistory: boolean;

  connected: boolean;
  typing: Map<string, number>;
  membersOpen: boolean;
  toggleMembers: () => void;

  /** Какой список показывает левая панель: каналы сервера или ЛС.
   *  Раньше это выводилось из serverId, и попасть в переписку можно
   *  было, только выйдя из сервера. */
  sidebarTab: "channels" | "dms";
  setSidebarTab: (tab: State["sidebarTab"]) => void;

  friendships: FriendshipDto[];
  friendsLoaded: boolean;
  setFriendships: (list: FriendshipDto[]) => void;
  upsertFriendship: (friendship: FriendshipDto) => void;
  removeFriendship: (id: string) => void;
  /** Открыт ли экран друзей. Это не канал, поэтому в channelId
   *  его не положить — иначе загрузка истории пошла бы по «каналу»,
   *  которого не существует. */
  friendsOpen: boolean;
  openFriends: () => void;

  // ─── Голос ─────────────────────────────────────────────────
  /** В каком голосовом канале мы сейчас. null — ни в каком. */
  voiceChannelId: string | null;
  /** Кто в каких голосовых каналах. Держим по всем каналам, а не
   *  только по своему: список говорящих виден в сайдбаре и до входа,
   *  иначе нельзя понять, куда идти. */
  voiceMembers: Map<string, Map<string, { muted: boolean; speaking: boolean }>>;
  voiceMuted: boolean;
  voiceConnecting: boolean;

  setVoiceChannel: (channelId: string | null) => void;
  setVoiceConnecting: (connecting: boolean) => void;
  setVoicePeers: (channelId: string, peers: { userId: string; muted: boolean }[]) => void;
  voicePeerJoined: (channelId: string, userId: string, muted: boolean) => void;
  voicePeerLeft: (channelId: string, userId: string) => void;
  setVoicePeerMuted: (channelId: string, userId: string, muted: boolean) => void;
  setVoiceSpeaking: (userId: string, speaking: boolean) => void;
  setVoiceMuted: (muted: boolean) => void;

  /** Открытые вкладки каналов, в порядке открытия. Общие для всех
   *  серверов и личных переписок: это вкладки браузера, а не свойство
   *  конкретного сервера. */
  openChannels: string[];
  closeChannel: (channelId: string) => void;

  /** Прочитанное по каналам. Ключ — идентификатор канала. */
  /** Состояние первой загрузки. Различать «ещё не пришло»,
   *  «не удалось» и «пришло, но пусто» обязательно: без этого сбой
   *  сети выглядит как «у вас ничего нет», и человек решает,
   *  что данные пропали. */
  loading: "pending" | "ready" | "failed";
  setLoading: (state: State["loading"]) => void;

  readStates: Map<string, ReadStateDto>;
  setReadStates: (states: ReadStateDto[]) => void;
  /** В канале появилось сообщение — двигаем «последнее». */
  noteMessage: (channelId: string, messageId: string) => void;
  markRead: (channelId: string, messageId: string) => void;
  bumpMention: (channelId: string) => void;

  setMe: (me: State["me"]) => void;
  setServers: (servers: ServerDto[]) => void;
  /** Нас выгнали или мы вышли: убираем сервер и всё, что на него
   *  ссылалось — вкладки его каналов, открытый канал, участников. */
  removeServer: (serverId: string) => void;
  setMembers: (members: MemberDto[]) => void;
  setDms: (dms: DmChannelDto[]) => void;
  addDm: (dm: DmChannelDto) => void;
  selectServer: (serverId: string) => void;
  selectHome: () => void;
  selectChannel: (channelId: string) => void;

  setHistory: (messages: MessageDto[], cursor: string | null) => void;
  prependHistory: (messages: MessageDto[], cursor: string | null) => void;
  setLoadingHistory: (loading: boolean) => void;
  replyTo: MessageDto | null;
  setReplyTo: (message: MessageDto | null) => void;

  addMessage: (message: MessageDto) => void;
  updateMessage: (id: string, content: string, editedAt: string) => void;
  removeMessage: (id: string) => void;
  /** Сменилось имя автора — подставляем во все его сообщения
   *  в открытой ленте. Перезагружать историю ради этого не нужно. */
  renameAuthor: (user: PublicUser) => void;
  applyReaction: (data: {
    messageId: string;
    userId: string;
    emoji: string;
    added: boolean;
  }) => void;

  setConnected: (connected: boolean) => void;
  markTyping: (userId: string) => void;
  sweepTyping: () => void;

  reset: () => void;
}

export const useStore = create<State>((set, get) => ({
  me: null,
  servers: [],
  members: [],
  dms: [],
  serverId: null,
  channelId: null,
  messages: [],
  nextCursor: null,
  loadingHistory: false,
  connected: false,
  typing: new Map(),
  membersOpen: true,
  replyTo: null,
  sidebarTab: "channels",
  openChannels: [],

  setReplyTo: (replyTo) => set({ replyTo }),

  toggleMembers: () => set({ membersOpen: !get().membersOpen }),

  setSidebarTab: (sidebarTab) => set({ sidebarTab }),

  friendships: [],
  friendsLoaded: false,
  friendsOpen: false,

  setFriendships: (friendships) => set({ friendships, friendsLoaded: true }),

  upsertFriendship: (friendship) => {
    const list = get().friendships;
    const index = list.findIndex((f) => f.id === friendship.id);
    set({
      friendships:
        index === -1
          ? [friendship, ...list]
          : list.map((f) => (f.id === friendship.id ? friendship : f)),
    });
  },

  removeFriendship: (id) => set({ friendships: get().friendships.filter((f) => f.id !== id) }),

  voiceChannelId: null,
  voiceMembers: new Map(),
  voiceMuted: false,
  voiceConnecting: false,

  setVoiceChannel: (voiceChannelId) => set({ voiceChannelId }),
  setVoiceConnecting: (voiceConnecting) => set({ voiceConnecting }),

  setVoicePeers: (channelId, peers) => {
    const voiceMembers = new Map(get().voiceMembers);
    voiceMembers.set(
      channelId,
      new Map(peers.map((p) => [p.userId, { muted: p.muted, speaking: false }])),
    );
    set({ voiceMembers });
  },

  voicePeerJoined: (channelId, userId, muted) => {
    const voiceMembers = new Map(get().voiceMembers);
    const members = new Map(voiceMembers.get(channelId) ?? []);
    members.set(userId, { muted, speaking: false });
    voiceMembers.set(channelId, members);
    set({ voiceMembers });
  },

  voicePeerLeft: (channelId, userId) => {
    const voiceMembers = new Map(get().voiceMembers);
    const members = new Map(voiceMembers.get(channelId) ?? []);
    members.delete(userId);
    if (members.size === 0) voiceMembers.delete(channelId);
    else voiceMembers.set(channelId, members);
    set({ voiceMembers });
  },

  setVoicePeerMuted: (channelId, userId, muted) => {
    const voiceMembers = new Map(get().voiceMembers);
    const members = new Map(voiceMembers.get(channelId) ?? []);
    const current = members.get(userId);
    if (!current) return;
    members.set(userId, { ...current, muted });
    voiceMembers.set(channelId, members);
    set({ voiceMembers });
  },

  /** Признак «говорит» меняется по несколько раз в секунду, поэтому
   *  ничего не пересоздаём, если значение и так такое же: иначе
   *  весь сайдбар перерисовывался бы непрерывно. */
  setVoiceSpeaking: (userId, speaking) => {
    const channelId = get().voiceChannelId;
    if (!channelId) return;
    const members = get().voiceMembers.get(channelId);
    const current = members?.get(userId);
    if (!current || current.speaking === speaking) return;

    const voiceMembers = new Map(get().voiceMembers);
    const next = new Map(members!);
    next.set(userId, { ...current, speaking });
    voiceMembers.set(channelId, next);
    set({ voiceMembers });
  },

  setVoiceMuted: (voiceMuted) => set({ voiceMuted }),

  openFriends: () =>
    set({
      friendsOpen: true,
      serverId: null,
      channelId: null,
      sidebarTab: "dms",
      members: [],
      messages: [],
      nextCursor: null,
      replyTo: null,
    }),

  loading: "pending",
  setLoading: (loading) => set({ loading }),

  readStates: new Map(),

  setReadStates: (states) => set({ readStates: new Map(states.map((s) => [s.channelId, s])) }),

  noteMessage: (channelId, messageId) => {
    const readStates = new Map(get().readStates);
    const current = readStates.get(channelId);
    readStates.set(channelId, {
      channelId,
      lastMessageId: messageId,
      lastReadMessageId: current?.lastReadMessageId ?? null,
      mentionCount: current?.mentionCount ?? 0,
    });
    set({ readStates });
  },

  markRead: (channelId, messageId) => {
    const readStates = new Map(get().readStates);
    const current = readStates.get(channelId);
    // Метку двигаем только вперёд — как и на сервере. Иначе прокрутка
    // вверх по истории «разчитывала» бы канал обратно.
    if (current?.lastReadMessageId && current.lastReadMessageId >= messageId) return;
    readStates.set(channelId, {
      channelId,
      lastMessageId: current?.lastMessageId ?? messageId,
      lastReadMessageId: messageId,
      mentionCount: 0,
    });
    set({ readStates });
  },

  bumpMention: (channelId) => {
    const readStates = new Map(get().readStates);
    const current = readStates.get(channelId);
    readStates.set(channelId, {
      channelId,
      lastMessageId: current?.lastMessageId ?? null,
      lastReadMessageId: current?.lastReadMessageId ?? null,
      mentionCount: (current?.mentionCount ?? 0) + 1,
    });
    set({ readStates });
  },

  setMe: (me) => set({ me }),
  setServers: (servers) => set({ servers }),

  removeServer: (serverId) => {
    const state = get();
    const gone = state.servers.find((s) => s.id === serverId);
    if (!gone) return;

    const goneChannels = new Set(gone.channels.map((c) => c.id));
    const inGone = state.channelId !== null && goneChannels.has(state.channelId);

    set({
      servers: state.servers.filter((s) => s.id !== serverId),
      openChannels: state.openChannels.filter((id) => !goneChannels.has(id)),
      // Если мы стояли в этом сервере — уходим в личные сообщения.
      // Оставить открытым канал, которого больше нет, значит показать
      // пустой экран без объяснений.
      ...(state.serverId === serverId || inGone
        ? {
            serverId: null,
            channelId: null,
            members: [],
            messages: [],
            nextCursor: null,
            replyTo: null,
            sidebarTab: "dms" as const,
          }
        : {}),
    });
  },
  setMembers: (members) => set({ members }),
  setDms: (dms) => set({ dms }),

  addDm: (dm) => {
    if (get().dms.some((d) => d.id === dm.id)) return;
    set({ dms: [dm, ...get().dms] });
  },

  selectHome: () => {
    if (get().serverId === null && !get().friendsOpen) return;
    set({
      serverId: null,
      friendsOpen: false,
      members: [],
      channelId: null,
      sidebarTab: "dms",
      messages: [],
      nextCursor: null,
      typing: new Map(),
      replyTo: null,
    });
  },

  /** Смена сервера сразу выбирает его первый текстовый канал.
   *
   *  Раньше это делал отдельный эффект по изменению serverId, и была
   *  ошибка: повторный вызов с тем же идентификатором обнулял канал,
   *  а эффект не срабатывал, потому что serverId не менялся. Канал
   *  пропадал навсегда. Атомарная операция такого класса ошибок
   *  не допускает в принципе. */
  selectServer: (serverId) => {
    if (get().serverId === serverId) return;
    const state = get();
    const server = state.servers.find((s) => s.id === serverId);
    const first = server?.channels.find((c) => c.type === "TEXT");
    set({
      serverId,
      members: [],
      channelId: first?.id ?? null,
      friendsOpen: false,
      sidebarTab: "channels",
      openChannels:
        first && !state.openChannels.includes(first.id)
          ? [...state.openChannels, first.id]
          : state.openChannels,
      messages: [],
      nextCursor: null,
      typing: new Map(),
      replyTo: null,
    });
  },

  /** Открыть канал. Заодно чинит контекст вокруг него: канал чужого
   *  сервера переключает сервер, личная переписка переключает вкладку
   *  панели. Иначе клик по вкладке уводил бы в канал, которого нет
   *  в текущем списке, и экран оставался бы пустым. */
  selectChannel: (channelId) => {
    const state = get();

    const owner = state.servers.find((s) => s.channels.some((c) => c.id === channelId));
    const isDm = !owner && state.dms.some((d) => d.id === channelId);

    const openChannels = state.openChannels.includes(channelId)
      ? state.openChannels
      : [...state.openChannels, channelId];

    if (state.channelId === channelId) {
      set({ openChannels });
      return;
    }

    set({
      channelId,
      openChannels,
      friendsOpen: false,
      sidebarTab: isDm ? "dms" : "channels",
      ...(owner && owner.id !== state.serverId ? { serverId: owner.id, members: [] } : {}),
      // Ответ относится к конкретному каналу — при переходе сбрасываем,
      // иначе набранная реплика улетит не туда.
      messages: [],
      nextCursor: null,
      typing: new Map(),
      replyTo: null,
    });
  },

  /** Закрыть вкладку. Если закрыли текущую — переходим на соседнюю,
   *  а не в пустоту: пустой экран после закрытия выглядит как сбой. */
  closeChannel: (channelId) => {
    const { openChannels, channelId: active } = get();
    const index = openChannels.indexOf(channelId);
    if (index === -1) return;

    const rest = openChannels.filter((id) => id !== channelId);
    set({ openChannels: rest });

    if (active !== channelId) return;

    const next = rest[index] ?? rest[index - 1];
    if (next) {
      get().selectChannel(next);
    } else {
      set({ channelId: null, messages: [], nextCursor: null, typing: new Map(), replyTo: null });
    }
  },

  setHistory: (messages, nextCursor) =>
    // С сервера история приходит от новых к старым — переворачиваем,
    // потому что в ленте порядок обратный.
    set({ messages: [...messages].reverse(), nextCursor }),

  prependHistory: (messages, nextCursor) =>
    set({ messages: [...[...messages].reverse(), ...get().messages], nextCursor }),

  setLoadingHistory: (loadingHistory) => set({ loadingHistory }),

  addMessage: (message) => {
    const { messages, channelId } = get();
    if (message.channelId !== channelId) return;
    // Своё сообщение приходит дважды: ответом на POST и событием
    // сокета. Отсекаем по идентификатору — он один и тот же.
    if (messages.some((m) => m.id === message.id)) return;
    set({ messages: [...messages, message] });
  },

  updateMessage: (id, content, editedAt) =>
    set({
      messages: get().messages.map((m) => (m.id === id ? { ...m, content, editedAt } : m)),
    }),

  removeMessage: (id) => set({ messages: get().messages.filter((m) => m.id !== id) }),

  renameAuthor: (user) =>
    set({
      messages: get().messages.map((m) =>
        m.author.id === user.id ? { ...m, author: { ...m.author, ...user } } : m,
      ),
    }),

  /** Сервер шлёт «кто, к чему, что», а не готовую сводку: признак
   *  «я тоже нажал» у каждого свой, одну и ту же сводку разослать
   *  нельзя. Пересчитываем на месте. */
  applyReaction: ({ messageId, userId, emoji, added }) => {
    const meId = get().me?.id;
    set({
      messages: get().messages.map((message) => {
        if (message.id !== messageId) return message;

        const existing = message.reactions.find((r) => r.emoji === emoji);
        const mine = userId === meId;

        /* Своё нажатие применяется дважды: сразу, чтобы кнопка
           откликалась мгновенно, и потом эхом от сокета. Поэтому
           обе ветки должны быть идемпотентными по признаку me —
           иначе счётчик уезжает на единицу. */
        if (added) {
          if (mine && existing?.me) return message;
          const reactions = existing
            ? message.reactions.map((r) =>
                r.emoji === emoji ? { ...r, count: r.count + 1, me: r.me || mine } : r,
              )
            : [...message.reactions, { emoji, count: 1, me: mine }];
          return { ...message, reactions };
        }

        if (!existing) return message;
        if (mine && !existing.me) return message;
        const count = existing.count - 1;
        return {
          ...message,
          reactions:
            count <= 0
              ? message.reactions.filter((r) => r.emoji !== emoji)
              : message.reactions.map((r) =>
                  r.emoji === emoji ? { ...r, count, me: mine ? false : r.me } : r,
                ),
        };
      }),
    });
  },

  setConnected: (connected) => set({ connected }),

  markTyping: (userId) => {
    const typing = new Map(get().typing);
    typing.set(userId, Date.now());
    set({ typing });
  },

  sweepTyping: () => {
    const now = Date.now();
    const typing = new Map([...get().typing].filter(([, at]) => now - at < 5000));
    if (typing.size !== get().typing.size) set({ typing });
  },

  reset: () =>
    set({
      me: null,
      servers: [],
      members: [],
      dms: [],
      serverId: null,
      channelId: null,
      messages: [],
      nextCursor: null,
      connected: false,
      typing: new Map(),
      replyTo: null,
      readStates: new Map(),
      loading: "pending",
      sidebarTab: "channels",
      openChannels: [],
      friendships: [],
      friendsLoaded: false,
      friendsOpen: false,
    }),
}));

// В режиме разработки хранилище доступно из консоли: window.__store.
// Смотреть состояние живьём куда быстрее, чем расставлять console.log.
if (import.meta.env.DEV) {
  (window as unknown as { __store: typeof useStore }).__store = useStore;
}

export const currentServer = (state: State): ServerDto | undefined =>
  state.servers.find((s) => s.id === state.serverId);

/** Есть ли непрочитанное. ULID сортируется как строка, поэтому
 *  сравнение идентификаторов — это сравнение по времени. */
export function hasUnread(state: ReadStateDto | undefined): boolean {
  if (!state?.lastMessageId) return false;
  return state.lastMessageId > (state.lastReadMessageId ?? "");
}

/** Сводка по серверу — для метки и счётчика в рейле.
 *
 *  Принимает готовую карту, а не всё состояние: считать это прямо
 *  в селекторе нельзя. Селектор возвращал бы новые объекты на каждый
 *  вызов, zustand считал бы состояние изменившимся всякий раз, и React
 *  уходил бы в бесконечную перерисовку. Вызывать через useMemo. */
export function serverUnread(
  readStates: Map<string, ReadStateDto>,
  server: ServerDto,
): { unread: boolean; mentions: number } {
  let unread = false;
  let mentions = 0;
  for (const channel of server.channels) {
    const read = readStates.get(channel.id);
    if (hasUnread(read)) unread = true;
    mentions += read?.mentionCount ?? 0;
  }
  return { unread, mentions };
}

export interface ActiveChannel {
  id: string;
  name: string;
  type: "TEXT" | "VOICE" | "DM" | "GROUP_DM";
  topic: string | null;
  isDm: boolean;
}

/** Приводит канал сервера и личную переписку к одному виду.
 *  Дальше по интерфейсу разница между ними почти не нужна: и то,
 *  и другое — канал с историей и полем ввода. */
/** Минимум, нужный для опознания канала. Отдельный тип, а не всё
 *  состояние: вкладкам ни к чему зависеть от сообщений и печатающих,
 *  иначе полоса пересчитывалась бы на каждое нажатие клавиши. */
export interface ChannelSource {
  servers: ServerDto[];
  dms: DmChannelDto[];
  me: State["me"];
}

/** Описание любого канала по идентификатору — для вкладок.
 *  Вкладка может указывать на канал чужого сервера или на переписку,
 *  поэтому искать надо во всём, что известно, а не в текущем сервере. */
export function describeChannel(state: ChannelSource, id: string): ActiveChannel | undefined {
  for (const server of state.servers) {
    const channel = server.channels.find((c) => c.id === id);
    if (channel) {
      return {
        id: channel.id,
        name: channel.name ?? "",
        type: channel.type,
        topic: channel.topic,
        isDm: false,
      };
    }
  }

  const dm = state.dms.find((d) => d.id === id);
  if (!dm) return undefined;
  const other = dm.participants.find((p) => p.id !== state.me?.id) ?? dm.participants[0];
  return {
    id: dm.id,
    name: other?.displayName ?? "Переписка",
    type: dm.type,
    topic: other ? `@${other.username}` : null,
    isDm: true,
  };
}

export const activeChannel = (state: State): ActiveChannel | undefined => {
  if (!state.channelId) return undefined;

  if (state.serverId) {
    const channel = currentServer(state)?.channels.find((c) => c.id === state.channelId);
    if (channel) {
      return {
        id: channel.id,
        name: channel.name ?? "",
        type: channel.type,
        topic: channel.topic,
        isDm: false,
      };
    }
    // Не нашли среди каналов сервера — значит открыта личная переписка
    // на вкладке «Личные». Сервер при этом остаётся выбранным, поэтому
    // без этого запасного пути экран был бы пустым.
  }

  const dm = state.dms.find((d) => d.id === state.channelId);
  if (!dm) return undefined;
  // У личной переписки нет собственного названия — показываем
  // собеседника. Себя из списка участников исключаем.
  const other = dm.participants.find((p) => p.id !== state.me?.id) ?? dm.participants[0];
  return {
    id: dm.id,
    name: other?.displayName ?? "Переписка",
    type: dm.type,
    topic: other ? `@${other.username}` : null,
    isDm: true,
  };
};
