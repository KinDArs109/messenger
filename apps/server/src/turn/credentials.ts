import { createHmac, randomBytes } from "node:crypto";

/**
 * Учётные данные для ретранслятора — временные, а не постоянные.
 *
 * Пароль от TURN уезжает в браузер каждому, кто зашёл в разговор:
 * это не секрет, который можно спрятать. Постоянный пароль в такой
 * схеме — это открытый ретранслятор через месяц: достаточно один раз
 * заглянуть в отладчик браузера, и чужой трафик пойдёт через наш
 * канал, за который платим мы.
 *
 * Поэтому пароль считается из общего секрета и срока годности:
 *
 *     логин  = <до какого времени годен>:<кто>
 *     пароль = подпись логина общим секретом
 *
 * Сервер ничего не хранит — он пересчитывает подпись и сравнивает.
 * Утёкший пароль перестаёт работать сам, без нашего участия.
 * Схема стандартная, её понимают и coturn, и браузеры.
 */

/** Сколько живут выданные данные. Разговор длиннее суток — редкость,
 *  а короче делать неудобно: посреди звонка данные протухнут, и
 *  переподключение к ретранслятору не состоится. */
const TTL_SECONDS = 24 * 60 * 60;

export interface TurnCredentials {
  username: string;
  credential: string;
}

export function issueCredentials(secret: string, userId: string): TurnCredentials {
  const expires = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const username = `${expires}:${userId}`;
  return { username, credential: sign(secret, username) };
}

/** Пароль, который обязан прийти от клиента с таким логином. */
export function passwordFor(secret: string, username: string): string {
  return sign(secret, username);
}

/** Не протух ли логин. Логин без срока считаем негодным: это либо
 *  подделка, либо очень старая версия клиента. */
export function isFresh(username: string): boolean {
  const expires = Number(username.split(":")[0]);
  if (!Number.isFinite(expires)) return false;
  return expires * 1000 > Date.now();
}

function sign(secret: string, username: string): string {
  return createHmac("sha1", secret).update(username).digest("base64");
}

/** Секрет для ретранслятора, если его не задали руками. Нужен, чтобы
 *  запустить у себя и проверить, ничего не настраивая. */
export const randomSecret = (): string => randomBytes(24).toString("hex");
