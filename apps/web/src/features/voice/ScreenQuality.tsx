import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Settings } from "lucide-react";
import { usePreferences, type Preferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";

/**
 * Качество демонстрации экрана.
 *
 * Живёт в окне «Что показать»: качество выбирают в ту секунду, когда
 * включают показ, а не заранее в настройках — туда перед показом никто
 * не ходит.
 *
 * Развёрнутым списком это уже пробовали: шесть кнопок в ряд занимают
 * половину окна и мешают тому, ради чего окно открыли, — выбрать, что
 * показывать. Поэтому здесь сводка одной строкой и шестерёнка: обычно
 * ничего менять не надо, а кому надо — тот откроет.
 *
 * В браузере такого окна нет, его рисует сам браузер и вставить туда
 * ничего нельзя. Для браузера тот же выбор остаётся в настройках.
 */

interface Preset {
  label: string;
  note: string;
  height: Preferences["screenHeight"];
  fps: Preferences["screenFps"];
}

const PRESETS: Preset[] = [
  { label: "Игра", note: "плавнее — 1080p, 60 к/с", height: 1080, fps: 60 },
  { label: "Разговор", note: "поровну — 1080p, 30 к/с", height: 1080, fps: 30 },
  { label: "Текст", note: "чётче — 1080p, 15 к/с", height: 1080, fps: 15 },
];

const HEIGHTS: { value: Preferences["screenHeight"]; label: string }[] = [
  { value: 720, label: "720p" },
  { value: 1080, label: "1080p" },
  { value: 0, label: "Как есть" },
];

const RATES: Preferences["screenFps"][] = [15, 30, 60];

/** Во что это обойдётся каналу. Считается тем же способом, что и
 *  потолок битрейта в voice.ts: цифра должна совпадать с тем, что
 *  происходит на самом деле, иначе она хуже, чем никакой. */
function мегабиты(height: number, fps: number): string {
  const h = height > 0 ? height : 1080;
  const value = Math.min(8, (h * h * (16 / 9) * fps * 5) / (1080 * 1920 * 30));
  return value.toFixed(1).replace(".", ",");
}

const heightLabel = (value: Preferences["screenHeight"]): string =>
  HEIGHTS.find((h) => h.value === value)?.label ?? "Как есть";

export function ScreenQuality() {
  const { prefs, setPref } = usePreferences();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<"main" | "height" | "fps">("main");
  const box = useRef<HTMLDivElement>(null);

  const preset = PRESETS.find((p) => p.height === prefs.screenHeight && p.fps === prefs.screenFps);

  // Клик мимо закрывает меню. Без этого оно остаётся висеть поверх
  // списка экранов и мешает ровно тому, ради чего окно открыли.
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  useEffect(() => {
    if (!open) setPage("main");
  }, [open]);

  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-bright">{preset?.label ?? "Своё"}</p>
        <p className="truncate text-xs text-muted">
          {preset?.note.split("—")[1]?.trim() ??
            `${heightLabel(prefs.screenHeight)}, ${prefs.screenFps} к/с`}
          {" · "}
          {/* На одного: в разговоре вчетвером картинка уходит трижды,
              каждому своя. Общий потолок держит сам мессенджер. */}
          до {мегабиты(prefs.screenHeight, prefs.screenFps)} Мбит/с на друга
        </p>
      </div>

      <div ref={box} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          title="Качество показа"
          aria-label="Качество показа"
          aria-expanded={open}
          className={cn(
            "rounded-full p-2.5 transition-colors",
            open ? "bg-accent text-white" : "bg-raised text-bright hover:bg-hover",
          )}
        >
          <Settings className="size-5" />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 bottom-full z-50 mb-2 w-64 rounded-lg border border-line bg-sidebar p-1.5 shadow-xl"
          >
            {page === "main" && (
              <>
                <p className="px-2 py-1.5 text-xs font-semibold text-muted">Режим показа</p>
                {PRESETS.map((item) => (
                  <Row
                    key={item.label}
                    label={item.label}
                    note={item.note}
                    checked={preset === item}
                    onClick={() => {
                      setPref("screenHeight", item.height);
                      setPref("screenFps", item.fps);
                    }}
                  />
                ))}
                <Row label="Своё" checked={!preset} onClick={() => setPage("height")} />

                {!preset && (
                  <>
                    <span className="my-1 block h-px bg-line" />
                    <Deeper
                      label="Разрешение экрана"
                      value={heightLabel(prefs.screenHeight)}
                      onClick={() => setPage("height")}
                    />
                    <Deeper
                      label="Частота кадров"
                      value={`${prefs.screenFps} к/с`}
                      onClick={() => setPage("fps")}
                    />
                  </>
                )}
              </>
            )}

            {page === "height" && (
              <>
                <Back onClick={() => setPage("main")}>Разрешение экрана</Back>
                {HEIGHTS.map((item) => (
                  <Row
                    key={item.label}
                    label={item.label}
                    checked={prefs.screenHeight === item.value}
                    onClick={() => setPref("screenHeight", item.value)}
                  />
                ))}
              </>
            )}

            {page === "fps" && (
              <>
                <Back onClick={() => setPage("main")}>Частота кадров</Back>
                {RATES.map((value) => (
                  <Row
                    key={value}
                    label={`${value} к/с`}
                    checked={prefs.screenFps === value}
                    onClick={() => setPref("screenFps", value)}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Строка выбора с кружком справа — как в списках, где выбирают одно
 *  из нескольких. Галочка тут врала бы: она означает «включено», а не
 *  «выбрано именно это». */
function Row({
  label,
  note,
  checked,
  onClick,
}: {
  label: string;
  note?: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-bright">{label}</span>
        {note && <span className="block truncate text-xs text-muted">{note}</span>}
      </span>
      <span
        aria-hidden
        className={cn(
          "size-4 shrink-0 rounded-full border-2",
          checked ? "border-accent bg-accent" : "border-faint",
        )}
      />
    </button>
  );
}

/** Строка, ведущая вглубь: показывает выбранное и открывает список. */
function Deeper({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover"
    >
      <span className="flex-1 truncate text-sm text-bright">{label}</span>
      <span className="shrink-0 text-xs text-muted">{value}</span>
      <ChevronRight className="size-4 shrink-0 text-faint" />
    </button>
  );
}

function Back({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-1 flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left hover:bg-hover"
    >
      <ChevronLeft className="size-4 shrink-0 text-faint" />
      <span className="truncate text-xs font-semibold text-muted">{children}</span>
    </button>
  );
}
