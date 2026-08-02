import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { WifiOff } from "lucide-react";
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
import { connectSocket, disconnectSocket, getSocket } from "@/lib/socket";
import { currentServer, useStore } from "@/lib/store";
import { AuthScreen } from "@/features/auth/AuthScreen";
import { InvitePage } from "@/features/invites/InvitePage";
import { LoadFailed } from "@/features/shell/LoadFailed";
import { Splash } from "@/components/ui/Splash";
import { FriendsPanel } from "@/features/friends/FriendsPanel";
import { VerifyEmailBanner } from "@/features/auth/VerifyEmailBanner";
import { currentSession } from "@/lib/voice";
import { ServerRail } from "@/features/servers/ServerRail";
import { ChannelSidebar } from "@/features/channels/ChannelSidebar";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { MemberList } from "@/features/members/MemberList";

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

export function App() {
  const me = useStore((s) => s.me);
  const [restoring, setRestoring] = useState(true);
  const [inviteCode, setInviteCode] = useState(readInviteCode);

  // Access-токен живёт только в памяти, поэтому после F5 его нет.
  // Пробуем поднять сессию по httpOnly-cookie, прежде чем показывать
  // форму входа: иначе каждое обновление страницы выкидывало бы
  // пользователя, хотя сессия жива.
  useEffect(() => {
    void (async () => {
      if (await api.restore()) {
        try {
          const r = await api.get<{ user: PrivateUser }>("/auth/me");
          useStore.getState().setMe(r.user);
        } catch {
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

  return me ? <Messenger /> : <AuthScreen />;
}

function Messenger() {
  const serverId = useStore((s) => s.serverId);
  const channelId = useStore((s) => s.channelId);
  const server = useStore(currentServer);
  const connected = useStore((s) => s.connected);
  const loading = useStore((s) => s.loading);
  const friendsOpen = useStore((s) => s.friendsOpen);

  // ── Сокет ──────────────────────────────────────────────────
  useEffect(() => {
    const store = useStore.getState();
    const socket = connectSocket();

    socket.on("connect", () => store.setConnected(true));
    socket.on("disconnect", () => store.setConnected(false));
    socket.on("message:new", (message) => {
      const state = useStore.getState();
      state.noteMessage(message.channelId, message.id);
      state.addMessage(message);
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
    socket.on("presence:update", ({ userId, status }) => {
      const state = useStore.getState();
      state.setMembers(state.members.map((m) => (m.id === userId ? { ...m, status } : m)));
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
    socket.on("voice:peers", ({ channelId, peers }) =>
      useStore.getState().setVoicePeers(channelId, peers),
    );

    socket.on("voice:joined", ({ channelId, peer }) => {
      const state = useStore.getState();
      state.voicePeerJoined(channelId, peer.userId, peer.muted);
      // Вошедший сам предложит соединиться — нам достаточно ждать.
      // Иначе оба бросаются с предложениями одновременно.
    });

    socket.on("voice:left", ({ channelId, userId }) => {
      useStore.getState().voicePeerLeft(channelId, userId);
      currentSession()?.disconnect(userId);
    });

    socket.on("voice:state", ({ channelId, userId, muted }) =>
      useStore.getState().setVoicePeerMuted(channelId, userId, muted),
    );

    socket.on("voice:signal", ({ from, signal }) => {
      void currentSession()?.accept(from, signal);
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

  return (
    <div className="flex h-screen flex-col">
      <VerifyEmailBanner />

      <div className="flex min-h-0 flex-1">
        <ServerRail />
        <ChannelSidebar />
        {loading === "failed" ? (
          <LoadFailed onRetry={loadEverything} />
        ) : friendsOpen ? (
          <FriendsPanel />
        ) : (
          <ChatPanel onLoadMore={loadMore} />
        )}
        {server && <MemberList />}
      </div>

      {/* Плашка выезжает снизу и уезжает обратно. Мгновенное появление
          и исчезновение на мигающей сети выглядит как дёрганье. */}
      <AnimatePresence>
        {!connected && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            className="fixed bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm text-white shadow-lg"
          >
            <WifiOff className="size-4" />
            Соединение потеряно — переподключаюсь…
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
