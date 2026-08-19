import { useCallback, useSyncExternalStore } from "react";

/** Граница телефона. Ровно та же цифра стоит в tokens.css как
 *  --breakpoint-* Tailwind по умолчанию (md = 768px): раскладку
 *  двигает CSS, а поведение — этот хук, и расходиться им нельзя. */
const PHONE = "(max-width: 767px)";

/** Наведения мыши нет — значит палец. Отдельный признак от ширины:
 *  узкое окно на ноутбуке остаётся мышью, планшет в 1024 точки —
 *  пальцем. Первое решает, как расставить панели; второе — показывать
 *  ли то, что появляется только при наведении. */
const TOUCH = "(hover: none) and (pointer: coarse)";

/** useSyncExternalStore, а не useState + useEffect: при первой отрисовке
 *  тот вариант успевал показать раскладку для мыши и только потом
 *  переставить её на телефонную — на глазах у человека. */
function useMedia(query: string): boolean {
  // Подписка обязана быть одной и той же между отрисовками. Иначе React
  // отписывается и подписывается заново после каждой из них, и смена
  // ширины, попавшая в этот промежуток, теряется — раскладка остаётся
  // от прежнего размера окна.
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    [query],
  );

  const read = useCallback(() => matchMedia(query).matches, [query]);

  // На сервере ничего этого нет. Клиент собирается статически,
  // но выключить догадку дешевле, чем однажды на неё наступить.
  return useSyncExternalStore(subscribe, read, () => false);
}

/** Телефонная раскладка: одна панель на экране, остальные в шторках. */
export function useIsPhone(): boolean {
  return useMedia(PHONE);
}

/** Управление пальцем. Всё, что открывается наведением, здесь должно
 *  открываться нажатием — иначе оно недоступно вовсе. */
export function useIsTouch(): boolean {
  return useMedia(TOUCH);
}
