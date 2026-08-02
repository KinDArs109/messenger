import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = "messenger";

/** Схема токенов
 *
 *  Access  — JWT, живёт 15 минут, хранится только в памяти клиента.
 *            Никогда не попадает в localStorage: оттуда его достанет
 *            любой XSS.
 *  Refresh — случайная строка, живёт 30 дней, лежит в httpOnly-cookie,
 *            то есть недоступна JavaScript. В базе хранится только
 *            её SHA-256: утечка дампа не даст войти под чужим именем.
 *
 *  При каждом обновлении старый refresh отзывается и выдаётся новый
 *  (ротация). Украденный токен работает максимум до ближайшего
 *  обновления, а не месяц. */

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(env.ACCESS_TOKEN_TTL)
    .sign(secret);
}

export async function verifyAccessToken(
  token: string,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export function createRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(48).toString("base64url");
  return { token, tokenHash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function refreshTokenExpiry(): Date {
  const ms = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms);
}

/** Клиенту нужно знать, когда обновлять access-токен. */
export function accessTokenSeconds(): number {
  const match = /^(\d+)([smhd])$/.exec(env.ACCESS_TOKEN_TTL);
  if (!match) return 900;
  const value = Number(match[1]);
  const unit = match[2] as "s" | "m" | "h" | "d";
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit];
  return value * multiplier;
}
