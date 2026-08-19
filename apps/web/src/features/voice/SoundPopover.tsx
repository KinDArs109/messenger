import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronUp } from "lucide-react";
import { MAX_GAIN, usePreferences } from "@/lib/preferences";
import { applyMicChange, applySpeakerChange, setMicGain, setOutputGain } from "./useVoice";
import { useDevices } from "./useDevices";

/**
 * Быстрые настройки звука у кнопок микрофона и наушников.
 *
 * Отдельно от окна настроек намеренно: устройство и громкость меняют
 * посреди разговора, когда кто-то уже сказал «тебя не слышно».
 * Открывать ради этого настройки и искать вкладку — три лишних шага
 * там, где нужен один.
 */

const SLIDER =
  "w-full accent-accent";
const LABEL = "text-xs font-semibold tracking-wide text-muted uppercase";

function Popover({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: PointerEvent) {
      if (!box.current?.contains(event.target as Node)) onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={box}
      role="dialog"
      // Вверх, а не вниз: кнопки стоят у нижнего края окна, и меню
      // вниз ушло бы за экран.
      className="absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-lg border border-line bg-sidebar p-3 shadow-2xl"
    >
      {children}
    </div>
  );
}

/** Стрелка-кнопка рядом с основной.
 *
 *  Узкая намеренно: в панели пользователя рядом с ней стоят аватар,
 *  имя и четыре кнопки, и каждая лишняя точка ширины отъедается
 *  у имени.
 *
 *  На телефоне обеих стрелок нет вовсе (pointer-coarse:hidden у обёртки).
 *  Выбирать там не из чего: микрофон один, а куда идёт звук — решает
 *  сама система, когда подключают наушники. Освободившееся место
 *  уходит имени и на то, чтобы в оставшиеся кнопки можно было попасть
 *  пальцем. Громкость и устройства остаются в настройках. */
function Caret({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-expanded={open}
      className="shrink-0 rounded px-0 py-1 text-muted hover:bg-hover hover:text-bright"
    >
      <ChevronUp className={`size-3.5 transition-transform ${open ? "" : "rotate-180"}`} />
    </button>
  );
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Микрофон: устройство и громкость своего голоса. */
export function MicPopover() {
  const [open, setOpen] = useState(false);
  const { prefs, setPref } = usePreferences();
  const { mics } = useDevices(open);

  return (
    <span className="relative pointer-coarse:hidden">
      <Caret open={open} onClick={() => setOpen(!open)} label="Настройки микрофона" />
      <Popover open={open} onClose={() => setOpen(false)}>
        <label className={LABEL} htmlFor="pop-mic">
          Устройство ввода
        </label>
        <select
          id="pop-mic"
          value={prefs.micId}
          onChange={(event) => {
            setPref("micId", event.target.value);
            // Сразу, не дожидаясь следующего разговора.
            applyMicChange();
          }}
          className="mt-1 mb-3 w-full rounded-md border border-line bg-input px-2 py-1.5 text-sm text-bright outline-none focus:border-accent"
        >
          <option value="">Как в Windows</option>
          {mics.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || "Микрофон"}
            </option>
          ))}
        </select>

        <div className="flex items-center justify-between">
          <span className={LABEL}>Громкость микрофона</span>
          <span className="text-xs text-muted">{percent(prefs.micGain)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={MAX_GAIN}
          step={0.05}
          value={prefs.micGain}
          onChange={(event) => setMicGain(Number(event.target.value))}
          className={SLIDER}
          aria-label="Громкость микрофона"
        />
      </Popover>
    </span>
  );
}

/** Наушники: устройство и общая громкость разговора. */
export function OutputPopover() {
  const [open, setOpen] = useState(false);
  const { prefs, setPref } = usePreferences();
  const { speakers } = useDevices(open);

  return (
    <span className="relative pointer-coarse:hidden">
      <Caret open={open} onClick={() => setOpen(!open)} label="Настройки звука" />
      <Popover open={open} onClose={() => setOpen(false)}>
        <label className={LABEL} htmlFor="pop-out">
          Устройство вывода
        </label>
        <select
          id="pop-out"
          value={prefs.speakerId}
          onChange={(event) => {
            setPref("speakerId", event.target.value);
            // Наушники, в отличие от микрофона, переключаются сразу:
            // разговор при этом не прерывается.
            applySpeakerChange();
          }}
          className="mt-1 mb-3 w-full rounded-md border border-line bg-input px-2 py-1.5 text-sm text-bright outline-none focus:border-accent"
        >
          <option value="">Как в Windows</option>
          {speakers.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || "Динамики"}
            </option>
          ))}
        </select>

        <div className="flex items-center justify-between">
          <span className={LABEL}>Громкость звука</span>
          <span className="text-xs text-muted">{percent(prefs.outputGain)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={MAX_GAIN}
          step={0.05}
          value={prefs.outputGain}
          onChange={(event) => setOutputGain(Number(event.target.value))}
          className={SLIDER}
          aria-label="Громкость звука"
        />
        <p className="mt-2 text-xs text-muted">
          Общая громкость. Каждого отдельно — правой кнопкой по человеку в списке. Всё
          применяется сразу, разговор не прерывается.
        </p>
      </Popover>
    </span>
  );
}
