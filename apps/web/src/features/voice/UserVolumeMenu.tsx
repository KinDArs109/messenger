import { useEffect, useRef } from "react";
import { VolumeX, Volume2 } from "lucide-react";
import { MAX_USER_GAIN, usePreferences } from "@/lib/preferences";
import { setUserVolume, toggleUserMuted } from "./useVoice";

/**
 * Громкость собеседника — по правой кнопке на нём, как в дискорде.
 *
 * Всё здесь только для себя: по сети не уходит ничего. У одного
 * микрофон орёт, у другого шепчет — общий регулятор эту разницу
 * не лечит, он двигает обоих сразу.
 */
export function UserVolumeMenu({
  userId,
  name,
  x,
  y,
  onClose,
}: {
  userId: string;
  name: string;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const { prefs } = usePreferences();
  const box = useRef<HTMLDivElement>(null);
  const muted = prefs.mutedUsers.includes(userId);
  const gain = prefs.userGain[userId] ?? 1;

  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (!box.current?.contains(event.target as Node)) onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Меню не должно уезжать за край экрана — прижимаем к нему.
  const left = Math.min(x, window.innerWidth - 240);
  const top = Math.min(y, window.innerHeight - 150);

  return (
    <div
      ref={box}
      role="menu"
      style={{ left, top }}
      className="fixed z-50 w-56 rounded-lg border border-line bg-sidebar p-2 shadow-2xl"
    >
      <p className="truncate px-2 pt-1 pb-2 text-sm font-semibold text-bright">{name}</p>

      <button
        type="button"
        role="menuitem"
        onClick={() => toggleUserMuted(userId)}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-body hover:bg-hover"
      >
        {muted ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
        {muted ? "Вернуть звук" : "Заглушить"}
      </button>

      <div className="mt-2 px-2 pb-1">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wide text-muted uppercase">Громкость</span>
          <span className="text-xs text-muted">{Math.round(gain * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={MAX_USER_GAIN}
          step={0.05}
          value={gain}
          disabled={muted}
          onChange={(event) => setUserVolume(userId, Number(event.target.value))}
          className="w-full accent-accent disabled:opacity-40"
          aria-label={`Громкость: ${name}`}
        />
        <p className="mt-1.5 text-xs text-muted">
          Только для вас — остальные слышат как прежде. До 500%: тихую гарнитуру общей
          громкостью не вытянуть, она поднимает всех сразу.
        </p>
      </div>
    </div>
  );
}
