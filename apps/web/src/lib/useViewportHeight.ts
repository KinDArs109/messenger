import { useEffect } from "react";

/**
 * Высота приложения по видимой части экрана, а не по всей странице.
 *
 * Единица dvh почти решает задачу: она следует за адресной строкой
 * браузера, которая на телефоне прячется при прокрутке. Чего она
 * не знает — экранной клавиатуры. Android об этом просят через
 * interactive-widget в index.html, а Safari на iPhone такой настройки
 * не понимает вовсе: он оставляет страницу прежней высоты и просто
 * задвигает её нижнюю часть под клавиатуру вместе с полем ввода.
 *
 * visualViewport — единственное, что знает правду на обоих: это
 * ровно та часть экрана, которую человек сейчас видит.
 */
export function useViewportHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    /*
     * Высоту в переменную ставим только тогда, когда открыта
     * клавиатура. Всё остальное время её вообще не должно быть:
     * пусть работает dvh — это собственная правда браузера про то,
     * сколько места он оставил странице.
     *
     * Раньше переменная ставилась всегда, и она же оказывалась
     * ловушкой: событие о закрытии клавиатуры телефон присылает
     * не всегда и не сразу, а иногда не присылает вовсе. Тогда
     * в переменной оставалась «высота с клавиатурой» — и мессенджер
     * так и висел на две трети экрана, с огромной пустотой внизу.
     *
     * Клавиатуру узнаём по разнице: видимая часть заметно меньше
     * окна. Порог в пятнадцать процентов не спутать ни с адресной
     * строкой, ни с полосой жестов — те отнимают куда меньше.
     */
    function apply() {
      if (!viewport) return;

      const видно = viewport.height;
      const окно = window.innerHeight || видно;
      const клавиатура = окно - видно > окно * 0.15;

      if (клавиатура) {
        document.documentElement.style.setProperty("--app-height", `${видно}px`);
      } else {
        document.documentElement.style.removeProperty("--app-height");
      }

      // Safari вдобавок прокручивает саму страницу, чтобы показать
      // поле ввода, — и шапка канала уезжает за верхний край.
      // Раз высота теперь верная, прокручивать нечего.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    }

    apply();
    viewport.addEventListener("resize", apply);
    // Поворот телефона и смена размера окна — те же события по сути,
    // но visualViewport о них сообщает не всегда: например, когда
    // повернули свёрнутое приложение. Подписываемся на всё, что
    // означает «размер изменился»; лишний пересчёт стоит одну строчку.
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    // Клавиатура уходит вместе с фокусом, но событие о размере
    // за ней поспевает не всегда — пересчитаем сами.
    window.addEventListener("focusout", apply);
    document.addEventListener("visibilitychange", apply);

    return () => {
      viewport.removeEventListener("resize", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      window.removeEventListener("focusout", apply);
      document.removeEventListener("visibilitychange", apply);
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);
}
