import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Smile } from "lucide-react";
import { useStore } from "@/lib/store";

/**
 * Выбор своих эмодзи сервера.
 *
 * Только свои: обычные смайлики набирают с клавиатуры — на телефоне
 * своей кнопкой, на компьютере через Win+точку, — и повторять здесь
 * системную панель значило бы делать хуже, чем уже есть.
 *
 * Показываем всё, что человеку доступно, по всем его серверам: эмодзи
 * заводят на одном, а шутят ими везде, включая личные переписки.
 */
export function EmojiPicker({ onPick }: { onPick: (name: string) => void }) {
  const servers = useStore((s) => s.servers);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Серверы без эмодзи в списке не показываем: пустой заголовок —
  // это строка, которая ничего не сообщает и занимает место.
  const списки = servers
    .map((server) => ({
      name: server.name,
      emoji: (server.emoji ?? []).filter((e) => e.name.includes(search.trim().toLowerCase())),
    }))
    .filter((group) => group.emoji.length > 0);

  const всего = servers.reduce((n, server) => n + (server.emoji?.length ?? 0), 0);

  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        title={всего > 0 ? "Свои эмодзи" : "Свои эмодзи открываются на третьем уровне сервера"}
        aria-label="Свои эмодзи"
        aria-expanded={open}
        className="shrink-0 rounded p-2 text-muted hover:bg-hover hover:text-bright disabled:opacity-40"
        disabled={всего === 0}
      >
        <Smile className="size-5" />
      </button>

      {open && (
        <motion.div
          ref={box}
          initial={{ opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.12 }}
          role="dialog"
          aria-label="Свои эмодзи"
          // Снизу вверх: поле ввода стоит у нижнего края, и список,
          // растущий вниз, ушёл бы за экран.
          className="absolute bottom-full left-0 z-50 mb-2 max-h-[320px] w-[280px] overflow-y-auto rounded-lg border border-line bg-panel p-2 shadow-2xl"
        >
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск"
            aria-label="Поиск эмодзи"
            className="mb-2 w-full rounded-md bg-input px-2 py-1.5 text-sm text-body outline-none focus:ring-2 focus:ring-accent"
          />

          {списки.length === 0 && <p className="px-1 py-2 text-xs text-muted">Ничего не нашлось</p>}

          {списки.map((group) => (
            <div key={group.name} className="mb-2">
              <p className="px-1 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
                {group.name}
              </p>
              <div className="grid grid-cols-6 gap-1">
                {group.emoji.map((emoji) => (
                  <button
                    key={emoji.id}
                    type="button"
                    onClick={() => {
                      onPick(emoji.name);
                      setOpen(false);
                    }}
                    title={`:${emoji.name}:`}
                    className="flex aspect-square items-center justify-center rounded hover:bg-hover"
                  >
                    <img src={emoji.url} alt={`:${emoji.name}:`} className="size-7 object-contain" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </motion.div>
      )}
    </span>
  );
}
