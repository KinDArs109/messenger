/* Service worker.
 *
 *  Делает три вещи: приложение считается устанавливаемым, при обрыве
 *  связи открывается оболочка с внятным сообщением вместо «страница
 *  недоступна», и запуск не ждёт, пока по сети приедет полмегабайта
 *  скриптов.
 *
 *  ── Почему кэшировать скрипты стало можно ──
 *
 *  Раньше здесь стоял прямой запрет: агрессивный кэш service worker'а —
 *  классический способ намертво залипнуть на старой версии после
 *  выкладки, причём у части людей и без очевидной причины.
 *
 *  Запрет снят не потому, что риск исчез, а потому, что он не
 *  относится к файлам сборки. Их имена содержат хеш содержимого:
 *  index-Btm0k9l8.js. Изменилось содержимое — изменилось имя, значит
 *  под одним именем всегда лежит одно и то же, и «устаревшего» ответа
 *  из кэша тут быть не может по построению.
 *
 *  А вот index.html имени с хешем не имеет: именно он решает, какую
 *  версию грузить. Поэтому он по-прежнему берётся из сети всегда,
 *  и кэш выступает только запасным аэродромом. Версия обновляется
 *  ровно так же быстро, как раньше.
 */

const VERSION = "v5";
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
/* Ответы сервера и присланные файлы — чтобы при выключенном сервере
 * открывалась последняя переписка, а не пустой экран.
 *
 * Версию в имени этих двух не ставим намеренно: содержимое к версии
 * приложения не привязано, и терять переписку из-за выкладки нового
 * интерфейса было бы странно. */
const DATA = "data";
const FILES = "files";

/** Сколько файлов сборки держим. Каждая выкладка добавляет пару новых,
 *  старые остаются мёртвым грузом — не вредят, но занимают место.
 *  Сотни хватает на десятки выкладок вперёд, а до бесконечности
 *  расти не даёт. */
const ASSET_LIMIT = 100;
/** Сколько ответов сервера и присланных файлов храним.
 *  Двести страниц переписки и триста картинок — это последние дни
 *  общения, а не архив за год: кэш не должен расти до гигабайтов. */
const DATA_LIMIT = 200;
const FILE_LIMIT = 300;

/** Файлы сборки: у них хеш в имени, содержимое неизменно. */
const isAsset = (url) => url.pathname.startsWith("/assets/");

/**
 * То ли это, что просили.
 *
 * Однажды сервер ответил на несуществующий файл стилей двумястами
 * и страницей мессенджера — так работал перехват адресов. Браузер
 * молча отбросил разметку вместо стилей, а этот запас честно её
 * сохранил: код-то удачный. Дальше он отдавал её из запаса, минуя
 * сеть, и починка сервера ничего не меняла: мессенджер открывался
 * голой разметкой, пока запас не сотрут руками.
 *
 * Поэтому смотрим не только на код, но и на то, чем ответили. Просили
 * стили — пусть будут стили; просили скрипт — пусть будет скрипт.
 * Проверка стоит на обеих сторонах: не кладём чужое в запас и не
 * достаём чужое из запаса, если оно там уже лежит с прошлого раза.
 */
const подходит = (url, response) => {
  const тип = response.headers.get("content-type") ?? "";
  if (url.pathname.endsWith(".css")) return тип.includes("text/css");
  if (url.pathname.endsWith(".js")) return тип.includes("javascript");
  return true;
};

/** Что можно сохранять из ответов сервера.
 *
 *  Всё про вход — мимо: там токены, список сеансов и коды. Отдать
 *  такое из кэша значит показать вошедшим того, кто не входил. Личность
 *  при работе без сети клиент берёт из своего хранилища и честно
 *  помечает, что связи нет. */
const isCacheableData = (url) =>
  url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/");

/** Присланные файлы. Имя — ULID, содержимое под ним не меняется
 *  никогда, поэтому их можно смело брать из кэша сразу. */
const isFile = (url) => url.pathname.startsWith("/uploads/");

/** Метка страницы выбора «поставить приложение или открыть в браузере».
 *  На корне сервер отдаёт её тем, кто пришёл впервые, — и её ни в коем
 *  случае нельзя сохранить под именем оболочки: без сети мы показывали
 *  бы предложение установить приложение вместо самой переписки. */
const isLanding = (response) => response.headers.get("X-Landing") === "1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then(async (cache) => {
      await cache.add("/icon-192.png");
      // Оболочку запрашиваем с меткой «я уже выбрал»: без неё сервер
      // законно отдал бы страницу выбора, и в запас легла бы она.
      const shell = await fetch("/?app=1");
      if (shell.ok && !isLanding(shell)) await cache.put("/", shell);
    }),
  );
  // Новый worker начинает работать сразу, не дожидаясь закрытия вкладок.
  self.skipWaiting();
});

const KEEP = new Set([SHELL, ASSETS, DATA, FILES]);

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Выход из аккаунта стирает всё сохранённое.
 *
 *  Иначе «выйти» означало бы «выйти, но переписка останется лежать
 *  на диске и откроется у любого, кто откроет приложение без сети». */
