import { useMemo, useState } from "react";
import { MessageSquare, Plus } from "lucide-react";
import { serverUnread, useStore } from "@/lib/store";
import { cn, initial } from "@/lib/utils";
import { CreateServerDialog } from "./CreateServerDialog";

export function ServerRail() {
  const servers = useStore((s) => s.servers);
  const serverId = useStore((s) => s.serverId);
  const selectServer = useStore((s) => s.selectServer);
  const selectHome = useStore((s) => s.selectHome);
  const [creating, setCreating] = useState(false);

  // Считаем в useMemo от стабильных ссылок, а не в селекторе:
  // селектор, возвращающий новые объекты, вводит zustand в заблуждение
  // и роняет React в бесконечную перерисовку.
  const readStates = useStore((s) => s.readStates);
  const unreadByServer = useMemo(
    () => new Map(servers.map((srv) => [srv.id, serverUnread(readStates, srv)])),
    [servers, readStates],
  );

  return (
    <nav
      aria-label="Серверы"
      className="flex w-rail shrink-0 flex-col items-center gap-2 bg-rail py-3"
    >
      {/* Раздел личных сообщений — такой же пункт рейла, как сервер,
          поэтому и выглядит одинаково, и ведёт себя одинаково. */}
      <button
        onClick={selectHome}
        aria-current={serverId === null ? "page" : undefined}
        title="Личные сообщения"
        className="group relative flex size-12 items-center justify-center"
      >
        <span
          aria-hidden
          className={cn(
            "absolute -left-3 w-2 rounded-r bg-bright transition-all duration-200",
            serverId === null ? "h-10" : "h-0 group-hover:h-5",
          )}
        />
        <span
          className={cn(
            "flex size-12 items-center justify-center text-bright transition-all duration-150",
            serverId === null
              ? "rounded-2xl bg-accent"
              : "rounded-3xl bg-raised group-hover:rounded-2xl group-hover:bg-accent",
          )}
        >
          <MessageSquare className="size-6" />
        </span>
      </button>

      <span aria-hidden className="my-1 h-0.5 w-8 rounded-full bg-raised" />

      {servers.map((server) => {
        const active = server.id === serverId;
        const { unread, mentions } = unreadByServer.get(server.id) ?? {
          unread: false,
          mentions: 0,
        };
        return (
          <button
            key={server.id}
            onClick={() => selectServer(server.id)}
            aria-current={active ? "page" : undefined}
            title={
              mentions > 0 ? `${server.name} — упоминаний: ${mentions}` : server.name
            }
            className="group relative flex size-12 items-center justify-center"
          >
            {/* Полоска-индикатор слева: у активного сервера длинная,
                при наведении короткая, при непрочитанном — короткая
                постоянно. Одна деталь несёт три состояния. */}
            <span
              aria-hidden
              className={cn(
                "absolute -left-3 w-2 rounded-r bg-bright transition-all duration-200",
                active ? "h-10" : unread ? "h-2 group-hover:h-5" : "h-0 group-hover:h-5",
              )}
            />

            {mentions > 0 && (
              <span className="absolute -right-1 -bottom-1 z-10 min-w-5 rounded-full border-2 border-rail bg-danger px-1 text-center text-xs font-bold text-white">
                {mentions > 99 ? "99+" : mentions}
              </span>
            )}
            <span
              className={cn(
                "flex size-12 items-center justify-center text-[17px] font-semibold text-bright transition-all duration-150",
                active
                  ? "rounded-2xl bg-accent"
                  : "rounded-3xl bg-raised group-hover:rounded-2xl group-hover:bg-accent",
              )}
            >
              {initial(server.name)}
            </span>
          </button>
        );
      })}

      <button
        onClick={() => setCreating(true)}
        title="Создать сервер"
        aria-label="Создать сервер"
        className="flex size-12 items-center justify-center rounded-3xl bg-raised text-online transition-all duration-150 hover:rounded-2xl hover:bg-online hover:text-white"
      >
        <Plus className="size-6" />
      </button>

      {creating && <CreateServerDialog onClose={() => setCreating(false)} />}
    </nav>
  );
}
