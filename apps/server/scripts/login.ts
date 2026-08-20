import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * Вход для проверок — со вторым шагом.
 *
 * Вход теперь в два действия: пароль, потом код из письма. Проверки
 * писем не читают и читать не должны, зато у них есть то, чего нет
 * ни у кого снаружи, — база. Поэтому вместо чтения письма они кладут
 * в базу известный им код и вводят его.
 *
 * Это не обход второго шага: сервер проверяет код ровно так же, как
 * у человека, и ровно так же откажет, если код не тот. Проверка лишь
 * играет роль почтового ящика.
 *
 * Держится отдельным файлом, потому что входить приходится половине
 * проверок, а повторять эту пляску в каждой — верный способ однажды
 * поправить её в семи местах из восьми.
 */

/** Код, который проверки кладут себе в почтовый ящик. */
export const КОД = "424242";

const hash = (code: string) => createHash("sha256").update(code).digest("hex");

interface Ответ {
  accessToken?: string;
  pending?: string;
  ticket?: string;
}

export async function войти(
  URL: string,
  prisma: PrismaClient,
  login: string,
  password: string,
): Promise<string> {
  const первый = await послать(`${URL}/api/auth/login`, { login, password });

  if (первый.accessToken) return первый.accessToken;
  if (первый.pending !== "email" || !первый.ticket) {
    throw new Error(`Не удалось войти как ${login}: сервер ответил ${JSON.stringify(первый)}`);
  }

  // Роль почтового ящика: подменяем код на известный. Срок и счётчик
  // попыток заодно обнуляем — предыдущая проверка могла оставить их
  // в любом состоянии.
  const где = login.includes("@") ? { email: login } : { username: login };
  await prisma.user.update({
    where: где,
    data: {
      loginCodeHash: hash(КОД),
      loginCodeExpires: new Date(Date.now() + 15 * 60 * 1000),
      loginCodeAttempts: 0,
    },
  });

  const второй = await послать(`${URL}/api/auth/login/confirm`, {
    ticket: первый.ticket,
    code: КОД,
  });
  if (!второй.accessToken) {
    throw new Error(`Код не приняли для ${login}: ${JSON.stringify(второй)}`);
  }
  return второй.accessToken;
}

async function послать(url: string, body: unknown): Promise<Ответ> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json().catch(() => ({}))) as Ответ;
}
