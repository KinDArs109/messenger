import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "./styles/tokens.css";
import { App } from "./App.tsx";
import { ErrorBoundary } from "./features/shell/ErrorBoundary.tsx";
import { applyPreferences } from "./lib/preferences.ts";

/**
 * Запомнить, что человек выбрал мессенджер, а не установку.
 *
 * На корне сервер показывает страницу выбора тем, кто пришёл впервые.
 * Раз мы дошли до сюда — выбор сделан, и спрашивать второй раз незачем.
 * Именно cookie, а не localStorage: решение принимает сервер, а до
 * localStorage он не дотянется.
 *
 * Заодно убираем ?app=1 из адреса. Метка нужна была только серверу,
 * а в строке браузера она останется навсегда — и уедет в закладки
 * и в пересланные ссылки.
 */
function rememberChoice(): void {
  document.cookie = "entered=1; path=/; max-age=31536000; samesite=lax";
  if (new URLSearchParams(location.search).has("app")) {
    const адрес = new URL(location.href);
    адрес.searchParams.delete("app");
    history.replaceState(null, "", адрес.pathname + адрес.search + адрес.hash);
  }
}

// До первой отрисовки: иначе компактная лента на мгновение
// показалась бы просторной и дёрнулась.
applyPreferences();
rememberChoice();

// Шрифт ставится пакетом, а не подключается с Google Fonts:
// сторонний CDN — это запрос с IP пользователя на чужой сервер,
// а нам с этим потом жить в правовом поле 152-ФЗ.

/**
 * Файл сборки исчез из-под открытой вкладки.
 *
 * Имена файлов содержат хеш содержимого, и при выкладке новой версии
 * старые пропадают. У того, у кого приложение было открыто в этот
 * момент, страница ссылается на файл, которого больше нет: скрипт
 * не загружается, экран остаётся пустым. Со стороны это выглядит как
 * «серый экран, а после перезагрузки всё нормально» — и перезагружать
 * приходится вручную, догадавшись.
 *
 * Перезагружаем сами. Один раз: если и после этого не грузится,
 * причина другая, и бесконечная карусель перезагрузок только скроет её.
 */
window.addEventListener("vite:preloadError", () => {
  if (sessionStorage.getItem("reloaded-for-update")) return;
  sessionStorage.setItem("reloaded-for-update", "1");
  location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Service worker только в собранной версии: рядом с горячей
// перезагрузкой Vite он перехватывает переходы и превращает отладку
// в угадайку, откуда приехал файл.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}

/**
 * Последняя проверка: одет ли мессенджер.
 *
 * Страница без оформления — это не «некрасиво», это сломано: списки
 * вместо переписки, огромные картинки, системный шрифт. И главное —
 * человек ничего не может с этим сделать. Однажды так и вышло: сервер
 * ответил на файл стилей страницей вместо стилей, запас service
 * worker'а честно её сохранил и дальше отдавал из своего, минуя сеть.
 * Сервер починили за минуты, а мессенджер у людей так и открывался
 * голым — до сети дело просто не доходило.
 *
 * Поэтому смотрим сами: если ни одного правила оформления не
 * применилось, стираем запас, снимаем worker'а и перезагружаемся —
 * один раз за сеанс. Один раз, а не «пока не получится»: без сети
 * стили не приедут и с десятого захода, и вечная перезагрузка была
 * бы хуже некрасивой страницы.
 */
if (import.meta.env.PROD) {
  window.addEventListener("load", () => {
    // Не сразу: стили могут ещё ехать, особенно на телефоне.
    setTimeout(() => {
      /*
       * Считать таблицы стилей бесполезно: одна-две на странице есть
       * почти всегда — их подкладывают библиотеки прямо на ходу, и
       * «таблица есть» не означает «оформление приехало». Спрашиваем
       * то, что видно глазом: цвет фона. Наш — тёмный и задан явно;
       * когда стилей нет, браузер отвечает «прозрачный».
       */
      const фон = getComputedStyle(document.body).backgroundColor;
      const одет = фон !== "" && фон !== "transparent" && фон !== "rgba(0, 0, 0, 0)";

      if (одет || sessionStorage.getItem("одевались")) return;

      sessionStorage.setItem("одевались", "1");
      void (async () => {
        try {
          const имена = await caches.keys();
          await Promise.all(
            имена.filter((имя) => имя.startsWith("assets") || имя.startsWith("shell")).map((имя) => caches.delete(имя)),
          );
          const worker = await navigator.serviceWorker?.getRegistration();
          await worker?.unregister();
        } catch {
          // Не вышло стереть — перезагрузиться всё равно стоит.
        }
        location.reload();
      })();
    }, 2500);
  });
}
