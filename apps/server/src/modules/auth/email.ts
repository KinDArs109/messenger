import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "../../db/client.js";
import { badRequest, tooManyRequests } from "../../lib/errors.js";
import { isMailEnabled, sendVerificationCode } from "../../lib/mailer.js";

/** Код живёт 15 минут: достаточно, чтобы дойти до почты и вернуться,
 *  и мало, чтобы забытое открытым письмо оставалось ключом. */
const CODE_TTL_MS = 15 * 60 * 1000;

/** Пауза между отправками. Без неё кнопка «отправить ещё раз»
 *  превращается в способ засыпать чужой ящик с нашего адреса —
 *  и быстро приводит к тому, что нас начинают считать спамом. */
const RESEND_COOLDOWN_MS = 60 * 1000;

/** Попыток на один код. Шесть цифр перебираются за миллион запросов;
 *  после пяти промахов код сгорает и нужен новый. */
const MAX_ATTEMPTS = 5;

const hashCode = (code: string): string => createHash("sha256").update(code).digest("hex");

/** Шестизначный код. randomInt, а не Math.random: последний
 *  предсказуем по нескольким значениям, и коды можно вычислить. */
const newCode = (): string => randomInt(0, 1_000_000).toString().padStart(6, "0");

/** Отправка или переотправка кода.
 *
 *  Ошибку почты наверх не пробрасываем: недоступный SMTP не должен
 *  ронять регистрацию. Учётная запись уже создана, и правильная
 *  реакция — дать кнопку «отправить ещё раз», а не откатывать всё. */
export async function issueEmailCode(userId: string, force = false): Promise<boolean> {
  if (!isMailEnabled()) return false;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.emailVerifiedAt) return false;

  if (!force && user.emailCodeSentAt) {
    const since = Date.now() - user.emailCodeSentAt.getTime();
    if (since < RESEND_COOLDOWN_MS) {
      throw tooManyRequests(
        `Код уже отправлен. Повторить можно через ${Math.ceil((RESEND_COOLDOWN_MS - since) / 1000)} с`,
      );
    }
  }

  const code = newCode();
  await prisma.user.update({
    where: { id: userId },
    data: {
      emailCodeHash: hashCode(code),
      emailCodeExpires: new Date(Date.now() + CODE_TTL_MS),
      emailCodeSentAt: new Date(),
      emailCodeAttempts: 0,
    },
  });

  /*
   * Письмо уходит, но ответа мы не ждём — по той же причине, что
   * и код на вход. Ждали — и запрос застревал ровно настолько,
   * насколько задумывался почтовый сервер: на живом адресе доли
   * секунды, на недоступном — десятки. Код уже выдан и лежит в базе,
   * письмо его догонит; осечка видна в журнале и по кнопке
   * «отправить ещё раз».
   */
  void sendVerificationCode(user.email, code).catch((error: unknown) =>
    console.error("Не удалось отправить код подтверждения:", error),
  );

  return true;
}

export async function verifyEmailCode(userId: string, code: string): Promise<Date> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw badRequest("NO_USER", "Пользователь не найден");
  if (user.emailVerifiedAt) return user.emailVerifiedAt;

  if (!user.emailCodeHash || !user.emailCodeExpires) {
    throw badRequest("NO_CODE", "Код не запрашивался", { code: "Запросите код" });
  }
  if (user.emailCodeExpires < new Date()) {
    throw badRequest("CODE_EXPIRED", "Код устарел, запросите новый", { code: "Устарел" });
  }
  if (user.emailCodeAttempts >= MAX_ATTEMPTS) {
    throw badRequest("TOO_MANY_ATTEMPTS", "Слишком много попыток, запросите новый код", {
      code: "Код сгорел",
    });
  }

  const given = Buffer.from(hashCode(code.trim()));
  const expected = Buffer.from(user.emailCodeHash);
  // timingSafeEqual: по времени обычного сравнения хеш подбирается
  // побайтно. Длины совпадают всегда — это hex от sha256.
  const ok = given.length === expected.length && timingSafeEqual(given, expected);

  if (!ok) {
    await prisma.user.update({
      where: { id: userId },
      data: { emailCodeAttempts: { increment: 1 } },
    });
    throw badRequest("BAD_CODE", "Код не подошёл", { code: "Неверный код" });
  }

  const verifiedAt = new Date();
  await prisma.user.update({
    where: { id: userId },
    data: {
      emailVerifiedAt: verifiedAt,
      // Использованный код стираем: повторно он работать не должен.
      emailCodeHash: null,
      emailCodeExpires: null,
      emailCodeAttempts: 0,
    },
  });

  return verifiedAt;
}
