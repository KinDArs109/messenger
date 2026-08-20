import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { RefreshCw, WifiOff } from "lucide-react";
import type {
  DmChannelDto,
  FriendshipDto,
  MemberDto,
  MessageDto,
  PrivateUser,
  ReadStateDto,
  ServerDto,
} from "@messenger/shared";
import { api, setAccessToken } from "@/lib/api";
import { connectSocket, disconnectSocket, getSocket, type AppSocket } from "@/lib/socket";
import { useStore } from "@/lib/store";
import { AuthScreen } from "@/features/auth/AuthScreen";
import { InvitePage } from "@/features/invites/InvitePage";
import { LoadFailed } from "@/features/shell/LoadFailed";
import { TitleBar } from "@/features/shell/TitleBar";
import { usePreferences } from "@/lib/preferences";
import {
  notifyGame,
  notifyMessage,
  notifyVoiceJoin,
  useNotificationClicks,
  useTaskbarBadge,
} from "@/lib/useDesktop";
import { usePushToTalk } from "@/lib/usePushToTalk";
import { useOverlay, useOverlayActions } from "@/features/voice/useOverlay";
import { ScreenPicker } from "@/features/voice/ScreenPicker";
import { isNetworkFailure, lastUser, rememberUser } from "@/lib/offline";
import { Splash } from "@/components/ui/Splash";
import { FriendsPanel } from "@/features/friends/FriendsPanel";
import { usePlaying } from "@/features/friends/usePlaying";
import { CallDialog } from "@/features/voice/CallDialog";
import { useCallEvents } from "@/features/voice/useCalls";
import { currentSession } from "@/lib/voice";
import { playSound } from "@/lib/sounds";
import { ChannelSidebar } from "@/features/channels/ChannelSidebar";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { MemberList } from "@/features/members/MemberList";
import { ServerRail } from "@/features/servers/ServerRail";
import { MobileShell } from "@/features/shell/MobileShell";
import { useIsPhone } from "@/lib/useMobile";
import { useViewportHeight } from "@/lib/useViewportHeight";
import { applyUpdate, useAppUpdate } from "@/lib/useAppUpdate";
import { useIdle } from "@/lib/useIdle";

/** Отметить канал прочитанным. Сначала меняем состояние на месте,
 *  потом сообщаем серверу: индикатор должен гаснуть мгновенно,
 *  а не через круг по сети. */
async function markChannelRead(channelId: string, messageId: string): Promise<void> {
  const before = useStore.getState().readStates.get(channelId)?.lastReadMessageId;
  if (before && before >= messageId) return;

  useStore.getState().markRead(channelId, messageId);
  await api.post(`/reads/${channelId}`, { messageId }).catch(() => undefined);
}

/** Полноценный роутер пока не нужен: адрес у приложения ровно один,
 *  плюс страница приглашения. Появится третий — поставим react-router,
 *  сейчас это была бы зависимость ради одной регулярки. */
function readInviteCode(): string | null {
  return /^\/invite\/([a-z0-9]{4,16})\/?$/.exec(location.pathname)?.[1] ?? null;
}

/**
 * Заявиться в разговор заново после обрыва связи с сервером.
 *
 * Состав голосового канала сервер держит в памяти. Перезапустился он
 * или моргнула сеть — и он про нас забыл, хотя человек никуда
 * не выходил и по-прежнему видит перед собой разговор.
 *
 * Снаружи это выглядит как «мы вдруг перестали друг друга слышать»,
 * и обвиняют в этом звук. На деле звук идёт мимо сервера и живёт;
 * умирает всё, что через сервер: «включил камеру», «показываю экран»,
 * «выключил микрофон» и приход новых людей. Сервер просто не считает
 * нас участником и молча отбрасывает эти сообщения.
 *
 * Поэтому после каждого подключения сокета — не только первого —
 * входим в канал заново и повторяем то, что сервер забыл.
 */
