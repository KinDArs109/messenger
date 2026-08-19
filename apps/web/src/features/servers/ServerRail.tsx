import { useMemo, useState } from "react";
import { MessageSquare, Plus } from "lucide-react";
import { hasUnread, serverUnread, useStore } from "@/lib/store";
import { cn, initial } from "@/lib/utils";
import { CreateServerDialog } from "./CreateServerDialog";

/**
 * Выбор сервера — полосой слева.
 *
 * Побывал строкой поверх бокового столбца: полоса занимает семьдесят
 * две точки на всю высоту окна, и ленте их не хватало. Вернулся, потому
 * что строка мельчила — в ней значку доставалось сорок точек против
 * сорока восьми здесь, а кроме значка в рейле нажимать не на что,
 * и он сам себе и мишень, и подпись.
 *
 * Активный отмечен полоской слева: у него она длинная, при наведении
 * короткая, при непрочитанном — короткая постоянно. Одна деталь несёт
 * три состояния.
 */
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

  const dms = useStore((s) => s.dms);
  const channelId = useStore((s) => s.channelId);
  const dmsWaiting = useMemo(
    () => dms.filter((dm) => dm.id !== channelId && hasUnread(readStates.get(dm.id))).length,
    [dms, readStates, channelId],
  );

  return (
    <nav
      aria-label="Серверы"
      // Прокрутка на случай, когда серверов больше, чем влезает
      // по высоте: без неё кнопка «создать» уезжала бы под нижний край
      // без всякой возможности до неё добраться.
      // Отступ сверху считаем от безопасной зоны: на телефоне там вырез
      // камеры. Вне телефона env() равен нулю.
      className="flex w-rail shrink-0 flex-col items-center gap-2 overflow-y-auto bg-rail pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3"
    >
      {/* Раздел личных сообщений — такой же пункт рейла, как сервер,
          поэтому и выглядит одинаково, и ведёт себя одинаково. */}
      <Slot
        active={serverId === null}
        badge={dmsWaiting}
        title={
          dmsWaiting > 0 ? `Личные сообщения — новых переписок: ${dmsWaiting}` : "Личные сообщения"
        }
        onClick={selectHome}
      >
        <MessageSquare className="size-6" />
      </Slot>

      <span aria-hidden className="my-1 h-0.5 w-8 shrink-0 rounded-full bg-raised" />

      {servers.map((server) => {
        const { unread, mentions } = unreadByServer.get(server.id) ?? {
          unread: false,
          mentions: 0,
        };
        return (
          <Slot
            key={server.id}
            active={server.id === serverId}
            badge={mentions}
            dot={unread}
            title={mentions > 0 ? `${server.name} — упоминаний: ${mentions}` : server.name}
            onClick={() => selectServer(server.id)}
          >
            {server.iconUrl ? (
              <img src={server.iconUrl} alt="" className="size-full object-cover" />
            ) : (
              <span className="text-[17px] font-semibold">{initial(server.name)}</span>
            )}
          </Slot>
        );
      })}

      <button
        onClick={() => setCreating(true)}
        title="Создать сервер"
        aria-label="Создать сервер"
        className="flex size-12 shrink-0 items-center justify-center rounded-3xl bg-raised text-online transition-all duration-150 hover:rounded-2xl hover:bg-online hover:text-white"
      >
        <Plus className="size-6" />
      </button>

      {creating && <CreateServerDialog onClose={() => setCreating(false)} />}
    </nav>
  );
}

/** Один значок в полосе. */
function Slot({
  active,
  badge = 0,
  dot = false,
  title,
  onClick,
  children,
}: {
  active: boolean;
  badge?: number;
  dot?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-current={active ? "page" : undefined}
      className="group relative flex size-12 shrink-0 items-center justify-center"
    >
      <span
        aria-hidden
        className={cn(
          "absolute -left-3 w-2 rounded-r bg-bright transition-all duration-200",
          active ? "h-10" : dot ? "h-2 group-hover:h-5" : "h-0 group-hover:h-5",
        )}
      />
      {badge > 0 && (
        <span className="absolute -right-1 -bottom-1 z-10 min-w-5 rounded-full border-2 border-rail bg-danger px-1 text-center text-xs font-bold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      {/* Квадрат со скруглением, которое при наведении подтягивается:
          так значок отзывается на курсор, не двигаясь с места. */}
      <span
        className={cn(
          "flex size-12 items-center justify-center overflow-hidden text-bright transition-all duration-150",
          active
            ? "rounded-2xl bg-accent"
            : "rounded-3xl bg-raised group-hover:rounded-2xl group-hover:bg-accent",
        )}
      >
        {children}
      </span>
    </button>
  );
}
