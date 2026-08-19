import { motion } from "motion/react";

/**
 * Переключатель «включено — выключено».
 *
 * Не галочка: галочка означает «отмечено в списке», а здесь у вещи
 * два состояния и оба рабочие. Нажимается вся строка целиком, вместе
 * с подписью, — попадать пальцем в квадратик пять на пять неудобно
 * даже мышью.
 */
export function Toggle({
  label,
  note,
  checked,
  onChange,
  /** Пока ответ не пришёл или переключать нечего. Гасим целиком,
   *  а не прячем: исчезающая настройка выглядит поломкой. */
  disabled = false,
}: {
  label: string;
  note?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-md px-2 py-2.5 text-left hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span
        className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          checked ? "bg-accent" : "bg-raised"
        }`}
      >
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 600, damping: 34 }}
          className={`size-4 rounded-full bg-white ${checked ? "ml-auto" : ""}`}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-body">{label}</span>
        {note && <span className="block text-xs text-faint">{note}</span>}
      </span>
    </button>
  );
}
