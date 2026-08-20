import { useMemo } from "react";
import { create } from "zustand";
import type {
  DmChannelDto,
  FriendshipDto,
  ChosenStatus,
  MemberDto,
  MessageDto,
  PrivateUser,
  PublicUser,
  ReadStateDto,
  ServerDto,
  UserStatus,
} from "@messenger/shared";

interface State {
  me: PrivateUser | null;
  servers: ServerDto[];
  members: MemberDto[];
  dms: DmChannelDto[];
  /**
   * Кто сейчас в сети. Одно место на всё приложение.
   *
   * Раньше статус лежал внутри каждого списка отдельно — в составе
   * сервера, в личных переписках, в друзьях и в своей же карточке, —
   * а событие «сменился статус» правило только состав сервера.
   * Остальные списки так и показывали то, что приехало при загрузке:
   * друг выходил из сети, а в переписках оставался зелёным. Свой
   * кружок не загорался никогда: карточка приезжает до подключения
   * сокета, то есть в тот момент, когда мы и правда ещё не в сети.
   *
   * Здесь же — то, что известно прямо сейчас. Списки остаются такими,
   * какими пришли, и это правильно: они хранят человека, а не его
   * текущее состояние.
   */
  presence: Map<string, UserStatus>;
  setPresence: (userId: string, status: UserStatus) => void;
  /** Что мы выбрали о себе сами — вместе с «невидимым», которого
   *  в присутствии выше нет: наружу он уходит как «не в сети».
   *  Отдельно от me.chosenStatus, потому что меняется чаще, чем
   *  весь профиль, и приезжает своим событием. */
  myStatus: ChosenStatus;
  setMyStatus: (status: ChosenStatus) => void;
  /** Кто во что играет. Рядом с состоянием и по той же причине:
   *  это то, что известно прямо сейчас, а не свойство человека. */
  games: Map<string, string>;
  setGame: (userId: string, game: string | null) => void;
  setGames: (playing: { userId: string; game: string }[]) => void;
  /** Звонок, который сейчас идёт: входящий или исходящий. Живёт
   *  в общем хранилище, а не в компоненте, потому что окно звонка
   *  рисуется поверх всего, а ответить надо из любого места. */
  call: {
    channelId: string;
    peer: PublicUser | null;
    incoming: boolean;
    /** Чем кончилось, если кончилось. Показывается пару секунд. */
    state?: "declined" | "cancelled" | "missed" | "busy" | "offline" | "accepted";
    error?: string;
  } | null;
  setCall: (call: State["call"]) => void;
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
  voiceMembers: Map<
    string,
    Map<
      string,
      { muted: boolean; deafened: boolean; speaking: boolean; sharing: boolean; video: boolean }
    >
  >;
  /** Чужие экраны, которые сейчас показывают: кто → его картинка.
   *  Сами потоки, а не признак «показывает»: их надо отдать в <video>,
   *  и хранить их больше негде. */
  voiceScreens: Map<string, MediaStream>;
  /** Чей показ мы согласились смотреть. null — ничей.
   *
   *  Раньше чужой экран открывался сам, стоило его включить: человек
   *  сидел в разговоре, а ему без спроса разворачивали чужой рабочий
   *  стол. Теперь показ ждёт согласия — как в дискорде. */
  watchingScreen: string | null;
  setWatchingScreen: (userId: string | null) => void;
  /** То же самое для камер. Отдельно от экранов, потому что показывают
   *  их в разных местах: экран — большим полем на весь канал, камеру —
   *  в плитке самого человека, вместо аватара. */
  voiceVideos: Map<string, MediaStream>;
  /** Показываем ли экран мы сами. */
  voiceSharing: boolean;
  /** Включена ли наша камера. */
  voiceVideoOn: boolean;
  voiceMuted: boolean;
  /** Отключён ли звук целиком. Заглушает всех и заодно себя: слышать
   *  не слышишь, значит и говорить не о чем — так же в дискорде. */
  voiceDeafened: boolean;
  /** Микрофон выключен не человеком, а вместе со звуком.
   *
   *  Нужно, чтобы вернуть его при включении звука обратно. Без этого
   *  выходило однобоко: отключаешь звук — микрофон гаснет сам, включаешь
   *  обратно — а он так и остался выключенным, и человек говорит
   *  в пустоту, пока ему не скажут.
   *
   *  Вернуть безусловно нельзя: тот, кто выключил микрофон сам ещё
   *  до этого, не просил его включать. Поэтому и помним, чьё это было
   *  решение. Своё решение человек может переменить в любой момент —
   *  нажал на микрофон, и признак снимается. */
  voiceMutedByDeafen: boolean;
  setVoiceMutedByDeafen: (value: boolean) => void;
  voiceConnecting: boolean;
  /** Когда вошли в разговор, для счётчика времени. null — не в нём. */
  voiceJoinedAt: number | null;
  /** Задержка до самого далёкого собеседника, миллисекунды.
   *  null — мерить не по чему: в канале никого либо связь оборвалась. */
  voicePing: number | null;
  /** Пинг измерен до сервера, а не до собеседника: мы одни в канале.
   *  Различать обязательно — это разные числа про разные вещи. */
  voicePingToServer: boolean;
  /** Разговор идёт через наш ретранслятор, а не напрямую. Показываем
   *  человеку: «через сервер» — это обещание, и оно должно быть
   *  проверяемым, а не написанным в настройках. */
  voiceViaRelay: boolean;

