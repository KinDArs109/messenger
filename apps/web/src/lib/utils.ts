import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Склейка классов с разрешением конфликтов Tailwind.
 *  `cn("p-2", isBig && "p-4")` даёт "p-4", а не оба класса сразу. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Цвет аватара выводим из идентификатора, а не из случайного числа:
 *  иначе он менялся бы при каждой перерисовке. */
const AVATAR_COLORS = [
  "#5865F2",
  "#3BA55D",
  "#FAA81A",
  "#ED4245",
  "#EB459E",
  "#9B59B6",
  "#1ABC9C",
];

export function avatarColor(id: string): string {
  let sum = 0;
  for (const char of id) sum += char.charCodeAt(0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length]!;
}

export function initial(name: string): string {
  return ([...name][0] ?? "?").toUpperCase();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString("ru-RU")} ${formatTime(iso)}`;
}

/** Разделитель дня в ленте: «сегодня», «вчера» или дата. */
export function formatDay(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return "Сегодня";
  if (sameDay(date, yesterday)) return "Вчера";
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}
