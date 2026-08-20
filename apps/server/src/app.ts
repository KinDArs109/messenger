import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env, isProduction } from "./config/env.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./modules/auth/router.js";
import { usersRouter } from "./modules/users/router.js";
import { friendsRouter } from "./modules/friends/router.js";
import { voiceRouter } from "./modules/voice/router.js";
import { bansRouter, moderationRouter } from "./modules/servers/moderation.js";
import { identifyUser, requireAuth } from "./middleware/auth.js";
import { requireVerifiedEmail } from "./middleware/verified.js";
import { serversRouter } from "./modules/servers/router.js";
import { channelsRouter, messagesRouter } from "./modules/messages/router.js";
import { invitesRouter, serverInvitesRouter } from "./modules/invites/router.js";
import { dmsRouter } from "./modules/dms/router.js";
import { readsRouter } from "./modules/reads/router.js";
import { uploadsRouter } from "./modules/uploads/router.js";
import { pushRouter } from "./modules/push/router.js";
import { uploadsServeRouter } from "./modules/uploads/serve.js";
import { downloadRouter, landingHtml, updatesRouter } from "./modules/download/router.js";

/** Собранный клиент. В разработке его нет — там работает Vite,
 *  который сам проксирует /api и /uploads на этот сервер. */
const CLIENT_DIST = path.join(import.meta.dirname, "../../web/dist");

