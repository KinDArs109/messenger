import { useEffect, useState } from "react";
import { desktop } from "./desktop";

/**
 * Обновление самого клиента — без перезагрузки руками.
 *
 * На телефоне мессенджер не закрывают: приложение висит в фоне днями,
 * страница не перезагружается, и человек неделю сидит на той сборке,
 * которая была при первом открытии. Снаружи это выглядит как «ничего
 * не чинится»: правки выложены, а до телефона не доехали.
 *
 * Поэтому спрашиваем сами. Признак версии — имя главного файла сборки:
 * в нём хеш содержимого, и оно меняется ровно тогда, когда меняется
 * приложение. Сравнивать номера версий было бы честнее на словах,
 * но их пришлось бы где-то держать и не забывать поднимать; имя файла
 * не соврёт никогда.
 *
 * Перезагружаем сами, но не посреди дела: когда страница спрятана
 * или когда человек ничего не делает. В остальных случаях остаётся
 * кнопка — решать ему.
 */

/** Как часто спрашивать. Десять минут — это и не долго (правку увидят
 *  в тот же вечер), и не нагрузка: один короткий запрос. */
const EVERY_MS = 10 * 60_000;

/** Имя файла сборки, с которой мы сейчас работаем. */
function currentBuild(): string | null {
  const scripts = [...document.querySelectorAll<HTMLScriptElement>("script[src]")];
  const main = scripts.map((s) => s.src).find((src) => /\/assets\/index-[A-Za-z0-9_-]+\.js/.test(src));
  return main ? (main.match(/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? null) : null;
}

/** Что лежит на сервере прямо сейчас. */
async function serverBuild(): Promise<string | null> {
  try {
    const html = await fetch("/app", { cache: "no-store" }).then((r) => (r.ok ? r.text() : ""));
    return html.match(/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? null;
  } catch {
    // Нет сети — не повод шуметь: обновимся в следующий раз.
    return null;
  }
}

/**
 * Применить вышедшее обновление.
 *
 * В браузере это перезагрузка страницы — другого способа нет.
 * В приложении — перезапуск самого мессенджера: перезагрузка обновила
 * бы сайт внутри старой оболочки, а всё нативное (оверлей, горячие
 * клавиши, обновление самой оболочки) осталось бы прежним. Заодно
 * оболочка при перезапуске ставит свой установщик, если он уже скачан.
 *
 * У оболочки постарше метода нет — там по-прежнему перезагрузка,
 * и это лучше, чем ничего.
 */
export function applyUpdate(): void {
  const shell = desktop();
  if (shell?.window.restart) shell.window.restart();
  else location.reload();
}

export function useAppUpdate(busy: boolean): boolean {
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    const mine = currentBuild();
    // В разработке файла сборки нет вовсе — и проверять нечего.
    if (!mine) return;

    let stopped = false;

    async function check() {
      if (stopped || fresh) return;

      // Заодно подталкиваем service worker: без этого он обновляется
      // только когда браузер сам решит перепроверить свой файл.
      void navigator.serviceWorker?.getRegistration().then((r) => r?.update());

      const theirs = await serverBuild();
      if (stopped || !theirs || theirs === mine) return;

      // Спрятанную страницу перезагружаем сразу: человек её не видит,
      // терять нечего, а вернётся он уже на новой версии.
      if (document.visibilityState === "hidden" || !busy) {
        applyUpdate();
        return;
      }
      setFresh(true);
    }

    void check();
    const timer = setInterval(() => void check(), EVERY_MS);
    // Вернулись к приложению — самый удобный момент проверить: как раз
    // тогда, когда оно провисело в фоне полдня.
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [busy, fresh]);

  return fresh;
}
