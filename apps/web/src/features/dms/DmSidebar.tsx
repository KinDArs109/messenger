import { useMemo } from "react";
import { MessageSquare, UserPlus } from "lucide-react";
import { hasUnread, usePresence, useStore } from "@/lib/store";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";

/** Список личных переписок — отдельный раздел, открывается кнопкой
 *  в рейле слева.
 *
 *  Раньше он же показывался вкладкой «Личные» внутри сервера, и ради
 *  этого умел прятать свою шапку. Вкладку убрали как дублирующую ту же
 *  кнопку, поэтому и прятать больше нечего. */
export function DmSidebar() {
  const dms = useStore((s) => s.dms);
  const me = useStore((s) => s.me);
  const statusOf = usePresence();
  const channelId = useStore((s) => s.channelId);
  const selectChannel = useStore((s) => s.selectChannel);
  const hasServers = useStore((s) => s.servers.length > 0);
  const readStates = useStore((s) => s.readStates);
  const friendsOpen = useStore((s) => s.friendsOpen);
  const openFriends = useStore((s) => s.openFriends);
  const friendships = useStore((s) => s.friendships);

  // Счётчик показывает только входящие заявки: собственные
  // отправленные висят в ожидании и требуют не вашего действия.
  const incoming = useMemo(
    () =>
      friendships.filter((f) => f.status === "PENDING" && f.direction === "incoming").length,
    [friendships],
  );

  return (
    <>
      {/* pt-safe — ради телефона: панель начинается от самого верха
          экрана, и без отступа заголовок уезжает под вырез камеры. */}
      <div className="flex h-head shrink-0 items-center px-4 pt-safe font-semibold text-bright shadow-[0_1px_0_rgba(0,0,0,0.2)]">
        Личные сообщения
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {/* Друзья стоят над списком переписок, а не в рейле: рейл —
            это серверы, а друзья живут в пространстве личного. */}
        <button
          onClick={openFriends}
          aria-current={friendsOpen ? "true" : undefined}
          className={cn(
            "mb-1 flex w-full items-center gap-3 rounded px-2 py-2",
            friendsOpen ? "bg-active text-bright" : "text-muted hover:bg-hover hover:text-body",
          )}
        >
          <UserPlus className="size-5 shrink-0" />
          <span className="text-[15px] font-medium">Друзья</span>
          {incoming > 0 && (
            <span className="ml-auto rounded-full bg-danger px-1.5 text-xs font-bold text-white">
              {incoming > 99 ? "99+" : incoming}
            </span>
          )}
        </button>

        <h2 className="px-2 pt-2 pb-1 text-xs font-bold tracking-wide text-muted uppercase">
          Переписки — {dms.length}
        </h2>

        {dms.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <MessageSquare className="mx-auto mb-2 size-8 text-faint" />
            <p className="text-sm text-muted">Пока никого</p>
            <p className="mt-1 text-xs text-faint">
              {hasServers
                ? "Откройте сервер и нажмите на участника в списке справа"
                : "Писать пока некому: вступите на сервер, и его участники появятся здесь"}
            </p>
          </div>
        ) : (
          <ul>
            {dms.map((dm) => {
              const other = dm.participants.find((p) => p.id !== me?.id) ?? dm.participants[0];
              if (!other) return null;
              const active = dm.id === channelId;
              const read = readStates.get(dm.id);
              const unread = !active && hasUnread(read);
              const mentions = read?.mentionCount ?? 0;

              return (
                <li key={dm.id} className="relative">
                  {unread && (
                    <span
                      aria-hidden
                      className="absolute top-1/2 -left-2 h-2 w-1 -translate-y-1/2 rounded-r bg-bright"
                    />
                  )}
                  <button
                    onClick={() => selectChannel(dm.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 rounded px-2 py-1.5",
                      active
                        ? "bg-active text-bright"
                        : unread
                          ? "text-bright hover:bg-hover"
                          : "text-muted hover:bg-hover hover:text-body",
                    )}
                  >
                    <Avatar user={other} size={32} status={statusOf(other)} />
                    <span
                      className={cn(
                        "truncate text-[15px]",
                        unread ? "font-semibold" : "font-medium",
                      )}
                    >
                      {other.displayName}
                    </span>
                    {mentions > 0 && (
                      <span className="ml-auto shrink-0 rounded-full bg-danger px-1.5 text-xs font-bold text-white">
                        {mentions > 99 ? "99+" : mentions}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