  /** Заодно заводит и сбрасывает счётчик времени: держать его
   *  отдельным действием — значит однажды забыть одно из двух. */
  setVoiceChannel: (channelId: string | null) => void;
  setVoicePing: (ping: number | null, toServer?: boolean, viaRelay?: boolean) => void;
  /** Своя демонстрация не тянет: кодировщик режет картинку.
   *  "cpu" — не хватает компьютера, "bandwidth" — канала. */
  screenTrouble: { reason: "cpu" | "bandwidth"; fps: number | null } | null;
  setScreenTrouble: (reason: "cpu" | "bandwidth" | null, fps: number | null) => void;
  setVoiceConnecting: (connecting: boolean) => void;
  setVoicePeers: (
    channelId: string,
    peers: {
      userId: string;
      muted: boolean;
      deafened?: boolean;
      screenId?: string | null;
      videoId?: string | null;
    }[],
  ) => void;
  voicePeerJoined: (channelId: string, userId: string, muted: boolean, deafened: boolean) => void;
  setVoicePeerSharing: (channelId: string, userId: string, sharing: boolean) => void;
  setVoicePeerVideo: (channelId: string, userId: string, video: boolean) => void;
  setVoiceScreen: (userId: string, stream: MediaStream | null) => void;
  setVoiceVideo: (userId: string, stream: MediaStream | null) => void;
  setVoiceSharing: (sharing: boolean) => void;
  setVoiceVideoOn: (on: boolean) => void;
  voicePeerLeft: (channelId: string, userId: string) => void;
  setVoicePeerMuted: (
    channelId: string,
    userId: string,
    muted: boolean,
    deafened: boolean,
  ) => void;
  setVoiceSpeaking: (userId: string, speaking: boolean) => void;
  setVoiceMuted: (muted: boolean) => void;
  setVoiceDeafened: (deafened: boolean) => void;

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
  /** Сервер переименовали или сменили ему значок. Каналы и роль
   *  при этом не трогаем — они приходят своими событиями. */
  updateServer: (patch: {
    id: string;
    name: string;
    iconUrl: string | null;
    bannerUrl: string | null;
  }) => void;
  /** Эмодзи сервера добавили или убрали. */
  setServerEmoji: (patch: { serverId: string; emoji: { id: string; name: string; url: string }[] }) => void;
  /** Уровень сервера поменялся — кто-то поддержал или снял поддержку. */
  applyBoost: (patch: {
    serverId: string;
    boostedBy: string[];
    level: number;
    bannerUrl: string | null;
  }) => void;
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
  presence: new Map(),
  serverId: null,
  channelId: null,
  messages: [],
  nextCursor: null,
  loadingHistory: false,
  connected: false,
  typing: new Map(),
  replyTo: null,

  setReplyTo: (replyTo) => set({ replyTo }),

  // Новая карта, а не правка старой: подписчики сравнивают ссылку,
  // и по изменённой на месте они бы не перерисовались.
  setPresence: (userId, status) =>
    set((state) => ({ presence: new Map(state.presence).set(userId, status) })),

  myStatus: "online",
  setMyStatus: (myStatus) => set({ myStatus }),

  games: new Map(),
  call: null,

  setCall: (call) => set({ call }),

  setGame: (userId, game) =>
    set((state) => {
      const games = new Map(state.games);
      if (game) games.set(userId, game);
      else games.delete(userId);
      return { games };
    }),

