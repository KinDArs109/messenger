import { useEffect } from "react";

/**
 * Не давать экрану гаснуть.
 *
 * Нужно ровно там, где на экран смотрят, не касаясь его: чужая
 * демонстрация. Телефон меряет бездействие касаниями, поэтому через
 * минуту он гасит экран посреди того, что человек внимательно смотрит.
 *
 * Для одного только разговора не включаем намеренно. Звук прекрасно
 * идёт с погашенным экраном, а гореть впустую полчаса — это половина
 * заряда за разговор, которого никто не просил.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;

    let lock: WakeLockSentinel | null = null;
    let dropped = false;

    async function take() {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        // Отказали — не беда: экран будет гаснуть, как обычно.
        // Батарея на исходе и режим экономии заряда отказывают штатно.
      }
    }

    // Система снимает блокировку сама, стоит свернуть браузер.
    // Вернулись — берём заново, иначе она действует ровно до первого
    // переключения приложения.
    function onVisible() {
      if (!dropped && document.visibilityState === "visible") void take();
    }

    void take();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      dropped = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [active]);
}