export function createApp() {
  const app = express();

  // За Cloudflare Tunnel настоящий IP приходит в X-Forwarded-For.
  // Без этого ограничения по частоте считали бы всех за одного.
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Vite собирает скрипты отдельными файлами, встроенных нет.
          //
          // blob: нужен для обработчика звука, который гасит наш
          // собственный голос в демонстрации экрана. Он собран вместе
          // с приложением и подключается через Blob, а не отдельным
          // файлом, намеренно: отдельный файл живёт своей жизнью в
          // кэше и рано или поздно разъезжается с версией приложения,
          // а мы это уже проходили — именно так и получается серый
          // экран. Послабление умеренное: встроенные скрипты
          // по-прежнему запрещены, а создать blob может только тот,
          // кто уже выполняет свой код на странице.
          scriptSrc: ["'self'", "blob:"],
          // А вот встроенные стили есть: цвет аватара и высота поля
          // ввода задаются атрибутом style прямо в разметке.
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          fontSrc: ["'self'"],
          connectSrc: ["'self'", "ws:", "wss:"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      // Вложения отдаются с других путей и своими заголовками;
      // общий запрет на межоригинальные ресурсы ломал бы картинки.
      crossOriginResourcePolicy: { policy: "same-origin" },
    }),
  );

  // В продакшене клиент и API живут на одном адресе, и CORS не нужен
  // вовсе. В разработке клиент на 5173 — там нужен, причём с
  // credentials, иначе браузер не пошлёт httpOnly-cookie.
  if (!isProduction) {
    app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  }

  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  // Сначала опознаём, потом считаем: иначе общий потолок считается
  // по адресу, и двое друзей из одной квартиры делят его пополам.
  //
  // Третьим — застава: без подтверждённой почты дальше /api/auth
  // не пройти. Один общий рубеж на весь API, а не проверка в каждом
  // разделе: разделов два десятка, и однажды забыть в одном из них —
  // вопрос времени.
  app.use("/api", identifyUser, apiLimiter, requireVerifiedEmail);
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/friends", friendsRouter);
  app.use("/api/voice", voiceRouter);
  app.use("/api/servers", serversRouter);
  app.use("/api/servers/:serverId/invites", serverInvitesRouter);
  app.use("/api/servers/:serverId/members", requireAuth, moderationRouter);
  app.use("/api/servers/:serverId/bans", requireAuth, bansRouter);
  app.use("/api/invites", invitesRouter);
  app.use("/api/dms", dmsRouter);
  app.use("/api/channels", channelsRouter);
  app.use("/api/messages", messagesRouter);
  app.use("/api/reads", readsRouter);
  app.use("/api/uploads", uploadsRouter);
  app.use("/api/push", pushRouter);

  // Вне /api: сюда ходит браузер напрямую из <img src>, без токена.
  app.use("/uploads", uploadsServeRouter);
  app.use("/download", downloadRouter);
  // Файлы автообновления: приложение ходит сюда само, без токена.
  app.use("/updates", updatesRouter);

  if (existsSync(CLIENT_DIST)) {
    // Файлы сборки содержат хеш в имени, поэтому кэшируются навсегда.
    app.use(
      express.static(CLIENT_DIST, {
        index: false,
        maxAge: "1y",
        immutable: true,
        setHeaders: (res, filePath) => {
          // Кроме тех, у кого хеша нет: манифест, иконки, worker.
          if (!/-[A-Za-z0-9_]{8,}\.\w+$/.test(filePath)) {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      }),
    );

    /**
     * Связь сайта с приложением для Android.
     *
     * Приложение под Android — это тот же сайт в своём окне. Убрать
     * из этого окна адресную строку Chrome соглашается только тогда,
     * когда сайт подтвердит, что приложение с такой подписью — своё.
     * Подтверждение и лежит здесь: отпечаток ключа, которым подписан
     * наш apk. Без него приложение откроется, но с полосой адреса
     * наверху и будет выглядеть вкладкой браузера.
     *
     * Отдельным путём, а не файлом среди прочих: express.static
     * намеренно прячет всё, что начинается с точки, а путь тут именно
     * такой — так его определил Google.
     */
    app.get("/.well-known/assetlinks.json", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      // dotfiles: express и здесь по умолчанию прячет пути с точкой,
      // а этот путь такой целиком — без разрешения он отвечает 404
      // на файл, который лежит на месте.
      const options = { dotfiles: "allow" as const };
      res.sendFile(path.join(CLIENT_DIST, ".well-known", "assetlinks.json"), options, (error) => {
        if (error && !res.headersSent) res.status(404).json({ error: "Файл не выложен" });
      });
    });

    /**
     * Корень: незнакомому — страница выбора, своим — сразу мессенджер.
     *
     * Человеку, который открыл адрес впервые, показывать форму входа
     * бессмысленно: он ещё не знает, что это и нужно ли ему ставить
     * приложение. Но заставлять кликать «войти» каждый раз всех
     * остальных — хуже вдвойне, поэтому спрашиваем ровно один раз.
     *
     * Три признака «не спрашивать», и любой из них достаточен:
     *   ?app=1  — человек только что нажал «Открыть в браузере»,
     *             и с этой же метки открывается установленный
     *             веб-клиент (start_url в манифесте);
     *   cookie  — он уже заходил и выбор сделал;
     *   Electron — это наше приложение для Windows, оно грузит корень
     *             и страницу выбора внутри себя показывать не должно.
     *
     * Ошибка в любую сторону не фатальна: своему покажется лишняя
     * страница с кнопкой «Открыть», новичок увидит форму входа.
     */
    app.get("/", (req, res, next) => {
      // Ответ на один и тот же адрес теперь разный, и промежуточные
      // кэши обязаны об этом знать. Без Vary туннель мог бы отдать
      // страницу выбора тому, кто её уже прошёл, — или наоборот.
      res.setHeader("Vary", "Cookie, User-Agent");

      const chosen = req.query.app !== undefined || req.cookies?.entered === "1";
      const shell = /Electron\//.test(req.get("user-agent") ?? "");
      if (chosen || shell) {
        next();
        return;
      }

      // Заголовок для service worker: он кэширует ответ на «/» как
      // оболочку приложения и без метки сохранил бы вместо неё эту
      // страницу — а потом показывал бы её вместо переписки, стоит
      // пропасть сети.
      res.setHeader("X-Landing", "1");
      res.setHeader("Cache-Control", "no-store");
      // Устройство передаём, чтобы страница предлагала своё: телефону
      // приложение для телефона, компьютеру — для компьютера. Vary
      // по User-Agent выше уже стоит.
      res.type("html").send(landingHtml(req.get("user-agent") ?? ""));
    });

    // Одностраничное приложение: адреса вроде /invite/abc123 живут
    // только в браузере, сервер про них не знает. Любой переход,
    // кроме API и файлов, отдаёт оболочку — иначе обновление страницы
    // на приглашении давало бы 404.
    // /download тоже исключаем: без этого «всё остальное» перехватывало
    // бы ссылку на установщик и отдавало вместо файла оболочку клиента.
    app.get(/^(?!\/(api|uploads|socket\.io|download|updates|assets)(\/|$)).*/, (req, res) => {
      /*
       * Запрошенный файл, которого нет, — это 404, а не оболочка.
       *
       * Раньше сюда попадало всё подряд, и на несуществующий
       * /assets/index-старый.css сервер отвечал двумястами и страницей
       * мессенджера. Браузер получал вместо стилей разметку, молча
       * её отбрасывал — и мессенджер открывался голым: списками,
       * огромными картинками, системным шрифтом. Ровно так и вышло
       * при выкладке, когда страница уехала на сервер раньше, чем
       * файл оформления рядом с ней.
       *
       * Признак файла — точка в последней части пути. Адреса
       * мессенджера точек не содержат: /invite/abc123, /app, /friends.
       */
      const последняя = req.path.split("/").pop() ?? "";
      if (последняя.includes(".")) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Файл не найден" } });
        return;
      }

      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(CLIENT_DIST, "index.html"));
    });
  } else if (isProduction) {
    console.warn(
      "\n  Клиент не собран — сервер отдаёт только API.\n" +
        "  Соберите: npm run build\n",
    );
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
