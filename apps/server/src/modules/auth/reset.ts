import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "../../db/client.js";
import { badRequest } from "../../lib/errors.js";
import { hashPassword } from "../../lib/password.js";
import { isMailEnabled, sendResetCode } from "../../lib/mailer.js";

/**
 * Восстановление пароля.
 *
 * Пароль нельзя «вспомнить» — в базе лежит только его хеш. Поэтому
 * восстановление всегда означает замену: человек доказывает, что почта
 * его, и задаёт новый.
 */

const CODE_TTL_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

const hashCode = (code: string): string => createHash("sha256").update(code).digest("hex");
const newCode = (): string => randomInt(0, 1_000_000).toString().padStart(6, "0");

const findByLogin = (login: string) =>
  login.includes("@")
    ? prisma.user.findUnique({ where: { email: login } })
    : prisma.user.findUnique({ where: { username: login } });

/**
 * Отправка кода.
 *
 * Возвращает void и никогда не сообщает, нашёлся ли пользователь.
 * Иначе форма «забыли пароль» превращается в способ проверять,
 * зарегистрирован ли конкретный адрес: ввёл — узнал.
 */
export async function requestPasswordReset(login: string): Promise<void> {
  if (!isMailEnabled()) return;

  const user = await findByLogin(login.trim().toLowerCase());
  if (!user) return;

  // Пауза между письмами. Без неё форма становится способом
  // засыпать чужой ящик с нашего адреса.
  if (user.resetCodeSentAt && Date.now() - user.resetCodeSentAt.getTime() < RESEND_COOLDOWN_MS) {
    return;
  }

  const code = newCode();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetCodeHash: hashCode(code),
      resetCodeExpires: new Date(Date.now() + CODE_TTL_MS),
      resetCodeSentAt: new Date(),
      resetCodeAttempts: 0,
    },
  });

  await sendResetCode(user.email, code);
}

export async function resetPassword(
  login: string,
  code: string,
  password: string,
): Promise<void> {
  const user = await findByLogin(login.trim().toLowerCase());

  // Ошибка одна на все случаи: нет такого пользователя, код не
  // запрашивали, код устарел, код неверный. Разные тексты подсказали
  // бы, на каком шаге подбор идёт правильно.
  const wrong = () => badRequest("BAD_RESET", "Код не подошёл или устарел", { code: "Неверный код" });

  if (!user?.resetCodeHash || !user.resetCodeExpires) throw wrong();
  if (user.resetCodeExpires < new Date()) throw wrong();
  if (user.resetCodeAttempts >= MAX_ATTEMPTS) throw wrong();

  const given = Buffer.from(hashCode(code.trim()));
  const expected = Buffer.from(user.resetCodeHash);
  const ok = given.length === expected.length && timingSafeEqual(given, expected);

  if (!ok) {
    await prisma.user.update({
      where: { id: user.id },
      data: { resetCodeAttempts: { increment: 1 } },
    });
    throw wrong();
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(password),
      resetCodeHash: null,
      resetCodeExpires: null,
      resetCodeAttempts: 0,
      // Смена пароля подтверждает и почту заодно: человек только что
      // доказал, что письма до него доходят.
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
    },
  });

  // Все сессии — под нож. Восстановление пароля чаще всего означает
  // «кто-то мог зайти», и оставлять чужие входы живыми нельзя.
  await prisma.refreshToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
