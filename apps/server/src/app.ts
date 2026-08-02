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
import { requireAuth } from "./middleware/auth.js";
import { serversRouter } from "./modules/servers/router.js";
import { channelsRouter, messagesRouter } from "./modules/messages/router.js";
import { invitesRouter, serverInvitesRouter } from "./modules/invites/router.js";
import { dmsRouter } from "./modules/dms/router.js";
import { readsRouter } from "./modules/reads/router.js";
import { uploadsRouter } from "./modules/uploads/router.js";
import { uploadsServeRouter } from "./modules/uploads/serve.js";
import { downloadRouter } from "./modules/download/router.js";

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
          scriptSrc: ["'self'"],
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

  app.use("/api", apiLimiter);
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

  // Вне /api: сюда ходит браузер напрямую из <img src>, без токена.
  app.use("/uploads", uploadsServeRouter);
  app.use("/download", downloadRouter);

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

    // Одностраничное приложение: адреса вроде /invite/abc123 живут
    // только в браузере, сервер про них не знает. Любой переход,
    // кроме API и файлов, отдаёт оболочку — иначе обновление страницы
    // на приглашении давало бы 404.
    // /download тоже исключаем: без этого «всё остальное» перехватывало
    // бы ссылку на установщик и отдавало вместо файла оболочку клиента.
    app.get(/^(?!\/(api|uploads|socket\.io|download)(\/|$)).*/, (_req, res) => {
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
