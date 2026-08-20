import { useMemo, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, MessageSquare, UserPlus, UserX, X } from "lucide-react";
import type { DmChannelDto, FriendshipDto } from "@messenger/shared";
import { api, ApiError } from "@/lib/api";
import { usePresence, useStore } from "@/lib/store";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { PaneToggle } from "@/features/shell/MobileShell";
import { Skeleton } from "@/components/ui/Skeleton";
import { usePlayingOf } from "./usePlaying";
import { GetTheApp } from "@/features/shell/GetTheApp";

type Tab = "all" | "pending" | "add";

/** Друзья — единственный способ начать переписку, не имея общего
 *  сервера. До этого написать можно было только тому, кого видишь
 *  в списке участников, то есть знакомство всегда начиналось
 *  с чужого сервера. */
export function FriendsPanel() {
  const friendships = useStore((s) => s.friendships);
  const loaded = useStore((s) => s.friendsLoaded);
  const [tab, setTab] = useState<Tab>("all");

  const accepted = useMemo(
    () => friendships.filter((f) => f.status === "ACCEPTED"),
    [friendships],
  );
  const pending = useMemo(
    () => friendships.filter((f) => f.status === "PENDING"),
    [friendships],
  );
  const incoming = pending.filter((f) => f.direction === "incoming").length;

  const tabs = [
    { value: "all" as const, label: "Друзья", badge: 0 },
    { value: "pending" as const, label: "Заявки", badge: incoming },
    { value: "add" as const, label: "Добавить" },
  ];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-head shrink-0 items-center gap-3 px-2 pt-safe shadow-[0_1px_0_rgba(0,0,0,0.2)] md:px-4">
        <PaneToggle />
        <UserPlus className="size-6 shrink-0 text-faint" />
        <h1 className="font-semibold text-bright">Друзья</h1>
      </header>

      <div className="border-b border-line px-4 py-3">
        <Tabs items={tabs} value={tab} onChange={setTab} />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Про приложение — здесь, а не полосой поверх переписки.
            Друзей открывают затем, чтобы кому-то написать; это самое
            спокойное место в мессенджере, и карточка тут никому
            не перекрывает то, ради чего пришли. Сама решает, показываться
            ли: в приложении её нет, а закрытая не возвращается две
            недели. */}
        <GetTheApp />

        {!loaded ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              {tab === "all" && <FriendList items={accepted} empty="Пока никого. Добавьте по имени пользователя." />}
              {tab === "pending" && <FriendList items={pending} empty="Заявок нет." />}
              {tab === "add" && <AddFriend />}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

function FriendList({ items, empty }: { items: FriendshipDto[]; empty: string }) {
  const statusOf = usePresence();

  /** Кто в сети — наверх.
   *
   *  Список друзей открывают затем, чтобы кому-то написать, а пишут
   *  тому, кто сейчас за компьютером. Держать его в конце по алфавиту
   *  значит заставлять искать глазами то, ради чего список и открыли.
   *
   *  Внутри каждой части — по имени, чтобы порядок не плясал при
   *  каждом чужом входе и выходе. */
  const sorted = useMemo(() => {
    const rank = (f: FriendshipDto) => (statusOf(f.user) === "offline" ? 1 : 0);
    return [...items].sort(
      (a, b) => rank(a) - rank(b) || a.user.displayName.localeCompare(b.user.displayName, "ru"),
    );
  }, [items, statusOf]);

  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">{empty}</p>;
  }

  const online = sorted.filter((f) => statusOf(f.user) !== "offline").length;

  return (
    <ul className="space-y-1">
      {online > 0 && (
        <li className="px-2 pb-1 text-xs font-bold tracking-wide text-muted uppercase">
          В сети — {online}
        </li>
      )}
      <AnimatePresence initial={false}>
        {sorted.map((friendship) => (
          <motion.li
            key={friendship.id}
            layout
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
            <FriendRow friendship={friendship} />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function FriendRow({ friendship }: { friendship: FriendshipDto }) {
  const [busy, setBusy] = useState(false);
  const statusOf = usePresence();
  const { user, status, direction } = friendship;
  const playing = usePlayingOf(user.id);

  async function accept() {
    setBusy(true);
    await api.post(`/friends/${friendship.id}/accept`).catch(() => undefined);
    setBusy(false);
  }

  async function drop() {
    setBusy(true);
    await api.delete(`/friends/${friendship.id}`).catch(() => undefined);
    setBusy(false);
  }

  /** Переписка заводится по требованию, а не на каждого друга сразу:
   *  пустые диалоги в списке ЛС только мешают его читать. */
  async function openDm() {
    setBusy(true);
    try {
      const r = await api.post<{ dm: DmChannelDto }>("/dms", { userId: user.id });
      const store = useStore.getState();
      store.addDm(r.dm);
      store.selectHome();
      store.selectChannel(r.dm.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-hover">
      <Avatar user={user} size={36} status={statusOf(user)} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium text-bright">{user.displayName}</div>
        {/* Играет — вместо логина, а не рядом с ним: строка одна,
            а «во что играет» интереснее, чем «как пишется его имя».
            Логин нужен, только чтобы добавить в друзья, а он уже
            добавлен. */}
        {playing ? (
          <div className="truncate text-xs text-accent">Играет в {playing}</div>
        ) : (
          <div className="truncate text-xs text-muted">
            @{user.username}
            {status === "PENDING" && (
              <span className="text-faint">
                {direction === "incoming" ? " · хочет добавить вас" : " · заявка отправлена"}
              </span>
            )}
          </div>
        )}
      </div>

      {status === "ACCEPTED" ? (
        <>
          <Button size="sm" variant="secondary" loading={busy} onClick={() => void openDm()}>
            <MessageSquare className="size-4" />
            Написать
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Удалить из друзей"
            title="Удалить из друзей"
            onClick={() => void drop()}
          >
            <UserX className="size-4" />
          </Button>
        </>
      ) : direction === "incoming" ? (
        <>
          <Button size="sm" loading={busy} onClick={() => void accept()}>
            <Check className="size-4" />
            Принять
          </Button>
          <Button size="sm" variant="ghost" aria-label="Отклонить" onClick={() => void drop()}>
            <X className="size-4" />
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => void drop()}>
          Отменить
        </Button>
      )}
    </div>
  );
}

function AddFriend() {
  const [username, setUsername] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSent(null);
    try {
      const r = await api.post<{ friendship: FriendshipDto }>("/friends", { username });
      useStore.getState().upsertFriendship(r.friendship);
      setSent(r.friendship.user.displayName);
      setUsername("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-[520px]">
      <label className="mb-2 block text-xs font-bold tracking-wide text-muted uppercase">
        Имя пользователя
      </label>
      <div className="flex gap-2">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase().trim())}
          placeholder="например, boris"
          className="flex-1 rounded-md border border-rail bg-rail p-2.5 text-body outline-none transition-colors focus:border-accent"
        />
        <Button type="submit" loading={pending} disabled={username.length < 2}>
          Отправить
        </Button>
      </div>

      <p className="mt-2 text-xs text-faint">
        Спросите логин у человека — он виден в его профиле и в упоминаниях.
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {sent && (
        <p className="mt-3 rounded-md bg-online/10 px-3 py-2 text-sm text-online">
          Заявка отправлена: {sent}
        </p>
      )}
    </form>
  );
}
