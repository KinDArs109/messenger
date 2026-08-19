import { useState, type ReactNode } from "react";
import { Rocket } from "lucide-react";
import type { DmChannelDto, MemberDto } from "@messenger/shared";
import { api } from "@/lib/api";
import { usePresence, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useLongPress, type MenuPoint } from "@/lib/useLongPress";
import { Avatar } from "@/components/Avatar";
import { MemberActions } from "./MemberActions";
import { usePlayingOf } from "@/features/friends/usePlaying";

/** Одна и та же пустота на все случаи: новый пустой массив каждый раз
 *  означал бы новую ссылку, а на неё завязана перерисовка. */
const NOBODY: string[] = [];

/**
 * Столбец участников справа.
 *
 * Он побывал внутри левого столбца, под каналами, — ради ширины ленты.
 * Там ему оказалось тесно: список делил прокрутку с каналами, и чтобы
 * посмотреть, кто в сети, приходилось листать мимо всего остального.
 * Вернулся направо, но уже 216 точек вместо 240: в нём только аватар
 * и имя.
 *
 * Кнопки «показать участников» по-прежнему нет — прятать четверых
 * незачем. Столбец просто не рисуется там, где участников не бывает:
 * в личной переписке.
 */
export function MemberList() {
  const serverId = useStore((s) => s.serverId);
  if (!serverId) return null;

  return (
    <aside
      aria-label="Участники"
      // Уже 900 точек столбец прячется. Окно можно сузить до 760,
      // и три колонки оставили бы ленте триста — полторы фразы
      // в строке. Кто в сети, при такой ширине важнее не список,
      // а сама переписка.
      className="hidden w-people shrink-0 overflow-y-auto bg-sidebar px-2 py-4 min-[900px]:block"
    >
      <MemberPanel />
    </aside>
  );
}

/** Сам список. Отдельно от столбца, потому что на телефоне столбца нет
 *  вовсе: там он показывается внутри выезжающей панели, под каналами. */
export function MemberPanel({ className }: { className?: string }) {
  const members = useStore((s) => s.members);
  const me = useStore((s) => s.me);
  const statusOf = usePresence();
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ member: MemberDto; x: number; y: number } | null>(null);

  /** Клик по участнику открывает личную переписку. Если она уже есть,
   *  сервер вернёт существующую — новых пустых каналов не плодим. */
  async function openDm(userId: string) {
    setBusy(userId);
    try {
      const r = await api.post<{ dm: DmChannelDto }>("/dms", { userId });
      const store = useStore.getState();
      store.addDm(r.dm);
      store.selectHome();
      store.selectChannel(r.dm.id);
    } finally {
      setBusy(null);
    }
  }

  // По живому статусу, а не по тому, что приехало вместе со списком:
  // иначе человек, вышедший из сети минуту назад, так и остаётся
  // в группе «В сети» до перезагрузки.
  const online = members.filter((m) => statusOf(m) !== "offline");
  const offline = members.filter((m) => statusOf(m) === "offline");

  return (
    // Ни ширины, ни фона: их задаёт то, во что список вложили —
    // столбец справа на обычном экране, панель каналов на телефоне.
    <div className={className}>
      <Group
        title="В сети"
        members={online}
        meId={me?.id}
        busy={busy}
        onOpenDm={openDm}
        onMenu={(member, x, y) => setMenu({ member, x, y })}
      />
      <Group
        title="Не в сети"
        members={offline}
        dim
        meId={me?.id}
        busy={busy}
        onOpenDm={openDm}
        onMenu={(member, x, y) => setMenu({ member, x, y })}
      />

      {menu && (
        <MemberActions
          member={menu.member}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onOpenDm={() => {
            void openDm(menu.member.id);
            setMenu(null);
          }}
        />
      )}
    </div>
  );
}

