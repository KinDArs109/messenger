import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { AlertCircle, Check } from "lucide-react";
import type { ChosenStatus } from "@messenger/shared";
import { useStore } from "@/lib/store";
import { getSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";

/**
 * Выбор статуса — как в дискорде, по нажатию на себя в углу.
 *
 * Четыре состояния, и все четыре про разное: «в сети» — работай
 * как обычно; «неактивен» — я здесь, но не смотрю; «не беспокоить» —
 * я здесь и не хочу, чтобы меня дёргали; «невидимый» — меня как бы нет.
 *
 * «Не в сети» в списке нет намеренно. Это не выбор, а факт: оно
 * появляется само, когда закрылось последнее окно. Пункт «не в сети»
 * означал бы «сделай вид», а для этого есть невидимка, и она честнее —
 * ты видишь, что прячешься.
 */

const OPTIONS: {
  value: ChosenStatus;
  label: string;
  note?: string;
  dot: string;
}[] = [
  { value: "online", label: "В сети", dot: "bg-online" },
  {
    value: "idle",
    label: "Неактивен",
    note: "Друзья увидят, что вас нет на месте",
    dot: "bg-idle",
  },
  {
    value: "dnd",
    label: "Не беспокоить",
    // Обещаем ровно то, что делаем. Звонок остаётся: не дозвониться
    // до человека, который сидит в мессенджере, — это уже не тишина,
    // а пропажа.
    note: "Ни всплывающих окон, ни уведомлений на телефон. Звонок всё равно прозвонит",
    dot: "bg-dnd",
  },
  {
    value: "invisible",
    label: "Невидимый",
    note: "Для остальных вы «не в сети», но всё работает как обычно",
    dot: "bg-offline",
  },
];

export function StatusMenu({ onClose }: { onClose: () => void }) {
  const myStatus = useStore((s) => s.myStatus);
  const setMyStatus = useStore((s) => s.setMyStatus);
  const box = useRef<HTMLDivElement>(null);

  // Нажатие мимо меню и Esc закрывают его. Оба обязательны: мышью
  // тычут мимо, а с клавиатуры выходят клавишей, и не найти выхода
  // из открытого меню — худшее, что можно сделать.
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // mousedown, а не click: иначе меню закрывается тем же нажатием,
    // которым его открыли.
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const choose = (status: ChosenStatus) => {
    // Сначала показываем, потом сообщаем: ответа сервера тут ждать
    // нечего, а галочка должна переехать в тот же миг, когда нажали.
    setMyStatus(status);
    getSocket()?.emit("presence:set", { status });
    onClose();
  };

  return (
    <motion.div
      ref={box}
      role="menu"
      aria-label="Статус"
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.12 }}
      // Снизу вверх: панель пользователя стоит у нижнего края,
      // и меню, растущее вниз, ушло бы за экран.
      className="absolute bottom-full left-2 z-50 mb-2 w-[260px] overflow-hidden rounded-lg border border-line bg-panel p-1.5 shadow-2xl"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          role="menuitemradio"
          aria-checked={myStatus === option.value}
          onClick={() => choose(option.value)}
          className={cn(
            "flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors",
            myStatus === option.value ? "bg-hover" : "hover:bg-hover",
          )}
        >
          <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", option.dot)} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-bright">{option.label}</span>
            {option.note && (
              <span className="mt-0.5 block text-xs leading-snug text-muted">{option.note}</span>
            )}
          </span>
          {myStatus === option.value && <Check className="mt-0.5 size-4 shrink-0 text-muted" />}
        </button>
      ))}

      {/* Невидимку легко забыть — и потом полдня удивляться, почему
          друзья не пишут. Напоминание висит прямо в меню. */}
      {myStatus === "invisible" && (
        <p className="mt-1 flex items-start gap-1.5 border-t border-line px-2 pt-2 text-xs text-idle">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          Вы невидимы — друзья видят вас «не в сети»
        </p>
      )}
    </motion.div>
  );
}
