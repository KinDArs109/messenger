/* Service worker.
 *
 *  Нужен ровно для двух вещей: чтобы браузер считал приложение
 *  устанавливаемым и чтобы при обрыве связи открывался не «страница
 *  недоступна», а оболочка приложения с внятным сообщением.
 *
 *  Сознательно НЕ кэшируем скрипты и стили. Соблазн велик, но
 *  агрессивный кэш service worker'а — классический способ намертво
 *  залипнуть на старой версии приложения после выкладки, причём
 *  у части пользователей и без очевидной причины. Пока сервис живёт
 *  на ноуте и обновляется по десять раз в день, цена такой ошибки
 *  выше выигрыша.
 */

const VERSION = "v1";
const SHELL = `shell-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(["/", "/icon-192.png"])),
  );
  // Новый worker начинает работать сразу, не дожидаясь закрытия вкладок.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Данные, файлы и сокет — всегда мимо кэша.
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/socket.io") ||
    url.pathname.startsWith("/uploads")
  ) {
    return;
  }

  // Переходы: сначала сеть, при обрыве — сохранённая оболочка.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(SHELL).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/").then((cached) => cached ?? Response.error())),
    );
  }
});
