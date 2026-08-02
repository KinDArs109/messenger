import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover",
  secondary: "bg-raised text-bright hover:bg-active",
  ghost: "bg-transparent text-muted hover:bg-hover hover:text-bright",
  danger: "bg-danger text-white hover:brightness-110",
  link: "bg-transparent text-link hover:underline p-0",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-[15px]",
};

/** У motion свои onDrag и onAnimation*: сигнатуры не совпадают с
 *  нативными, и без этого исключения TypeScript отказывается склеить
 *  два набора пропсов. Перетаскивания у кнопки всё равно нет. */
type NativeButton = Omit<
  ComponentProps<"button">,
  "ref" | "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd" | "onAnimationIteration"
>;

interface Props extends NativeButton {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  full?: boolean;
}

/** Единственная кнопка в проекте.
 *
 *  Отдельный компонент нужен не ради красоты, а ради состояний:
 *  «занята» обязана блокировать повторное нажатие и показывать это,
 *  иначе двойной клик по «Отправить» создаёт два сообщения. Раньше
 *  каждая кнопка решала это по-своему — где-то забывали. */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  full = false,
  disabled,
  className,
  children,
  ...rest
}: Props) {
  const blocked = disabled || loading;

  return (
    <motion.button
      // Нажатие отзывается сжатием: без отклика кнопка на медленной
      // сети кажется сломанной, и человек жмёт ещё раз.
      whileTap={blocked ? undefined : { scale: 0.97 }}
      transition={{ type: "spring", stiffness: 600, damping: 30 }}
      disabled={blocked}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 rounded-md font-medium",
        "transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-55",
        VARIANTS[variant],
        variant !== "link" && SIZES[size],
        full && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 shrink-0 animate-spin" /> : icon}
      {children}
    </motion.button>
  );
}
