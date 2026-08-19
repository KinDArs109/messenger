import { useCallback, useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";

/**
 * Просмотр картинки на весь экран, со своим приближением.
 *
 * Своим — потому что чужое мерцает. Раньше картинка просто лежала
 * поверх затемнения, а увеличивал её сам телефон, щипком по странице.
 * Страница при этом не резиновая: у приложения жёсткая высота в один
 * экран, а всё, что поверх, прибито к его краям. Телефон, увеличивая
 * страницу, двигает видимую область — и прибитое к краям прыгает
 * за ней каждый кадр. Отсюда и мельтешение.
 *
 * Поэтому щипок здесь перехватывается и превращается в масштаб самой
 * картинки. Страница не двигается вовсе, дёргаться нечему.
 */
export function ImageViewer({
  url,
  filename,
  onClose,
}: {
  url: string;
  filename: string;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  /** Пальцы на экране. Два — щипок, один — перетаскивание. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  /** С чего начали щипок: расстояние между пальцами и масштаб. */
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  const MAX = 5;

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Держим картинку в разумных пределах: отпустив щипок ниже
   *  единицы, человек ждёт, что она вернётся на место, а не останется
   *  крошечной в углу. */
  const clamp = useCallback((next: number) => Math.min(MAX, Math.max(1, next)), []);

  function onPointerDown(event: React.PointerEvent) {
    (event.target as Element).setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    moved.current = false;

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale };
      dragging.current = null;
    } else if (scale > 1) {
      dragging.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    }
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinch.current.distance > 0) {
        moved.current = true;
        setScale(clamp((pinch.current.scale * distance) / pinch.current.distance));
      }
      return;
    }

    if (dragging.current) {
      moved.current = true;
      setOffset({ x: event.clientX - dragging.current.x, y: event.clientY - dragging.current.y });
    }
  }

  function onPointerUp(event: React.PointerEvent) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) dragging.current = null;
    // Отпустили и вернулись к единице — картинка встаёт ровно.
    if (scale === 1) setOffset({ x: 0, y: 0 });
  }

  /** Колесо мыши — то же приближение, для тех, кто за столом. */
  function onWheel(event: React.WheelEvent) {
    if (!event.ctrlKey && Math.abs(event.deltaY) < 2) return;
    setScale((current) => clamp(current * (event.deltaY > 0 ? 0.9 : 1.1)));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex touch-none items-center justify-center overscroll-none bg-black/90 select-none"
      role="dialog"
      aria-modal="true"
      aria-label={filename}
      // Щелчок мимо закрывает, но только если это был щелчок,
      // а не конец перетаскивания.
      onClick={() => {
        if (!moved.current) onClose();
      }}
    >
      <img
        src={url}
        alt={filename}
        draggable={false}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={(event) => {
          event.stopPropagation();
          setScale((current) => (current > 1 ? 1 : 2.5));
          setOffset({ x: 0, y: 0 });
        }}
        onClick={(event) => event.stopPropagation()}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          // Пока тянут пальцем — без сглаживания, иначе картинка
          // отстаёт от пальца. Отпустили — возвращается плавно.
          transition: pinch.current || dragging.current ? "none" : "transform 0.15s ease-out",
          cursor: scale > 1 ? "grab" : "zoom-in",
        }}
        className="max-h-full max-w-full object-contain"
      />

      <div className="absolute top-0 right-0 left-0 flex items-center gap-2 p-3 pt-safe">
        <span className="min-w-0 flex-1 truncate text-sm text-white/70">{filename}</span>
        {scale > 1 && (
          <button
            onClick={(event) => {
              event.stopPropagation();
              reset();
            }}
            className="rounded-md bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
          >
            {Math.round(scale * 100)}% · сбросить
          </button>
        )}
        <a
          href={url}
          download={filename}
          onClick={(event) => event.stopPropagation()}
          title="Скачать"
          aria-label="Скачать"
          className="rounded-md bg-white/10 p-2 text-white hover:bg-white/20"
        >
          <Download className="size-5" />
        </a>
        <button
          onClick={onClose}
          title="Закрыть"
          aria-label="Закрыть"
          className="rounded-md bg-white/10 p-2 text-white hover:bg-white/20"
        >
          <X className="size-5" />
        </button>
      </div>

      {scale === 1 && (
        <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/40">
          Щипком или двойным касанием — приблизить
        </p>
      )}
    </div>
  );
}
