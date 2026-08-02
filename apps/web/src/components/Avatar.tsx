import type { UserStatus } from "@messenger/shared";
import { avatarColor, cn, initial } from "@/lib/utils";

const STATUS_COLOR: Record<UserStatus, string> = {
  online: "bg-online",
  idle: "bg-idle",
  dnd: "bg-dnd",
  offline: "bg-offline",
};

interface Props {
  user: { id: string; displayName: string; avatarUrl?: string | null };
  size?: number;
  status?: UserStatus;
  className?: string;
}

export function Avatar({ user, size = 40, status, className }: Props) {
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      {user.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt=""
          className="size-full rounded-full object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="flex size-full items-center justify-center rounded-full font-semibold text-white"
          style={{ background: avatarColor(user.id), fontSize: size * 0.4 }}
        >
          {initial(user.displayName)}
        </div>
      )}

      {status && (
        <span
          // Статус дублируется подписью в title: полагаться на один
          // цвет нельзя, каждый двадцатый мужчина не различает
          // красный и зелёный.
          title={STATUS_LABEL[status]}
          className={cn(
            "absolute -right-0.5 -bottom-0.5 rounded-full border-[3px] border-sidebar",
            STATUS_COLOR[status],
          )}
          style={{ width: size * 0.35, height: size * 0.35 }}
        />
      )}
    </div>
  );
}

const STATUS_LABEL: Record<UserStatus, string> = {
  online: "В сети",
  idle: "Нет на месте",
  dnd: "Не беспокоить",
  offline: "Не в сети",
};
