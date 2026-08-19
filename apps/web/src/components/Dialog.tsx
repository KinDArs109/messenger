import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Ширина окна. Обычным хватает 440, настройкам — нет: пять вкладок
   *  в такую ширину не помещаются и переносятся на вторую строку. */
  width?: 440 | 560;
}

/**
 * Оболочка модального окна: затемнение, рамка и всё поведение.
 *
 * Отдельно от Dialog, потому что настройкам нужна своя раскладка —
 * список слева, содержимое справа, — а заголовок с крестиком и отступы
 * там только мешают. Поведение при этом должно остаться тем же самым:
 * забывается оно легко, а расплачивается за это тот, кто ходит
 * по клавиатуре.
 *
 * Три вещи, о которых потом жалеешь: закрытие по Escape, возврат
 * фокуса на элемент, с которого окно открыли, и удержание фокуса
 * внутри окна. Без последнего Tab уводит на страницу за модалкой,
 * и человек оказывается в невидимом интерфейсе.
 */
export function ModalShell({
  onClose,
  labelledBy,
  maxWidth,
  className,
  children,
}: {
  onClose: () => void;
  labelledBy?: string;
  maxWidth: number;
  className?: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const openedFrom = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openedFrom.current = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      openedFrom.current?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 pt-safe pb-safe"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* max-h-full и колонка — чтобы высокое содержимое прокручивалось
          внутри окна, а не уезжало за край экрана. Раньше потолка
          не было вовсе: окно росло сколько хотело, а overflow-hidden
          то, что не влезло, ещё и обрезал — до нижних кнопок было
          не добраться никак. */}
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={{ maxWidth }}
        className={cn(
          "flex max-h-full w-full flex-col overflow-hidden rounded-md bg-sidebar shadow-2xl",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Обычное модальное окно: заголовок, содержимое, кнопки внизу. */
export function Dialog({ title, description, onClose, children, footer, width = 440 }: Props) {
  const titleId = useId();

  return (
    <ModalShell onClose={onClose} labelledBy={titleId} maxWidth={width}>
      <div className="flex shrink-0 items-start justify-between p-4 pb-0">
        <div>
          <h2 id={titleId} className="text-lg font-semibold text-bright">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        <button
          onClick={onClose}
          aria-label="Закрыть"
          className="rounded p-1 text-muted hover:bg-hover hover:text-body"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* min-h-0 обязателен: без него прокрутка внутри flex-колонки
          не работает — элемент отказывается становиться ниже
          содержимого. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>

      {footer && (
        <div className="flex shrink-0 justify-end gap-2 bg-panel px-4 py-4">{footer}</div>
      )}
    </ModalShell>
  );
}

export function DialogButton({
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }) {
  return (
    <button
      {...props}
      className={
        variant === "primary"
          ? "rounded-sm bg-accent px-6 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          : "rounded-sm px-4 py-2 text-sm text-body hover:underline"
      }
    />
  );
}

export function DialogField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold tracking-wide text-muted uppercase">
        {label}
        {error && <span className="text-danger normal-case"> — {error}</span>}
      </span>
      {children}
    </label>
  );
}

export const dialogInputClass =
  "w-full rounded-sm border border-rail bg-rail p-2.5 text-body outline-none focus:border-accent";
