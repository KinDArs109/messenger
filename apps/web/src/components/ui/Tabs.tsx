import { motion } from "motion/react";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  /** Красный счётчик справа от подписи — непрочитанное, упоминания. */
  badge?: number;
}

interface Props<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** pill — заливка под активной вкладкой, line — подчёркивание. */
  look?: "pill" | "line";
  className?: string;
}

/** Вкладки с переезжающим указателем.
 *
 *  Указатель — один элемент с общим layoutId, а не рамка на каждой
 *  вкладке. Поэтому motion анимирует переход как перемещение одного
 *  объекта: он physически едет от старой вкладки к новой. Вариант
 *  «показать здесь, спрятать там» выглядит как моргание. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  look = "pill",
  className,
}: Props<T>) {
  // Свой layoutId на каждый экземпляр: иначе две группы вкладок
  // на одном экране начали бы перетягивать указатель друг у друга.
  const groupId = useId();

  return (
    <div
      role="tablist"
      className={cn(
        "flex items-center gap-1",
        look === "pill" && "rounded-lg bg-rail p-1",
        look === "line" && "border-b border-line",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            // Без явного type кнопка внутри <form> считается submit —
            // и клик по вкладке отправлял форму вместо переключения.
            type="button"
            role="tab"
            // Подпись лежит во вложенном span вместе со счётчиком,
            // поэтому имя для скринридера задаём явно — иначе вкладка
            // читается как безымянная кнопка.
            aria-label={item.label}
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5",
              "text-sm font-medium transition-colors duration-150",
              look === "line" && "rounded-none pb-2.5",
              active ? "text-bright" : "text-muted hover:text-body",
            )}
          >
            {active && (
              <motion.span
                layoutId={`tab-indicator-${groupId}`}
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
                className={cn(
                  "absolute inset-0 -z-0",
                  look === "pill" && "rounded-md bg-raised",
                  look === "line" && "top-auto h-0.5 rounded-full bg-accent",
                )}
              />
            )}
            <span className="relative z-10 flex items-center gap-2 whitespace-nowrap">
              {item.icon}
              {item.label}
              {item.badge ? (
                <span className="rounded-full bg-danger px-1.5 text-[11px] leading-4 font-bold text-white">
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