  setGames: (playing) =>
    set((state) => {
      const games = new Map(state.games);
      for (const item of playing) games.set(item.userId, item.game);
      return { games };
    }),

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
  voiceDeafened: false,
  voiceMutedByDeafen: false,
  voiceConnecting: false,
  voiceJoinedAt: null,
  voicePing: null,
  voicePingToServer: false,
  voiceViaRelay: false,
  voiceScreens: new Map(),
  voiceVideos: new Map(),
  voiceSharing: false,
  voiceVideoOn: false,
  watchingScreen: null,
  setWatchingScreen: (watchingScreen) => set({ watchingScreen }),

  setVoiceChannel: (voiceChannelId) =>
    set({ voiceChannelId, voiceJoinedAt: voiceChannelId ? Date.now() : null }),
  setVoiceSharing: (voiceSharing) => set({ voiceSharing }),
  setVoiceVideoOn: (voiceVideoOn) => set({ voiceVideoOn }),

  setVoiceVideo: (userId, stream) => {
    const voiceVideos = new Map(get().voiceVideos);
    if (stream) voiceVideos.set(userId, stream);
    else voiceVideos.delete(userId);
    set({ voiceVideos });
  },

  setVoiceScreen: (userId, stream) => {
    const voiceScreens = new Map(get().voiceScreens);
    if (stream) voiceScreens.set(userId, stream);
    else voiceScreens.delete(userId);

    // Показ кончился — смотреть больше нечего. Без этого «прекратить
    // просмотр» оставалось бы висеть кнопкой в пустоту.
    const watchingScreen =
      get().watchingScreen === userId && !stream ? null : get().watchingScreen;

    set({ voiceScreens, watchingScreen });
  },
  setVoicePing: (voicePing, voicePingToServer = false, voiceViaRelay = false) =>
    set({ voicePing, voicePingToServer, voiceViaRelay }),

  screenTrouble: null,
  setScreenTrouble: (reason, fps) =>
    set({ screenTrouble: reason === null ? null : { reason, fps } }),

  setVoiceConnecting: (voiceConnecting) => set({ voiceConnecting }),

  setVoicePeers: (channelId, peers) => {
    const voiceMembers = new Map(get().voiceMembers);
    voiceMembers.set(
      channelId,
      new Map(
        peers.map((p) => [
          p.userId,
          {
            muted: p.muted,
            deafened: Boolean(p.deafened),
            speaking: false,
            sharing: Boolean(p.screenId),
            video: Boolean(p.videoId),
          },
        ]),
      ),
    );
    set({ voiceMembers });
  },

  voicePeerJoined: (channelId, userId, muted, deafened) => {
    const voiceMembers = new Map(get().voiceMembers);
    const members = new Map(voiceMembers.get(channelId) ?? []);
    members.set(userId, { muted, deafened, speaking: false, sharing: false, video: false });
    voiceMembers.set(channelId, members);
    set({ voiceMembers });
  },

  setVoicePeerSharing: (channelId, userId, sharing) => {
    const voiceMembers = new Map(get().voiceMembers);
    const members = new Map(voiceMembers.get(channelId) ?? []);
    const current = members.get(userId);
    if (!current || current.sharing === sharing) return;
    members.set(userId, { ...current, sharing });
    voiceMembers.set(channelId, members);
    set({ voiceMembers });
  },

