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

    function apply() {
      if (!viewport) return;
      document.documentElement.style.setProperty("--app-height", `${viewport.height}px`);
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

    return () => {
      viewport.removeEventListener("resize", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);
}
