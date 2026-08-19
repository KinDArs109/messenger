import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";

/**
 * Сколько идёт разговор.
 *
 * Стоит в полоске разговора справа, где раньше было пустое место
 * между надписью и трубкой. Не украшение: по нему видно, что связь
 * держится, а не оборвалась молча, — и заодно понятно, сколько вы
 * уже сидите.
 */
function format(ms: number): string {
  const всего = Math.max(0, Math.floor(ms / 1000));
  const часы = Math.floor(всего / 3600);
  const минуты = Math.floor((всего % 3600) / 60);
  const секунды = всего % 60;
  const дв = (n: number) => String(n).padStart(2, "0");
  // Часы показываем, только когда они есть: «00:07:12» на разговоре
  // в семь минут — лишний шум.
  return часы > 0 ? `${часы}:${дв(минуты)}:${дв(секунды)}` : `${минуты}:${дв(секунды)}`;
}

export function CallTimer({ className }: { className?: string }) {
  const joinedAt = useStore((s) => s.voiceJoinedAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!joinedAt) return;
    // Раз в секунду и только пока в разговоре: таймер, тикающий
    // впустую, перерисовывает сайдбар круглые сутки.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [joinedAt]);

  if (!joinedAt) return null;

  return (
    // tabular-nums — иначе цифры разной ширины дёргают строку
    // на каждой секунде.
    <span className={`tabular-nums ${className ?? ""}`}>{format(now - joinedAt)}</span>
  );
}
