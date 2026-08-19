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
/** Опознать, но не требовать.
 *
 *  Нужен ровно для ограничителя запросов: тот считает по человеку,
 *  а если человека ещё не опознали — по адресу. Ограничитель стоит
 *  раньше requireAuth (он общий на весь /api, а requireAuth — свой
 *  у каждого раздела), и до этой правки в момент подсчёта никто
 *  опознан не был. Получалось, что общий потолок делится между всеми,
 *  кто вышел в интернет с одного адреса: двое друзей из одной квартиры
 *  съедали лимит вдвоём, а нагрузочная проверка упиралась в него
 *  вместо машины.
 *
 *  Ничего не отвергает: без токена или с плохим токеном просто идём
 *  дальше, а разбираться будет requireAuth. */
export const identifyUser: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const userId = await verifyAccessToken(header.slice(7));
    if (userId) req.userId = userId;
  }
  next();
};

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