async function rejoinVoice(socket: AppSocket): Promise<void> {
  const store = useStore.getState();
  const channelId = store.voiceChannelId;
  const session = currentSession();
  if (!channelId || !session) return;

  /*
   * Возвращаемся в разговор настойчиво, а не один раз.
   *
   * Раньше здесь стоял один-единственный запрос без срока ожидания.
   * Если ответ не приходил — а после обрыва связи первые секунды
   * самые ненадёжные, — обещание висело вечно: молча, без ошибки
   * и без второй попытки. Снаружи это выглядело так, что человек
   * сидит в разговоре, а его никто не слышит и в составе канала
   * его нет; помогал только выход и вход заново.
   *
   * Теперь три попытки со сроком: сеть после обрыва обычно приходит
   * в себя за секунду-другую.
   */
  let ok = false;
  for (let попытка = 1; попытка <= 3 && !ok; попытка += 1) {
    try {
      ok = await socket.timeout(6000).emitWithAck("voice:join", { channelId });
    } catch {
      ok = false;
    }
    if (!ok) await new Promise((готово) => setTimeout(готово, попытка * 700));
  }

  if (!ok) {
    // Молчать нельзя: человек уверен, что он в разговоре.
    console.error("Не удалось вернуться в разговор после обрыва связи");
    useStore.getState().setVoiceRejoinFailed(true);
    return;
  }
  useStore.getState().setVoiceRejoinFailed(false);

  socket.emit("voice:state", { muted: store.voiceMuted, deafened: store.voiceDeafened });
  if (session.isSharing("screen")) {
    socket.emit("voice:screen", { screenId: session.streamIdOf("screen") });
  }
  if (session.isSharing("video")) {
    socket.emit("voice:video", { videoId: session.streamIdOf("video") });
  }
}

export function App() {
  const { prefs } = usePreferences();

  return (
    // Без этого «спокойный режим» гасил только CSS-анимации, а всё,
    // что двигает motion, — переезжающий указатель вкладок, полоска
    // разговора, переходы в настройках — продолжало двигаться. То же
    // и с системной настройкой: motion по умолчанию её не смотрит.
    //
    // "user" вместо "never": системная настройка сильнее нашей,
    // её ставят по медицинским причинам, а не для вкуса.
    <MotionConfig reducedMotion={prefs.reducedMotion ? "always" : "user"}>
      <AppShell />
    </MotionConfig>
  );
}

function AppShell() {
  useViewportHeight();

  return (
    // Шапка окна — снаружи всего остального и до всякой загрузки.
    //
    // Внутри она стояла раньше и только у вошедших: на экране входа
    // шапки не было, а системной полосы у приложения нет — окно
    // нельзя было ни подвинуть, ни свернуть, пока не войдёшь.
    // В браузере не рисует ничего.
    // h-app, а не h-screen: 100vh на телефоне считается по экрану
    // без адресной строки браузера, и нижний ряд — поле ввода,
    // кнопки разговора — оказывается за краем видимого. h-app следует
    // и за адресной строкой, и за экранной клавиатурой.
    <div className="flex h-app flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1 flex-col">
        <Routes />
      </div>
      {/* Выбор того, что показывать. В браузере не появляется:
          там это окно рисует сам браузер. */}
      <ScreenPicker />
    </div>
  );
}

function Routes() {
  const me = useStore((s) => s.me);
  const [restoring, setRestoring] = useState(true);
  const [inviteCode, setInviteCode] = useState(readInviteCode);
  const [offline, setOffline] = useState(false);

  // Access-токен живёт только в памяти, поэтому после F5 его нет.
  // Пробуем поднять сессию по httpOnly-cookie, прежде чем показывать
  // форму входа: иначе каждое обновление страницы выкидывало бы
  // пользователя, хотя сессия жива.
  useEffect(() => {
    void (async () => {
      try {
        if (await api.restore()) {
          const r = await api.get<{ user: PrivateUser }>("/auth/me");
          useStore.getState().setMe(r.user);
          // Запоминаем, кто вошёл: без этого приложение без сети
          // показало бы форму входа поверх сохранённой переписки.
          rememberUser(r.user);
        }
      } catch (error) {
        // Разделять обязательно. Сервер отказал — человека правда
        // разлогинили, и показывать ему сохранённое нельзя. Сервер
        // не ответил — он просто выключен, и последняя переписка
        // остаётся его собственной.
        const saved = lastUser();
        if (isNetworkFailure(error) && saved) {
          useStore.getState().setMe(saved);
          setOffline(true);
        } else {
          setAccessToken(null);
        }
      }
      setRestoring(false);
    })();
  }, []);

  if (restoring) return <Splash />;

  function leaveInvite() {
    history.replaceState(null, "", "/");
    setInviteCode(null);
  }

  // Незалогиненного по ссылке не отправляем сначала регистрироваться,
  // а потом искать ссылку заново: показываем, куда его зовут, и после
  // входа он оказывается ровно там же.
  if (inviteCode && !me) {
    return (
      <AuthScreen
        hint={
          <p className="mb-4 rounded-md bg-sidebar px-4 py-3 text-center text-sm text-muted">
            Вас пригласили на сервер. Войдите или создайте учётную запись, чтобы принять.
          </p>
        }
      />
    );
  }

  if (inviteCode) return <InvitePage code={inviteCode} onDone={leaveInvite} />;

  return me ? <Messenger offline={offline} /> : <AuthScreen />;
}

