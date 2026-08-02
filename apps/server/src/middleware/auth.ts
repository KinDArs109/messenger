import type { RequestHandler } from "express";
import { verifyAccessToken } from "../lib/tokens.js";
import { unauthorized } from "../lib/errors.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/** Кладёт в запрос только идентификатор, не всего пользователя.
 *  Обращение к базе на каждый запрос ради полей, которые нужны
 *  далеко не всегда, — лишняя работа. Кому нужен полный объект,
 *  тот его и запросит. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next(unauthorized());
    return;
  }

  const userId = await verifyAccessToken(header.slice(7));
  if (!userId) {
    next(unauthorized("Токен недействителен или истёк"));
    return;
  }

  req.userId = userId;
  next();
};

/** Для обработчиков после requireAuth: идентификатор там гарантированно
 *  есть, но TypeScript об этом не знает. Одна проверка вместо
 *  восклицательных знаков по всему коду. */
export function currentUserId(req: { userId?: string }): string {
  if (!req.userId) throw unauthorized();
  return req.userId;
}
