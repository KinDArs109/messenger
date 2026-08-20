import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { User } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { badRequest, tooManyRequests, unauthorized } from "../../lib/errors.js";
import { isMailEnabled, sendLoginCode } from "../../lib/mailer.js";

/**
 * Второй шаг входа: код письмом.
 *
 * Пароль отвечает на вопрос «знаете ли вы секрет», и только на него.
 * Утёкший пароль — а утекают они не из мессенджера, а из совпадений
 * с другими сайтами — до сих пор означал полный доступ к переписке.
 * Теперь мало знать пароль: надо ещё дотянуться до почтового ящика.
 *
 * Письмо при этом полезно и само по себе. Код, пришедший тому, кто
 * никуда не входил, — это сообщение «ваш пароль знает кто-то ещё»,
 * и приходит оно раньше, чем этот кто-то успевает прочитать переписку.
 */

/** Код живёт пятнадцать минут — как и все остальные наши коды.
 *  Дольше значит оставить открытым окно на случай, если письмо
 *  прочтут не сразу и не те. */
const CODE_TTL_MS = 15 * 60 * 1000;

/** Пауза между письмами. Без неё кнопка «отправить ещё раз» —
 *  способ завалить чужой ящик с нашего адреса. */
const RESEND_COOLDOWN_MS = 60 * 1000;

/** Попыток на код. Шесть цифр — это миллион вариантов; пять попыток
 *  делают перебор бессмысленным, а человеку хватает с запасом. */
const MAX_ATTEMPTS = 5;

const hashCode = (code: string): string => createHash("sha256").update(code).digest("hex");

/** randomInt, а не Math.random: последний предсказуем по нескольким
 *  значениям, и коды можно вычислить наперёд. */
const newCode = (): string => randomInt(0, 1_000_000).toString().padStart(6, "0");

const свежий = (user: User): boolean =>
  Boolean(user.loginCodeHash && user.loginCodeExpires && user.loginCodeExpires > new Date());

/**
 * Выдать код на вход и отправить письмо.
 *
 * Каждое новое письмо несёт новый код, и прежний в тот же миг
 * перестаёт годиться: в базе лежит только хеш, самого кода мы не
 * знаем и повторить его не можем — а хранить его как есть значит
 * отдать все входы вместе с дампом базы.
 *
 * Поэтому действующий код без спроса не заменяем. Человек нажал
 * «войти», получил письмо, отвлёкся, вернулся, нажал ещё раз —
 * и код из открытого у него письма продолжает подходить. Второе
 * письмо приходит только по кнопке «отправить ещё раз», и там
 * человек уже знает, что старое годиться перестало.
 *
 * Возвращает true, если письмо ушло. false — либо почта на сервере
 * молчит, либо слать было нечего: годный код уже у человека.
 */
export async function issueLoginCode(user: User, force = false): Promise<boolean> {
  if (!isMailEnabled()) return false;

  // Код на руках и ещё жив — этого достаточно.
  if (!force && свежий(user)) return false;

  if (force && user.loginCodeSentAt) {
    const прошло = Date.now() - user.loginCodeSentAt.getTime();
    if (прошло < RESEND_COOLDOWN_MS) {
      throw tooManyRequests(
        `Письмо уже отправлено. Повторить можно через ${Math.ceil((RESEND_COOLDOWN_MS - прошло) / 1000)} с`,
      );
    }
  }

  const code = newCode();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      loginCodeHash: hashCode(code),
      loginCodeExpires: new Date(Date.now() + CODE_TTL_MS),
      loginCodeSentAt: new Date(),
      loginCodeAttempts: 0,
    },
  });

  /*
   * Письмо уходит, но ответа мы не ждём.
   *
   * Ждали — и вход застревал ровно настолько, насколько задумывался
   * почтовый сервер: на живом адресе это доли секунды, на выдуманном
   * или недоступном — десятки. Человек в это время смотрит на
   * крутящуюся кнопку, хотя показывать ему надо поле для кода:
   * код уже выдан и лежит в базе, письмо его догонит.
   *
   * Осечку отправки видно двумя способами: в журнале сервера и по
   * кнопке «отправить ещё раз», которая на том же экране.
   */
  void sendLoginCode(user.email, code).catch((error: unknown) =>
    console.error("Не удалось отправить код на вход:", error),
  );

  return true;
}

/**
 * Проверить код и пустить.
 *
 * Ошибки нарочно разные: «код не подошёл», «код устарел», «код
 * сгорел». Человеку, у которого письмо пролежало полчаса, надо знать,
 * что дело не в его внимательности, а во времени, — иначе он будет
 * вводить те же шесть цифр по кругу.
 */
export async function verifyLoginCode(userId: string, code: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorized("Войдите заново");

  if (!user.loginCodeHash || !user.loginCodeExpires) {
    throw badRequest("NO_CODE", "Код не запрашивался", { code: "Запросите код" });
  }
  if (user.loginCodeExpires < new Date()) {
    throw badRequest("CODE_EXPIRED", "Код устарел — запросите новый", { code: "Устарел" });
  }
  if (user.loginCodeAttempts >= MAX_ATTEMPTS) {
    throw badRequest("TOO_MANY_ATTEMPTS", "Слишком много попыток — запросите новый код", {
      code: "Код сгорел",
    });
  }

  const дано = Buffer.from(hashCode(code.trim()));
  const ждали = Buffer.from(user.loginCodeHash);
  // timingSafeEqual: по времени обычного сравнения хеш подбирается
  // побайтно. Длины совпадают всегда — это hex от sha256.
  const сошлось = дано.length === ждали.length && timingSafeEqual(дано, ждали);

  if (!сошлось) {
    await prisma.user.update({
      where: { id: user.id },
      data: { loginCodeAttempts: { increment: 1 } },
    });
    throw badRequest("BAD_CODE", "Код не подошёл", { code: "Неверный код" });
  }

  return prisma.user.update({
    where: { id: user.id },
    data: {
      // Использованный код стираем: второй раз он работать не должен.
      loginCodeHash: null,
      loginCodeExpires: null,
      loginCodeAttempts: 0,
      // Заодно почта считается подтверждённой. Человек только что
      // достал из неё письмо — более прямого доказательства, что
      // адрес его и работает, не бывает.
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
    },
  });
}

/**
 * Адрес, наполовину закрытый.
 *
 * Показать его целиком нельзя: до этого шага доходит и тот, кто
 * просто знает чужой пароль, — и незачем дарить ему ещё и почту.
 * Но и молчать нельзя: человек с тремя ящиками должен понимать,
 * в какой идти.
 */
export function прикрытыйАдрес(email: string): string {
  const [имя = "", домен = ""] = email.split("@");
  const видно = имя.slice(0, 2);
  return `${видно}${"•".repeat(Math.max(имя.length - 2, 1))}@${домен}`;
}
