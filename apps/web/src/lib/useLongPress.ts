import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

/** Сколько держать, чтобы это считалось долгим нажатием. Столько же
 *  ждёт система, прежде чем показать своё меню, — её мы и подменяем. */
const HOLD_MS = 450;

/** Насколько палец может сползти, оставаясь нажатием. Меньше — и любое
 *  дрожание руки отменяло бы удержание; больше — и начало прокрутки
 *  ленты открывало бы меню. */
const SLACK = 10;

export interface MenuPoint {
  x: number;
  y: number;
}

/**
 * Один жест на два устройства: правая кнопка мыши и долгое нажатие
 * пальцем открывают одно и то же меню.
 *
 * До этого контекстные меню — громкость участника, действия над
 * человеком — висели только на правом клике, то есть на телефоне
 * их не существовало.
 *
 * Возвращённые свойства раскладываются на элемент целиком:
 * собственный onContextMenu ставить рядом не нужно, он здесь.
 */
export function useLongPress(onOpen: (point: MenuPoint) => void) {
  const timer = useRef<number | null>(null);
  const from = useRef<MenuPoint | null>(null);
  const byTouch = useRef(false);
  // Отпускание пальца после удержания браузер превращает в обычный
  // клик. Без этого флага меню открывалось бы и тут же срабатывало
  // то, на чём палец лежал: например, «написать» на участнике.
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    from.current = null;
  }, []);

  // Таймер переживает размонтирование, если палец подняли не над
  // элементом, — а сработавший коллбэк на удалённом компоненте
  // это ошибка в консоли и, как правило, утечка.
  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      byTouch.current = event.pointerType !== "mouse";
      if (!byTouch.current) return;

      const point = { x: event.clientX, y: event.clientY };
      from.current = point;
      fired.current = false;
      timer.current = window.setTimeout(() => {
        fired.current = true;
        timer.current = null;
        onOpen(point);
      }, HOLD_MS);
    },
    [onOpen],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      const start = from.current;
      if (!start || timer.current === null) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLACK) cancel();
    },
    [cancel],
  );

  const onClickCapture = useCallback((event: ReactMouseEvent) => {
    if (!fired.current) return;
    fired.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const onContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      // Пальцем меню уже открыл таймер — здесь только гасим системное.
      // Мышью открываем сразу: ждать полсекунды с правой кнопкой
      // никто не станет.
      if (!byTouch.current) onOpen({ x: event.clientX, y: event.clientY });
    },
    [onOpen],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture,
    onContextMenu,
  };
}
