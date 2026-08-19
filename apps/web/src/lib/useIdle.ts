import { useEffect } from "react";
import { IDLE_AFTER_MS } from "@messenger/shared";
import { desktop } from "./desktop";
import { getSocket } from "./socket";
import { useStore } from "./store";

/**
 * «Неактивен» — само, без нажатий.
 *
 * Ставится не вместо выбранного статуса, а поверх него, и только
 * поверх «в сети»: выбравший «не беспокоить» остаётся с ним и через
 * час тишины — он так решил. Само правило считает сервер, здесь только
 * наблюдение: молчание мыши и клавиатуры видно лишь на этой стороне.
 *
 * Откуда берётся тишина — зависит от того, где мы работаем.
 *
 * В приложении спрашиваем систему: сколько секунд человек ничего
 * не трогал вообще. Это важнее, чем кажется. Играющий в полноэкранную
 * игру не нажимает ничего в мессенджере часами, и по своим событиям
 * он давно «неактивен» — при том что как раз в этот момент он у
 * компьютера и ждёт, когда друзья зайдут в разговор.
 *
 * В браузере системного времени простоя не спросить, там берём свои
 * события. Это хуже, но честнее, чем не показывать ничего: вкладка,
 * забытая на неделю в фоне, не должна светиться «в сети».
 */
export function useIdle(): void {
  const me = useStore((s) => s.me);

  useEffect(() => {
    if (!me) return;

    const shell = desktop();
    let last = Date.now();
    /** Что мы сказали серверу в прошлый раз. null — ещё ничего. */
    let told: boolean | null = null;

    const touch = () => {
      last = Date.now();
    };

    const tell = (away: boolean) => {
      if (told === away) return;
      told = away;
      getSocket()?.emit("presence:away", { away });
    };

    async function check() {
      const seconds = await shell?.system?.idleSeconds?.().catch(() => null);
      // Система знает лучше — но только если оболочка умеет спрашивать.
      // Старая этого не умеет, и тогда работают свои события.
      const quiet = typeof seconds === "number" ? seconds * 1000 : Date.now() - last;
      tell(quiet >= IDLE_AFTER_MS);
    }

    // Раз в полминуты: точность здесь никому не нужна — человек либо
    // отошёл, либо нет, а лишние срабатывания будили бы вкладку зря.
    const timer = setInterval(() => void check(), 30_000);
    void check();

    // Свои события нужны и в приложении: они мгновенно возвращают
    // «в сети», не дожидаясь следующей проверки. Пассивные — чтобы
    // не мешать прокрутке.
    const events = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;
    for (const name of events) window.addEventListener(name, touch, { passive: true });

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      touch();
      tell(false);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      for (const name of events) window.removeEventListener(name, touch);
      document.removeEventListener("visibilitychange", onVisible);
      // Уходя, не оставляем человека отошедшим: следующая вкладка
      // расскажет о нём сама.
      tell(false);
    };
  }, [me]);
}
