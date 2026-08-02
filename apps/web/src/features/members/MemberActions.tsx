import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Ban, MessageSquare, UserMinus } from "lucide-react";
import { can, canActOn, type MemberDto } from "@messenger/shared";
import { api, ApiError } from "@/lib/api";
import { currentServer, useStore } from "@/lib/store";

interface Props {
  member: MemberDto;
  x: number;
  y: number;
  onClose: () => void;
  onOpenDm: () => void;
}

/** Меню по правой кнопке на участнике.
 *
 *  Кик и бан прячем сюда, а не выносим кнопками в строку: это редкие
 *  и необратимые действия, и они не должны стоять там, где палец
 *  промахивается по «написать». */
export function MemberActions({ member, x, y, onClose, onOpenDm }: Props) {
  const server = useStore(currentServer);
  const box = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (!box.current?.contains(event.target as Node)) onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!server) return null;

  const mayKick = can(server.role, "member:kick") && canActOn(server.role, member.role);
  const mayBan = can(server.role, "member:ban") && canActOn(server.role, member.role);

  async function act(kind: "kick" | "ban") {
    if (!server) return;
    const path =
      kind === "kick"
        ? `/servers/${server.id}/members/${member.id}`
        : `/servers/${server.id}/members/${member.id}/ban`;

    setPending(true);
    setError(null);
    try {
      if (kind === "kick") await api.delete(path);
      else await api.post(path, {});
      // Список участников придёт событием member:leave — руками
      // ничего не трогаем, чтобы не разъехалось с сервером.
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не получилось");
      setPending(false);
    }
  }

  return (
    <motion.div
      ref={box}
      role="menu"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.12 }}
      style={{ left: x, top: y }}
      // Меню держим в фиксированных координатах курсора: список
      // участников прокручивается, и привязка к строке уезжала бы.
      className="fixed z-50 w-56 overflow-hidden rounded-md bg-panel py-1 shadow-2xl"
    >
      <Item icon={<MessageSquare className="size-4" />} onClick={onOpenDm}>
        Написать
      </Item>

      {(mayKick || mayBan) && <div className="my-1 h-px bg-line" />}

      {mayKick && (
        <Item
          icon={<UserMinus className="size-4" />}
          danger
          disabled={pending}
          onClick={() => void act("kick")}
        >
          Выгнать
        </Item>
      )}

      {mayBan && (
        <Item
          icon={<Ban className="size-4" />}
          danger
          disabled={pending}
          onClick={() => void act("ban")}
        >
          Забанить
        </Item>
      )}

      {error && <p className="px-3 py-1.5 text-xs text-danger">{error}</p>}
    </motion.div>
  );
}

function Item({
  icon,
  children,
  onClick,
  danger,
  disabled,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm disabled:opacity-50 ${
        danger ? "text-danger hover:bg-danger/10" : "text-body hover:bg-hover"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
