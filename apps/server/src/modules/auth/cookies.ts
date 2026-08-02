import type { Response } from "express";
import { env, isProduction } from "../../config/env.js";

export const REFRESH_COOKIE = "refresh_token";

/** httpOnly  — недоступна из JavaScript, значит XSS её не украдёт
 *  sameSite  — cookie не уходит на чужие сайты, это защита от CSRF
 *  secure    — только по HTTPS (в разработке выключено, там http)
 *  path      — уходит только на роуты аутентификации, а не на каждый
 *              запрос к API */
export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/api/auth",
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
}
