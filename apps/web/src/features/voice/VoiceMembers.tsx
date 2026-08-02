import { MicOff } from "lucide-react";
import { useStore } from "@/lib/store";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";

/** Кто сидит в голосовом канале — списком под самим каналом.
 *
 *  Показывается всем, а не только участникам разговора: увидеть,
 *  что друзья уже собрались, надо до того, как заходишь. Ради этого
 *  сервер и держит состав всех каналов, а не только своего. */
export function VoiceMembers({ channelId }: { channelId: string }) {
  const members = useStore((s) => s.voiceMembers.get(channelId));
  const people = useStore((s) => s.members);
  const me = useStore((s) => s.me);

  if (!members || members.size === 0) return null;

  return (
    <ul className="mt-0.5 mb-1 ml-6 space-y-0.5">
      {[...members].map(([userId, state]) => {
        // Своё имя берём из me: себя в списке участников сервера
        // может не быть, если он ещё не догрузился.
        const user =
          userId === me?.id ? me : people.find((p) => p.id === userId);

        return (
          <li key={userId} className="flex items-center gap-2 px-2 py-0.5">
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
                state.speaking ? "text-bright" : "text-muted",
              )}
            >
              {user?.displayName ?? "Участник"}
            </span>
            {state.muted && <MicOff className="ml-auto size-3.5 shrink-0 text-danger" />}
          </li>
        );
      })}
    </ul>
  );
}
