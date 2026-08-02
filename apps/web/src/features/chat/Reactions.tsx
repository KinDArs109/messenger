import { useEffect, useRef, useState } from "react";
import { SmilePlus } from "lucide-react";
import { QUICK_REACTIONS, type ReactionDto } from "@messenger/shared";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/** Строка реакций под сообщением. */
export function Reactions({
  messageId,
  reactions,
}: {
  messageId: string;
  reactions: ReactionDto[];
}) {
  if (reactions.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {reactions.map((reaction) => (
        <ReactionChip key={reaction.emoji} messageId={messageId} reaction={reaction} />
      ))}
    </div>
  );
}

function ReactionChip({ messageId, reaction }: { messageId: string; reaction: ReactionDto }) {
  const applyReaction = useStore((s) => s.applyReaction);
  const meId = useStore((s) => s.me?.id);

  async function toggle() {
    if (!meId) return;
    const path = `/messages/${messageId}/reactions/${encodeURIComponent(reaction.emoji)}`;
    // Меняем сразу, не дожидаясь ответа: нажатие на реакцию должно
    // отзываться мгновенно. Событие сокета придёт следом и совпадёт.
    applyReaction({ messageId, userId: meId, emoji: reaction.emoji, added: !reaction.me });
    try {
      if (reaction.me) await api.delete(path);
      else await api.put(path);
    } catch {
      applyReaction({ messageId, userId: meId, emoji: reaction.emoji, added: reaction.me });
    }
  }

  return (
    <button
      onClick={() => void toggle()}
      title={reaction.me ? "Убрать реакцию" : "Поставить реакцию"}
      className={cn(
        "flex items-center gap-1 rounded-lg border px-2 py-0.5 text-sm",
        reaction.me
          ? "border-accent bg-accent/20 text-bright"
          : "border-transparent bg-raised text-muted hover:border-line",
      )}
    >
      <span>{reaction.emoji}</span>
      <span className="text-xs font-semibold">{reaction.count}</span>
    </button>
  );
}

/** Кнопка с быстрым набором эмодзи — в панели действий сообщения. */
export function ReactionPicker({ messageId }: { messageId: string }) {
  const applyReaction = useStore((s) => s.applyReaction);
  const meId = useStore((s) => s.me?.id);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function pick(emoji: string) {
    setOpen(false);
    if (!meId) return;
    applyReaction({ messageId, userId: meId, emoji, added: true });
    try {
      await api.put(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
    } catch {
      applyReaction({ messageId, userId: meId, emoji, added: false });
    }
  }

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Реакция"
        aria-label="Поставить реакцию"
        aria-expanded={open}
        className="rounded p-1.5 text-muted hover:bg-hover hover:text-body"
      >
        <SmilePlus className="size-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 flex gap-0.5 rounded-lg border border-line bg-sidebar p-1.5 shadow-lg"
        >
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              role="menuitem"
              onClick={() => void pick(emoji)}
              className="rounded p-1 text-xl hover:bg-hover"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
