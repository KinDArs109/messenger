import { useEffect, useRef, useState } from "react";
import { Volume1, Volume2, VolumeX } from "lucide-react";
import { MAX_USER_GAIN, usePreferences } from "@/lib/preferences";
import { setScreenVolume } from "./useVoice";
import { cn } from "@/lib/utils";

/**
 * Громкость чужого показа — прямо на самом показе.
 *
 * Отдельно от громкости человека, и это главное. Голос и игра
 * приходят от одного и того же собеседника, но слушают их по-разному:
 * голос надо слышать всегда, а игру — ровно настолько, чтобы понимать,
 * что происходит на экране. Пока ползунок был один на оба, выбор при
 * ревущей игре был скверный: терпеть или заглушить человека вместе
 * с его голосом.
 *
 * Стоит на самом кадре, а не в настройках и не в меню по правой
 * кнопке: громкость игры крутят тогда, когда на неё смотрят, и рука
 * уже там.
 *
 * Видно его всегда. Сначала значок прятался до наведения — чтобы
 * не закрывать собой то, ради чего смотрят, — и это вышло боком:
 * при ревущей игре человек искал, чем её убавить, и не находил
 * ничего. Спрятанная кнопка громкости — то же самое, что её
 * отсутствие. Поэтому теперь она приглушена, но на месте.
 */
export function ScreenVolume({
  userId,
  name,
  big,
}: {
  userId: string;
  name: string;
  big: boolean;
}) {
  const { prefs } = usePreferences();
  const gain = prefs.screenGain[userId] ?? 1;
  const заглушён = prefs.mutedUsers.includes(userId);

  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Ползунок закрывается сам, когда мышь ушла. Держать его открытым
  // поверх чужого экрана незачем: он закрывает как раз то место,
  // куда смотрят.
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const Значок = заглушён || gain === 0 ? VolumeX : gain < 0.9 ? Volume1 : Volume2;
  const процент = Math.round(gain * 100);

  return (
    <div
      ref={box}
      onMouseLeave={() => setOpen(false)}
      className={cn(
        "absolute z-10 flex items-center gap-2",
        big ? "bottom-4 right-4" : "bottom-2 right-2",
        // Приглушена, пока на кадр не навели: и не теряется, и не лезет
        // в глаза поверх чужой игры.
        open || big ? "" : "opacity-70 transition-opacity hover:opacity-100 group-hover/screen:opacity-100",
      )}
    >
      {open && (
        <div className="flex items-center gap-2 rounded-md bg-black/70 px-3 py-2">
          <input
            type="range"
            min={0}
            max={MAX_USER_GAIN}
            step={0.05}
            value={gain}
            disabled={заглушён}
            onChange={(event) => setScreenVolume(userId, Number(event.target.value))}
            aria-label={`Громкость показа: ${name}`}
            className="w-28 accent-accent disabled:opacity-40"
          />
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-bright">
            {заглушён ? "—" : `${процент}%`}
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          // Нажатие по значку — это «выключить звук показа» и обратно.
          // Ползунок для тонкой настройки, значок — для «да выключи
          // ты уже эту игру».
          if (open) setScreenVolume(userId, gain > 0 ? 0 : 1);
          else setOpen(true);
        }}
        title={
          заглушён
            ? `${name} заглушён целиком`
            : `Звук показа: ${процент}%. Голос ${name} этим ползунком не трогается`
        }
        aria-label="Громкость показа"
        className="rounded-md bg-black/50 p-2 text-bright hover:bg-black/70"
      >
        <Значок className={big ? "size-5" : "size-4"} />
      </button>
    </div>
  );
}
