import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Download, Gamepad2, MonitorSmartphone, X, Bell } from "lucide-react";
import { isApp } from "@/lib/desktop";

/**
 * Приглашение поставить приложение.
 *
 * Друзья открывают мессенджер вкладкой и живут в ней: страница выбора
 * показывается один раз, при самом первом заходе, и человек, нажавший
 * «открыть в браузере», больше про приложение не слышит никогда.
 * А половина того, ради чего мессенджер вообще делался, в браузере
 * не работает: окошко поверх игры, уведомления при закрытой вкладке,
 * «друг запустил игру».
 *
 * Поэтому — карточка на видном месте, но с закрывающим крестиком
 * и памятью: закрыли — не появляется две недели. Уговаривать по три
 * раза на дню значит добиться того, что её будут закрывать не глядя.
 *
 * В самом приложении не показывается вовсе — по мосту оболочки видно,
 * что человек уже дошёл.
 */

/** Когда карточку закрыли в прошлый раз. */
const КЛЮЧ = "app-hint-hidden";
const ПАУЗА = 14 * 24 * 60 * 60 * 1000;

/** Телефон, поставивший мессенджер с сайта, открывает его без адресной
 *  строки — по этому признаку он и виден. */
function какПриложение(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

type Куда = "windows" | "android" | "ios" | "other";

/**
 * С чего человек смотрит.
 *
 * Не для красоты: телефону незачем предлагать установщик Windows,
 * а компьютеру — apk. Ошибка не страшна — под карточкой есть общая
 * ссылка на страницу со всеми сборками.
 */
function откуда(): Куда {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Windows/i.test(ua)) return "windows";
  return "other";
}

/**
 * Ради чего ставить — своё для каждого устройства.
 *
 * Общий список выглядел бы убедительнее ровно до того момента, когда
 * телефон прочёл бы про «запускается вместе с Windows». Обещать то,
 * чего на этом устройстве не будет, — верный способ, чтобы и
 * остальному не поверили.
 */
function причины(куда: Куда) {
  if (куда === "android") {
    return [
      { icon: Bell, текст: "Уведомления приходят, даже когда мессенджер закрыт" },
      { icon: MonitorSmartphone, текст: "Открывается своим окном, без адресной строки браузера" },
      { icon: Gamepad2, текст: "Живёт на экране рядом с остальными приложениями" },
    ];
  }

  return [
    { icon: Gamepad2, текст: "Окошко поверх игры: видно, кто говорит, и микрофон под рукой" },
    { icon: Bell, текст: "Уведомления приходят, даже когда мессенджер закрыт" },
    { icon: MonitorSmartphone, текст: "Запускается вместе с Windows и не теряется среди вкладок" },
  ];
}

export function GetTheApp() {
  const [скрыта, setСкрыта] = useState(() => {
    if (isApp() || какПриложение()) return true;
    const когда = Number(localStorage.getItem(КЛЮЧ) ?? 0);
    return Date.now() - когда < ПАУЗА;
  });

  if (скрыта) return null;

  const куда = откуда();

  // На айфоне ставить нечего: приложения в магазине нет, зато сам
  // сайт добавляется на экран «Домой» и открывается как приложение.
  const наАйфоне = куда === "ios";
  const ссылка =
    куда === "android" ? "/download/android" : куда === "windows" ? "/download/setup" : "/";

  function закрыть() {
    localStorage.setItem(КЛЮЧ, String(Date.now()));
    setСкрыта(true);
  }

  return (
    <AnimatePresence initial={false}>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="relative mb-4 overflow-hidden rounded-lg bg-sidebar p-4"
      >
        <button
          type="button"
          onClick={закрыть}
          aria-label="Скрыть"
          className="absolute top-3 right-3 rounded p-1 text-muted hover:bg-hover hover:text-bright"
        >
          <X className="size-4" />
        </button>

        <div className="flex items-start gap-3 pr-8">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/15">
            <Download className="size-5 text-accent" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-bright">
              {наАйфоне ? "Добавьте мессенджер на экран" : "Мессенджер есть приложением"}
            </p>
            <p className="text-sm text-muted">
              {наАйфоне
                ? "Откроется своим окном, без адресной строки"
                : "В браузере работает не всё — вот что добавится"}
            </p>
          </div>
        </div>

        {!наАйфоне && (
          <ul className="mt-3 space-y-1.5">
            {причины(куда).map(({ icon: Иконка, текст }) => (
              <li key={текст} className="flex items-start gap-2 text-sm text-body">
                <Иконка className="mt-0.5 size-4 shrink-0 text-muted" />
                <span>{текст}</span>
              </li>
            ))}
          </ul>
        )}

        {наАйфоне ? (
          <p className="mt-3 text-sm text-body">
            Кнопка «Поделиться» внизу браузера → «На экран „Домой“».
          </p>
        ) : (
          <a
            href={ссылка}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            <Download className="size-4" />
            {куда === "android" ? "Установить на телефон" : "Скачать для Windows"}
          </a>
        )}

        {!наАйфоне && (
          <a href="/" className="mt-3 block text-xs text-link hover:underline">
            Другие сборки и способы
          </a>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