self.addEventListener("message", (event) => {
  if (event.data !== "forget") return;
  event.waitUntil(Promise.all([caches.delete(DATA), caches.delete(FILES)]));
});

/* ── Уведомления на закрытый телефон ─────────────────────────────
 *
 * Сюда приходит письмо от сервера, когда мессенджер закрыт: живого
 * соединения нет, страницы нет, работает только этот файл — телефон
 * будит его ради одного события и снова засыпает.
 *
 * Содержимое письма зашифровано ключами этого браузера, поэтому
 * служба доставки, которая его несла, текста не видела.
 */
self.addEventListener("push", (event) => {
  const data = (() => {
    try {
      return event.data ? event.data.json() : null;
    } catch {
      return null;
    }
  })();
  if (!data) return;

  event.waitUntil(
    (async () => {
      // Мессенджер может быть открыт прямо сейчас — например, на
      // ноутбуке. Тогда уведомление не нужно: человек и так смотрит
      // в переписку, а системная плашка поверх неё только мешает.
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const looking = open.some((client) => client.visibilityState === "visible");
      if (looking) return;

      await self.registration.showNotification(data.title ?? "Мессенджер", {
        body: data.body ?? "",
        icon: data.icon ?? "/icon-192.png",
        badge: "/icon-192.png",
        // Один канал — одно уведомление: пять сообщений подряд
        // заменяют друг друга, а не строятся столбиком.
        tag: data.tag ?? data.channelId ?? "messenger",
        renotify: true,
        data: { channelId: data.channelId ?? null },
      });
    })(),
  );
});

/** Нажали по уведомлению: открыть переписку, а не просто приложение.
 *
 *  Сначала ищем уже открытое окно — второе окно того же мессенджера
 *  никому не нужно, а открытому достаточно сказать, куда перейти. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const channelId = event.notification.data?.channelId ?? null;

  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of open) {
        if (!client.url.startsWith(self.location.origin)) continue;
        client.postMessage({ type: "open-channel", channelId });
        return client.focus();
      }
      // Открытого нет — запускаем приложение. Канал передаём меткой
      // в адресе: перехватить сообщение странице, которой ещё нет,
      // нечем.
      const url = channelId ? `/?app=1#channel=${channelId}` : "/?app=1";
      return self.clients.openWindow(url);
    })(),
  );
});

/** Подрезаем кэш, удаляя самые давние записи. Порядок в cache.keys() —
 *  порядок добавления, поэтому первыми уходят самые старые. */
async function trim(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  for (const key of keys.slice(0, keys.length - limit)) {
    await cache.delete(key);
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Всё, что меняет состояние, и живое соединение — мимо кэша.
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/socket.io")
  ) {
    return;
  }

  // Ответы сервера: сначала сеть, при обрыве — сохранённое.
  // Порядок именно такой: свежая переписка всегда важнее старой,
  // и кэш здесь только на случай, когда сервера нет.
  if (isCacheableData(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(DATA).then(async (cache) => {
              await cache.put(request, copy);
              await trim(cache, DATA_LIMIT);
            });
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (!cached) return Response.error();
          // Помечаем ответ: клиенту важно понимать, что он смотрит
          // сохранённое, а не сегодняшнее.
          const headers = new Headers(cached.headers);
          headers.set("X-From-Cache", "1");
          return new Response(cached.body, {
            status: cached.status,
            statusText: cached.statusText,
            headers,
          });
        }),
    );
    return;
  }

  // Присланные файлы: сразу из кэша. Имя — ULID, содержимое под ним
  // не меняется, поэтому устаревшего ответа тут быть не может.
  if (isFile(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(FILES).then(async (cache) => {
              await cache.put(request, copy);
              await trim(cache, FILE_LIMIT);
            });
          }
          return response;
        });
      }),
    );
    return;
  }

  // Переходы: сначала сеть, при обрыве — сохранённая оболочка.
  // Именно здесь решается, какая версия приложения запустится,
  // поэтому кэш тут только запасной путь.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Страницу выбора в запас не кладём: она не оболочка, и без
          // сети человеку нужна переписка, а не предложение поставить
          // приложение. Сохранённая ранее оболочка при этом остаётся
          // нетронутой — именно её он и увидит.
          if (!isLanding(response)) {
            const copy = response.clone();
            void caches.open(SHELL).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(() => caches.match("/").then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // Файлы сборки: сначала кэш. Отдать старое содержимое под этим
  // именем невозможно — имя и есть хеш содержимого.
  if (isAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        // Испорченное из запаса не отдаём и не чиним вручную: просто
        // идём в сеть, как будто его там и не было.
        if (cached && подходит(url, cached)) return cached;
        return fetch(request).then((response) => {
          // Кладём только удачные ответы, и только те, в которых
          // лежит то, что просили: положить в запас 502 от упавшего
          // сервера или страницу вместо стилей значит закрепить
          // поломку навсегда.
          if (response.ok && подходит(url, response)) {
            const copy = response.clone();
            void caches.open(ASSETS).then(async (cache) => {
              await cache.put(request, copy);
              await trim(cache, ASSET_LIMIT);
            });
          }
          return response;
        });
      }),
    );
  }
});
