import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "./styles/tokens.css";
import { App } from "./App.tsx";
import { applyPreferences } from "./lib/preferences.ts";

// До первой отрисовки: иначе компактная лента на мгновение
// показалась бы просторной и дёрнулась.
applyPreferences();

// Шрифт ставится пакетом, а не подключается с Google Fonts:
// сторонний CDN — это запрос с IP пользователя на чужой сервер,
// а нам с этим потом жить в правовом поле 152-ФЗ.

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
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