function Group({
  title,
  members,
  dim,
  meId,
  busy,
  onOpenDm,
  onMenu,
}: {
  title: string;
  members: MemberDto[];
  dim?: boolean;
  meId?: string;
  busy: string | null;
  onOpenDm: (userId: string) => void;
  onMenu: (member: MemberDto, x: number, y: number) => void;
}) {
  const statusOf = usePresence();
  // Кто поддержал этот сервер — список приезжает вместе с ним.
  //
  // Селектор отдаёт ровно то, что лежит в хранилище, без «?? []»:
  // пустой массив, собранный на месте, — это новая ссылка на каждый
  // вызов, zustand считает такое изменением состояния, и React уходит
  // в бесконечную перерисовку. Поймано живой проверкой: приложение
  // падало на создании сервера с «Maximum update depth exceeded».
  const boostedBy = useStore(
    (s) => s.servers.find((server) => server.id === s.serverId)?.boostedBy,
  );
  const boosters = boostedBy ?? NOBODY;
  if (members.length === 0) return null;

  return (
    <section className="mb-4">
      <h2 className="px-2 pb-1 text-xs font-bold tracking-wide text-muted uppercase">
        {title} — {members.length}
      </h2>
      <ul>
        {members.map((member) => {
          const isMe = member.id === meId;
          const content = (
            <>
              <Avatar user={member} size={32} status={statusOf(member)} />
              {/* Строка вместо одного имени: под именем встаёт «играет
                  в …», если играет. Без игры вторая строка не рисуется
                  вовсе — список не должен разъезжаться на пустом
                  месте. */}
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[15px] font-medium">
                  {member.displayName}
                </span>
                <MemberGame userId={member.id} />
              </span>
              {/* Значок поддержавшего сервер. Из «нитро» друзьям
                  хотелось именно этого: не возможностей, а отличия —
                  видно, кто вложился. */}
              {boosters.includes(member.id) && (
                <Rocket
                  role="img"
                  aria-label="Поддержал сервер"
                  className="size-3.5 shrink-0 text-accent"
                />
              )}
              {member.role !== "MEMBER" && (
                <span className="text-[10px] font-bold tracking-wide text-faint uppercase">
                  {member.role === "OWNER" ? "владелец" : "админ"}
                </span>
              )}
            </>
          );
          const shared = `flex w-full items-center gap-3 rounded px-2 py-1 text-left ${dim ? "opacity-40" : ""}`;

          return (
            <li key={member.id}>
              {isMe ? (
                // Себе не пишут — строка остаётся некликабельной.
                <div className={shared} title={`@${member.username} — это вы`}>
                  {content}
                </div>
              ) : (
                <MemberButton
                  onOpenDm={() => onOpenDm(member.id)}
                  onMenu={(point) => onMenu(member, point.x, point.y)}
                  disabled={busy === member.id}
                  username={member.username}
                  className={shared}
                >
                  {content}
                </MemberButton>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Во что играет — отдельным компонентом, потому что это хук,
 *  а строки участников собираются в цикле. */
function MemberGame({ userId }: { userId: string }) {
  const playing = usePlayingOf(userId);
  if (!playing) return null;
  return <span className="block truncate text-xs text-accent">Играет в {playing}</span>;
}

/** Строка участника. Отдельным компонентом ради хука долгого нажатия:
 *  вызывать его внутри map нельзя. */
function MemberButton({
  onOpenDm,
  onMenu,
  disabled,
  username,
  className,
  children,
}: {
  onOpenDm: () => void;
  onMenu: (point: MenuPoint) => void;
  disabled: boolean;
  username: string;
  className: string;
  children: ReactNode;
}) {
  const hold = useLongPress(onMenu);

  return (
    <button
      onClick={onOpenDm}
      {...hold}
      disabled={disabled}
      title={`Написать @${username} · удерживать — ещё действия`}
      className={cn(className, "select-none hover:bg-hover disabled:opacity-50")}
    >
      {children}
    </button>
  );
}
