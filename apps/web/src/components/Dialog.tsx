import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** Модальное окно.
 *
 *  Здесь три вещи, которые легко забыть и о которых потом жалеешь:
 *  закрытие по Escape, возврат фокуса на элемент, с которого окно
 *  открыли, и удержание фокуса внутри окна. Без последнего Tab уводит
 *  на страницу за модалкой, и человек на клавиатуре оказывается
 *  в невидимом интерфейсе. */
export function Dialog({ title, description, onClose, children, footer }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const openedFrom = useRef<HTMLElement | null>(null);
  const titleId = useId();

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-[440px] overflow-hidden rounded-md bg-sidebar shadow-2xl"
      >
        <div className="flex items-start justify-between p-4 pb-0">
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

        <div className="p-4">{children}</div>

        {footer && <div className="flex justify-end gap-2 bg-panel px-4 py-4">{footer}</div>}
      </div>
    </div>
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
