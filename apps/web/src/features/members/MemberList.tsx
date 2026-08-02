import { useState } from "react";
import type { DmChannelDto, MemberDto } from "@messenger/shared";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Avatar } from "@/components/Avatar";
import { MemberActions } from "./MemberActions";

export function MemberList() {
  const members = useStore((s) => s.members);
  const open = useStore((s) => s.membersOpen);
  const me = useStore((s) => s.me);
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

  if (!open) return null;

  const online = members.filter((m) => m.status !== "offline");
  const offline = members.filter((m) => m.status === "offline");

  return (
    <aside
      aria-label="Участники"
      className="hidden w-side shrink-0 overflow-y-auto bg-sidebar px-2 py-4 lg:block"
    >
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
    </aside>
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
              <Avatar user={member} size={32} status={member.status} />
              <span className="truncate text-[15px] font-medium">{member.displayName}</span>
              {member.role !== "MEMBER" && (
                <span className="ml-auto text-[10px] font-bold tracking-wide text-faint uppercase">
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
                <button
                  onClick={() => onOpenDm(member.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onMenu(member, event.clientX, event.clientY);
                  }}
                  disabled={busy === member.id}
                  title={`Написать @${member.username} · правая кнопка — ещё действия`}
                  className={`${shared} hover:bg-hover disabled:opacity-50`}
                >
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