  setVoicePeerVideo: (channelId, userId, video) => {
    const voiceMembers = new Map(get().voiceMembers);
    const members = new Map(voiceMembers.get(channelId) ?? []);
    const current = members.get(userId);
    if (!current || current.video === video) return;
    members.set(userId, { ...current, video });
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

  setVoicePeerMuted: (channelId, userId, muted, deafened) => {
    const voiceMembers = new Map(get().voiceMembers);
    const members = new Map(voiceMembers.get(channelId) ?? []);
    const current = members.get(userId);
    if (!current) return;
    members.set(userId, { ...current, muted, deafened });
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
  setVoiceDeafened: (voiceDeafened) => set({ voiceDeafened }),
  setVoiceMutedByDeafen: (voiceMutedByDeafen) => set({ voiceMutedByDeafen }),

  openFriends: () =>
    set({
      friendsOpen: true,
      serverId: null,
      channelId: null,
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

  // Вместе с собой приезжает и свой выбранный статус: он хранится
  // на сервере, и после перезагрузки страницы галочка в меню должна
  // стоять там же, где её оставили.
  setMe: (me) => set(me ? { me, myStatus: me.chosenStatus ?? "online" } : { me }),
  setServers: (servers) => set({ servers }),

  updateServer: ({ id, name, iconUrl, bannerUrl }) =>
    set({
      servers: get().servers.map((s) =>
        s.id === id ? { ...s, name, iconUrl, bannerUrl } : s,
      ),
    }),

  setServerEmoji: ({ serverId, emoji }) =>
    set({
      servers: get().servers.map((s) => (s.id === serverId ? { ...s, emoji } : s)),
    }),

  // Сервер поддержали или поддержку сняли: меняются уровень, список
  // поддержавших и баннер — он появляется и исчезает вместе с уровнем.
  applyBoost: ({ serverId, boostedBy, level, bannerUrl }) =>
    set({
      servers: get().servers.map((s) =>
        s.id === serverId ? { ...s, boostedBy, level, bannerUrl } : s,
      ),
    }),

  removeServer: (serverId) => {
    const state = get();
    const gone = state.servers.find((s) => s.id === serverId);
    if (!gone) return;

    const goneChannels = new Set(gone.channels.map((c) => c.id));
    const inGone = state.channelId !== null && goneChannels.has(state.channelId);

    set({
      servers: state.servers.filter((s) => s.id !== serverId),
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
      messages: [],
      nextCursor: null,
      typing: new Map(),
      replyTo: null,
    });
  },

  /** Открыть канал. Заодно чинит контекст вокруг него: канал чужого
   *  сервера переключает сервер, личная переписка уводит в раздел ЛС.
   *  Иначе открытый канал мог бы не значиться в текущем списке,
   *  и экран остался бы пустым. */
  selectChannel: (channelId) => {
    const state = get();
    if (state.channelId === channelId) return;

    const owner = state.servers.find((s) => s.channels.some((c) => c.id === channelId));
    const isDm = !owner && state.dms.some((d) => d.id === channelId);

    set({
      channelId,
      friendsOpen: false,
      // Личная переписка уводит в раздел ЛС, канал сервера — на его
      // сервер. Раньше это делала вкладка в списке каналов; её убрали,
      // и теперь выбор раздела целиком определяется тем, что открыли.
      // Без этого открытая из вкладки переписка показывалась бы рядом
      // со списком каналов чужого сервера.
      ...(isDm
        ? { serverId: null, members: [] }
        : owner && owner.id !== state.serverId
          ? { serverId: owner.id, members: [] }
          : {}),
      // Ответ относится к конкретному каналу — при переходе сбрасываем,
      // иначе набранная реплика улетит не туда.
      messages: [],
      nextCursor: null,
      typing: new Map(),
      replyTo: null,
    });
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
      presence: new Map(),
      serverId: null,
      channelId: null,
      messages: [],
      nextCursor: null,
      connected: false,
      typing: new Map(),
      replyTo: null,
      readStates: new Map(),
      loading: "pending",
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

/**
 * Чтение статусов: подписывается на карту и отдаёт функцию, которой
 * одинаково удобно пользоваться и для одного человека, и внутри
 * списка, где хук на каждую строку не поставить.
 *
 * Тот статус, что приехал вместе со списком, остаётся запасным
 * ответом: он верен на момент загрузки, и до первого события ничего
 * лучше у нас нет.
 */
export function usePresence(): (user: { id: string; status: UserStatus }) => UserStatus {
  const presence = useStore((s) => s.presence);
  const me = useStore((s) => s.me);
  const myStatus = useStore((s) => s.myStatus);

  return (user) => {
    // Себя показываем по своему же выбору, а не по тому, что о нас
    // разослал сервер. Невидимка для всех «не в сети» — но себе он
    // обязан выглядеть невидимкой, иначе непонятно, работает ли она
    // вообще. Ту же роль играет предупреждающий значок в меню.
    if (me && user.id === me.id) return myStatus === "invisible" ? "offline" : myStatus;
    return presence.get(user.id) ?? user.status;
  };
}

/**
 * Все эмодзи, которые человек может написать: имя → картинка.
 *
 * По всем серверам сразу, а не только по открытому. Эмодзи заводят
 * на одном сервере, а шутят ими везде, включая личные переписки, —
 * и сообщение, приехавшее с другого сервера, должно рисоваться, а не
 * показывать `:название:` голым текстом.
 *
 * Совпадения имён на разных серверах решаются просто: побеждает
 * первое. Спорить тут не о чем — картинки всё равно похожи, раз имя
 * одно и то же.
 */
export function useEmoji(): Map<string, string> {
  const servers = useStore((s) => s.servers);
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const server of servers) {
      for (const emoji of server.emoji ?? []) {
        if (!map.has(emoji.name)) map.set(emoji.name, emoji.url);
      }
    }
    return map;
  }, [servers]);
}

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
    // Не нашли среди каналов сервера — значит открыта личная переписка.
    // Такое бывает у вкладки, оставшейся от прошлого сеанса, поэтому
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
