import { useState, type ReactNode } from "react";
import { HeadphoneOff, MicOff, MonitorUp, Video, VolumeX } from "lucide-react";
import { usePeople, useStore } from "@/lib/store";
import { usePreferences } from "@/lib/preferences";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { useLongPress, type MenuPoint } from "@/lib/useLongPress";
import { UserVolumeMenu } from "./UserVolumeMenu";

/** Кто сидит в голосовом канале — списком под самим каналом.
 *
 *  Показывается всем, а не только участникам разговора: увидеть,
 *  что друзья уже собрались, надо до того, как заходишь. Ради этого
 *  сервер и держит состав всех каналов, а не только своего. */
export function VoiceMembers({ channelId }: { channelId: string }) {
  const members = useStore((s) => s.voiceMembers.get(channelId));
  const personOf = usePeople();
  const me = useStore((s) => s.me);
  const { prefs } = usePreferences();
  const [menu, setMenu] = useState<{ userId: string; name: string; x: number; y: number } | null>(
    null,
  );

  if (!members || members.size === 0) return null;

  return (
    <ul className="mt-0.5 mb-1 ml-6 space-y-0.5">
      {[...members].map(([userId, state]) => {
        const user = personOf(userId);

        const name = user?.displayName ?? "Участник";
        const silenced = prefs.mutedUsers.includes(userId);

        return (
          <Row
            key={userId}
            // Себе громкость крутить незачем: свой голос мы не слышим.
            onOpen={
              userId === me?.id
                ? undefined
                : (point) => setMenu({ userId, name, x: point.x, y: point.y })
            }
          >
            {user ? (
              <Avatar
                user={user}
                size={20}
                // Зелёная рамка — «говорит». Дорисовывается поверх
                // аватара, чтобы строка не дёргалась по высоте.
                className={cn(
                  "shrink-0 ring-2 transition-colors duration-100",
                  state.speaking ? "ring-online" : "ring-transparent",
                )}
              />
            ) : (
              <span className="size-5 shrink-0 rounded-full bg-raised" />
            )}
            <span
              className={cn(
                "truncate text-sm",
                silenced ? "text-faint line-through" : state.speaking ? "text-bright" : "text-muted",
              )}
            >
              {name}
            </span>
            {silenced && (
              <VolumeX
                role="img"
                aria-label="Заглушён лично вами"
                className="ml-auto size-3.5 shrink-0 text-faint"
              />
            )}
            {state.video && (
              <Video
                role="img"
                aria-label="С камерой"
                className={cn("size-3.5 shrink-0 text-online", silenced ? "" : "ml-auto")}
              />
            )}
            {state.sharing && (
              <MonitorUp
                role="img"
                aria-label="Показывает экран"
                className={cn(
                  "size-3.5 shrink-0 text-online",
                  state.video || silenced ? "" : "ml-auto",
                )}
              />
            )}
            {/* Выключенный звук важнее выключенного микрофона и рисуется
                вместо него: «молчу» и «не слышу вас» — разные вещи,
                и вторая отменяет первую. Двумя значками сразу это
                выглядело бы как две беды, хотя беда одна: человеку
                бесполезно что-либо говорить. */}
            {state.deafened ? (
              <HeadphoneOff
                role="img"
                aria-label="Звук выключен — не слышит"
                className={cn(
                  "size-3.5 shrink-0 text-danger",
                  state.sharing || state.video || silenced ? "" : "ml-auto",
                )}
              />
            ) : (
              state.muted && (
                <MicOff
                  role="img"
                  aria-label="Микрофон выключен"
                  className={cn(
                    "size-3.5 shrink-0 text-danger",
                    state.sharing || state.video || silenced ? "" : "ml-auto",
                  )}
                />
              )
            )}
          </Row>
        );
      })}

      {menu && (
        <UserVolumeMenu
          userId={menu.userId}
          name={menu.name}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
    </ul>
  );
}

/** Строка участника. Отдельным компонентом ради одного хука: правила
 *  React запрещают вызывать его внутри map, а меню громкости нужно
 *  каждой строке своё. */
function Row({
  onOpen,
  children,
}: {
  onOpen?: (point: MenuPoint) => void;
  children: ReactNode;
}) {
  // Пустышка, когда меню не положено (это мы сами): хук всё равно
  // должен вызываться — их количество между отрисовками не меняется.
  const hold = useLongPress(onOpen ?? (() => undefined));

  return (
    <li
      {...(onOpen ? hold : {})}
      className={cn("flex items-center gap-2 px-2 py-0.5", onOpen && "select-none")}
    >
      {children}
    </li>
  );
}