function Messenger({ offline }: { offline: boolean }) {
  const serverId = useStore((s) => s.serverId);
  const channelId = useStore((s) => s.channelId);
  const connected = useStore((s) => s.connected);
  const rejoinFailed = useStore((s) => s.voiceRejoinFailed);
  const loading = useStore((s) => s.loading);
  const friendsOpen = useStore((s) => s.friendsOpen);
  const phone = useIsPhone();

  /**
   * Ругаться на связь можно не сразу.
   *
   * Первые секунды после запуска соединения ещё нет — оно как раз
   * устанавливается, и это нормальный ход вещей, а не поломка. Красная
   * плашка в этот момент встречала человека на каждом входе и пропадала
   * через секунду: раздражает, а сказать ей нечего.
   *
   * Поэтому: пока соединение ни разу не поднялось, молчим — но не
   * бесконечно. Не поднялось за десять секунд — это уже не «загружаемся»,
   * и сказать надо. А после первого удачного соединения плашка работает
   * как раньше и появляется сразу: тут обрыв — это правда обрыв.
   */
  const [everConnected, setEverConnected] = useState(false);
  const [slowStart, setSlowStart] = useState(false);

  useEffect(() => {
    if (connected) setEverConnected(true);
  }, [connected]);

  useEffect(() => {
    if (everConnected) return;
    const timer = setTimeout(() => setSlowStart(true), 10_000);
    return () => clearTimeout(timer);
  }, [everConnected]);

  const warnOffline = everConnected || slowStart;

  // Новая сборка на сервере. Пока человек в разговоре — не трогаем
  // его перезагрузкой, только предлагаем; в остальное время
  // обновляемся сами.
  const inCall = useStore((s) => Boolean(s.voiceChannelId));
  const updateReady = useAppUpdate(inCall);

  // ── Возможности оболочки ───────────────────────────────────
  // В браузере все три ничего не делают.
  useTaskbarBadge();
  useNotificationClicks();
  usePushToTalk();
  // «Неактивен» само собой, когда человек отошёл.
  useIdle();
  // Окошко поверх игры: кто в разговоре и кто говорит, — и меню,
  // которое по нему открывается горячей клавишей.
  useOverlay();
  useOverlayActions();
  // «Играет в …»: оболочка видит запущенную игру, мы рассказываем о ней
  // серверу, сервер — друзьям.
  usePlaying();
  // Подписка на звонки — строго здесь и один раз: повешенная дважды,
  // она звонила бы дважды на один звонок.
  useCallEvents();

  // ── Сокет ──────────────────────────────────────────────────
  useEffect(() => {
    const store = useStore.getState();
    const socket = connectSocket();

    socket.on("connect", () => {
      useStore.getState().setConnected(true);
      void rejoinVoice(socket);
    });
    socket.on("disconnect", () => store.setConnected(false));
    socket.on("message:new", (message) => {
      const state = useStore.getState();
      state.noteMessage(message.channelId, message.id);
      state.addMessage(message);
      // В приложении — системное уведомление. В браузере ничего
      // не делает: там моста нет.
      notifyMessage(message);
      // Если человек смотрит именно этот канал и не отвернулся —
      // сообщение считается прочитанным сразу.
      if (message.channelId === state.channelId && document.hasFocus()) {
        void markChannelRead(message.channelId, message.id);
      }
    });
    socket.on("mention", ({ channelId }) => useStore.getState().bumpMention(channelId));

    // Движение в канале, который сейчас не открыт: полного сообщения
    // не будет, но подсветку непрочитанного зажечь надо.
    socket.on("channel:activity", ({ channelId, messageId, authorId }) => {
      const state = useStore.getState();
      // Своё же сообщение непрочитанным не считается.
      if (authorId === state.me?.id) {
        state.markRead(channelId, messageId);
        return;
      }
      state.noteMessage(channelId, messageId);
    });
    socket.on("message:update", ({ id, content, editedAt }) =>
      useStore.getState().updateMessage(id, content, editedAt),
    );
    socket.on("message:delete", ({ id }) => useStore.getState().removeMessage(id));
    socket.on("reaction:add", ({ messageId, userId, emoji }) =>
      useStore.getState().applyReaction({ messageId, userId, emoji, added: true }),
    );
    socket.on("reaction:remove", ({ messageId, userId, emoji }) =>
      useStore.getState().applyReaction({ messageId, userId, emoji, added: false }),
    );
    socket.on("typing", ({ channelId: id, userId }) => {
      const state = useStore.getState();
      if (id === state.channelId && userId !== state.me?.id) state.markTyping(userId);
    });
    // Одно место на всё приложение. Раньше здесь правился состав
    // сервера — и статус обновлялся только в списке участников,
    // а в личных переписках, в друзьях и в своей карточке оставался
    // тот, что приехал при загрузке.
    socket.on("presence:update", ({ userId, status }) => {
      useStore.getState().setPresence(userId, status);
    });
    // Свой выбор — от сервера: он мог быть сделан на другом
    // устройстве или пережить перезагрузку страницы.
    socket.on("presence:self", ({ status }) => {
      useStore.getState().setMyStatus(status);
    });
    socket.on("presence:game", ({ userId, game }) => {
      useStore.getState().setGame(userId, game);
      // Друг сел за ту же игру, что и мы, — самое время сказать.
      notifyGame(userId, game);
    });
    socket.on("presence:games", ({ playing }) => {
      useStore.getState().setGames(playing);
    });
    socket.on("dm:created", (dm) => useStore.getState().addDm(dm));

    socket.on("member:join", ({ serverId, user }) => {
      const state = useStore.getState();
      if (state.serverId !== serverId) return;
      if (state.members.some((m) => m.id === user.id)) return;
      state.setMembers([...state.members, { ...user, role: "MEMBER" }]);
    });

    socket.on("member:leave", ({ serverId, userId }) => {
      const state = useStore.getState();
      // Выгнали нас — убираем сервер целиком. Оставить его в списке
      // значит показывать каналы, в которые больше не пустят.
      if (userId === state.me?.id) {
        state.removeServer(serverId);
        return;
      }
      if (state.serverId === serverId) {
        state.setMembers(state.members.filter((m) => m.id !== userId));
      }
    });
    socket.on("friend:update", (friendship) => useStore.getState().upsertFriendship(friendship));
    socket.on("friend:remove", ({ id }) => useStore.getState().removeFriendship(id));

    // ── Голос ────────────────────────────────────────────────
    socket.on("voice:peers", ({ channelId, peers }) => {
      useStore.getState().setVoicePeers(channelId, peers);
      // Показ мог начаться до нашего прихода. Раз состав пришёл
      // вместе с именами потоков — сразу и объявляем, иначе чужой
      // экран останется невидимым до его перезапуска.
      // Состав приходит теперь и по каналам, где нас нет: сервер шлёт
      // снимок всех видимых каналов при подключении, чтобы было видно,
      // что друзья уже собрались. Соединяться при этом можно только
      // со своим каналом — иначе мы полезем звонить людям в соседний.
      const state = useStore.getState();
      if (channelId !== state.voiceChannelId) return;

      const session = currentSession();
      const meId = state.me?.id;
      for (const peer of peers) {
        session?.announce(peer.userId, "screen", peer.screenId ?? null);
        session?.announce(peer.userId, "video", peer.videoId ?? null);

        // Соединение могло не пережить обрыв связи. Поднимаем только
        // те, которых нет: живое трогать нельзя, лишнее предложение
        // посреди разговора роняет звук на пару секунд. Инициатива
        // на нас — состав мы только что запросили сами.
        if (session && peer.userId !== meId && !session.isConnectedTo(peer.userId)) {
          session.connectTo(peer.userId, true);
        }
      }
    });

    socket.on("voice:joined", ({ channelId, peer }) => {
      const state = useStore.getState();
      state.voicePeerJoined(channelId, peer.userId, peer.muted, Boolean(peer.deafened));
      // Сигнал — только про свой канал. Состав приходит теперь и по
      // чужим, и без этой проверки приложение пищало бы каждый раз,
      // когда кто-то заходит в соседнюю комнату.
      if (channelId === state.voiceChannelId) playSound("join");
      // А не сидящим в разговоре — уведомление на рабочий стол. Только
      // отсюда, не из voice:peers: там приезжает состав целиком, и на
      // каждое переподключение сыпалось бы окошко про каждого.
      notifyVoiceJoin(channelId, peer.userId);
      // Вошедший сам предложит соединиться — нам достаточно ждать.
      // Иначе оба бросаются с предложениями одновременно.
    });

    socket.on("voice:left", ({ channelId, userId }) => {
      const state = useStore.getState();
      state.voicePeerLeft(channelId, userId);
      currentSession()?.disconnect(userId);
      if (channelId === state.voiceChannelId) playSound("leave");
    });

    /*
     * Тот же человек вошёл в разговор с другого устройства.
     *
     * Выходим молча и до конца: разговор, из которого сервер нас уже
     * вывел, продолжать нечем — звук идёт, а всё остальное перестало
     * работать. Заметить это самому нельзя, поэтому и говорим вслух.
     */
    socket.on("voice:evicted", () => {
      const store = useStore.getState();
      if (!store.voiceChannelId) return;

      currentSession()?.stop();
      store.setVoiceChannel(null);
      store.setVoiceSharing(false);
      store.setVoiceVideoOn(false);
      playSound("leave");
    });

    socket.on("voice:state", ({ channelId, userId, muted, deafened }) =>
      useStore.getState().setVoicePeerMuted(channelId, userId, muted, Boolean(deafened)),
    );

    socket.on("voice:signal", ({ from, signal }) => {
      void currentSession()?.accept(from, signal);
    });

    // Объявление о показе экрана. Само изображение придёт отдельно,
    // по прямому соединению; здесь только имя потока, по которому его
    // потом опознают среди прочих.
    socket.on("voice:screen", ({ channelId, userId, screenId }) => {
      const state = useStore.getState();
      state.setVoicePeerSharing(channelId, userId, Boolean(screenId));
      currentSession()?.announce(userId, "screen", screenId);
      // Сигнал — про свой канал и про чужой показ: о своём человек
      // и так знает, он только что сам нажал кнопку.
      if (channelId === state.voiceChannelId && userId !== state.me?.id) {
        playSound(screenId ? "screenOn" : "screenOff");
      }
    });

    // Камера — тем же порядком, что и экран: сначала объявление,
    // потом сами кадры по прямому соединению.
    socket.on("voice:video", ({ channelId, userId, videoId }) => {
      useStore.getState().setVoicePeerVideo(channelId, userId, Boolean(videoId));
      currentSession()?.announce(userId, "video", videoId);
    });

    // Сервер переименовали или сменили ему значок. Название стоит
    // в шапке и в ленте слева у всех участников сразу.
    socket.on("server:update", (patch) => {
      useStore.getState().updateServer(patch);
    });

    // Эмодзи завели или убрали — список нужен всем сразу: он рисует
    // уже написанные сообщения, а не только окно выбора.
    socket.on("server:emoji", (patch) => {
      useStore.getState().setServerEmoji(patch);
    });

    // Сервер поддержали — уровень, значки бустеров и баннер меняются
    // у всех сразу, а не только у нажавшего.
    socket.on("server:boost", (patch) => {
      useStore.getState().applyBoost(patch);
    });

    // Человек сменил имя — оно подписано под каждым его сообщением
    // и стоит в списке участников. Обновляем везде, где встречается.
    socket.on("user:update", (user) => {
      const state = useStore.getState();
      state.setMembers(state.members.map((m) => (m.id === user.id ? { ...m, ...user } : m)));
      state.renameAuthor(user);
      if (user.id === state.me?.id) state.setMe({ ...state.me, ...user });
    });

    return () => {
      disconnectSocket();
    };
  }, []);

  // ── Серверы и личные переписки ─────────────────────────────
  const loadEverything = useCallback(async () => {
    useStore.getState().setLoading("pending");
    try {
      const [dms, reads, servers, friends] = await Promise.all([
        api.get<{ dms: DmChannelDto[] }>("/dms"),
        api.get<{ readStates: ReadStateDto[] }>("/reads"),
        api.get<{ servers: ServerDto[] }>("/servers"),
        api.get<{ friendships: FriendshipDto[] }>("/friends"),
      ]);

      const store = useStore.getState();
      store.setDms(dms.dms);
      store.setReadStates(reads.readStates);
      store.setServers(servers.servers);
      store.setFriendships(friends.friendships);
      // Сервер сам не выбирается. Приложение всегда открывается
      // в личных сообщениях: это единственный экран, который
      // осмыслен и у новичка без серверов, и у того, у кого их
      // десяток. Прыгать при запуске в случайный первый сервер —
      // значит каждый раз возвращать человека оттуда, где он был.
      store.setLoading("ready");
    } catch (error) {
      console.error("Не удалось загрузить данные:", error);
      useStore.getState().setLoading("failed");
    }
  }, []);

  useEffect(() => {
    void loadEverything();
  }, [loadEverything]);

  // ── Участники выбранного сервера ───────────────────────────
  // Канал выбирает сам store при смене сервера — здесь только люди.
  useEffect(() => {
    if (!serverId) return;
    void (async () => {
      const r = await api.get<{ members: MemberDto[] }>(`/servers/${serverId}/members`);
      useStore.getState().setMembers(r.members);
    })();
  }, [serverId]);

  // ── История канала ─────────────────────────────────────────
  useEffect(() => {
    if (!channelId) return;
    const socket = getSocket();
    let cancelled = false;

    void (async () => {
      const store = useStore.getState();
      store.setLoadingHistory(true);

      // Сначала подписка, потом история. В обратном порядке
      // сообщение, пришедшее между двумя запросами, потерялось бы:
      // в истории его ещё нет, а события мы ещё не слушаем.
      await socket?.emitWithAck("channel:subscribe", { channelId });

      const r = await api.get<{ messages: MessageDto[]; nextCursor: string | null }>(
        `/channels/${channelId}/messages?limit=50`,
      );
      if (cancelled) return;
      store.setHistory(r.messages, r.nextCursor);
      store.setLoadingHistory(false);

      // История приходит от новых к старым, значит первое — самое
      // свежее. Открыл канал — прочитал.
      const newest = r.messages[0];
      if (newest) {
        useStore.getState().noteMessage(channelId, newest.id);
        void markChannelRead(channelId, newest.id);
      }
    })();

    return () => {
      cancelled = true;
      socket?.emit("channel:unsubscribe", { channelId });
    };
  }, [channelId]);

  // Вернулись во вкладку — то, что накопилось в открытом канале,
  // считается прочитанным.
  useEffect(() => {
    function onFocus() {
      const state = useStore.getState();
      const last = state.messages.at(-1);
      if (state.channelId && last) void markChannelRead(state.channelId, last.id);
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const loadMore = useCallback(() => {
    const store = useStore.getState();
    if (!store.channelId || !store.nextCursor || store.loadingHistory) return;

    void (async () => {
      store.setLoadingHistory(true);
      const r = await api.get<{ messages: MessageDto[]; nextCursor: string | null }>(
        `/channels/${store.channelId}/messages?limit=50&before=${store.nextCursor}`,
      );
      useStore.getState().prependHistory(r.messages, r.nextCursor);
      useStore.getState().setLoadingHistory(false);
    })();
  }, []);

  // Что показывать в середине — одинаково на телефоне и на ноутбуке.
  // Отличается только то, что стоит по бокам от этого.
  //
  // Ничего не выбрано и мы дома — показываем друзей, а не пустой экран
  // с надписью «выберите переписку». Надпись честная, но бесполезная:
  // она называет действие вместо того, чтобы дать его сделать.
  // А открывают приложение чаще всего затем, чтобы посмотреть, кто
  // в сети, и кому-то написать — то есть ровно за этим списком.
  // Совсем пустой учётной записи друзья не помогут: там нужен не
  // список, а первое действие — создать сервер или принять
  // приглашение. Это показывает ChatPanel своим приветствием.
  const blank = useStore(
    (s) => s.servers.length === 0 && s.dms.length === 0 && s.friendships.length === 0,
  );

  const showFriends =
    friendsOpen || (serverId === null && !channelId && loading === "ready" && !blank);

  const main =
    loading === "failed" ? (
      <LoadFailed onRetry={loadEverything} />
    ) : showFriends ? (
      <FriendsPanel />
    ) : (
      <ChatPanel onLoadMore={loadMore} />
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Звук чужих показов рисовался здесь отдельным элементом —
          снаружи любого канала, чтобы не пропадал при уходе в чат.
          Теперь его ведёт голосовой слой, и он не зависит от разметки
          вообще: заодно подчиняется общей громкости и не возвращается
          собеседнику эхом. */}

      {/* Четыре колонки: серверы, каналы, лента, участники. */}
      {phone ? (
        <MobileShell>{main}</MobileShell>
      ) : (
        <div className="flex min-h-0 flex-1">
          <ServerRail />
          <ChannelSidebar />
          {main}
          {/* Сам решает, показываться ли: в личной переписке
              участников нет, и столбец там не рисуется. */}
          <MemberList />
        </div>
      )}

      {/* Звонок — поверх всего: он застаёт человека где угодно,
          в том числе на другом сервере. */}
      <CallDialog />

      {/* Новая версия приложения. Сама перезагрузка происходит молча,
          когда человек не занят; эта строчка — для тех случаев, когда
          он в разговоре и обрывать его нельзя. */}
      <AnimatePresence>
        {updateReady && (
          <motion.button
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            onClick={applyUpdate}
            className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm text-white shadow-lg hover:bg-accent-hover"
          >
            <RefreshCw className="size-4" />
            Вышло обновление — нажмите, чтобы применить
          </motion.button>
        )}
      </AnimatePresence>

      {/* Связь вернулась, а в разговор не пустило. Молчать тут нельзя:
          человек уверен, что сидит в канале, а его там нет — его
          не слышно, и он об этом узнаёт последним. */}
      <AnimatePresence>
        {rejoinFailed && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            className="fixed bottom-[max(4.5rem,env(safe-area-inset-bottom))] left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-lg bg-idle px-4 py-2 text-center text-sm text-black shadow-lg"
          >
            Не удалось вернуться в разговор — нажмите канал ещё раз
          </motion.div>
        )}
      </AnimatePresence>

      {/* Плашка выезжает снизу и уезжает обратно. Мгновенное появление
          и исчезновение на мигающей сети выглядит как дёрганье. */}
      <AnimatePresence>
        {!connected && warnOffline && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            // z-40, чтобы плашка не оказалась под выезжающей панелью
            // на телефоне; max-w и перенос — чтобы длинная фраза
            // не вылезала за узкий экран одной строкой.
            className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-lg bg-danger px-4 py-2 text-center text-sm text-white shadow-lg"
          >
            <WifiOff className="size-4" />
            {/* Разные причины — разные слова. «Переподключаюсь» там,
                где сервер был и пропал; «сохранённая переписка» там,
                где его не было с самого начала: обещать переподключение
                к выключенному ноутбуку бессмысленно. */}
            {offline
              ? "Нет связи — показана сохранённая переписка"
              : "Соединение потеряно — переподключаюсь…"}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
