import type { RequestHandler } from "express";
import { prisma } from "../db/client.js";
import { AppError } from "../lib/errors.js";
import { isMailEnabled } from "../lib/mailer.js";

/**
 * Без подтверждённой почты внутрь не пускаем.
 *
 * Раньше это была полоска-напоминание, которую можно закрыть. Толку
 * от неё немного: адрес, который никто не проверял, — это адрес,
 * по которому не дойдёт ни восстановление пароля, ни письмо о входе
 * с чужого устройства. Учётная запись без рабочей почты — это учётная
 * запись, которую нельзя вернуть владельцу и нельзя ему же отдать
 * обратно, если она уплыла.
 *
 * Заперть друзей снаружи навсегда эта проверка не может, и это важно:
 *
 *   · пока почта на сервере не настроена, она молчит вовсе — иначе
 *     одна забытая строка в .env выключила бы мессенджер всем;
 *   · раздел /api/auth открыт всегда — там и запрос кода, и ввод кода,
 *     и смена адреса, если при регистрации промахнулись буквой,
 *     и выход;
 *   · подтверждение бессрочно: подтвердил один раз — больше эта
 *     проверка о себе не напоминает.
 */

/** Кого уже проверяли. Подтверждение назад не отыгрывается — значит,
 *  ответ «да» можно помнить и не ходить в базу на каждый запрос.
 *  Ответ «нет» не кэшируем: человек подтверждает почту именно сейчас,
 *  и следующий его запрос должен пройти. */
const проверенные = new Set<string>();

/** При смене адреса подтверждение сбрасывается — и память о нём тоже.
 *  Без этого сменивший почту остался бы «проверенным» до перезапуска. */
export function forgetVerified(userId: string): void {
  проверенные.delete(userId);
}

export async function hasVerifiedEmail(userId: string): Promise<boolean> {
  if (!isMailEnabled()) return true;
  if (проверенные.has(userId)) return true;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerifiedAt: true },
  });

  if (!user?.emailVerifiedAt) return false;

  проверенные.add(userId);
  return true;
}

export const emailNotVerified = (): AppError =>
  new AppError(
    403,
    "EMAIL_NOT_VERIFIED",
    "Подтвердите почту, чтобы пользоваться мессенджером",
  );

export const requireVerifiedEmail: RequestHandler = async (req, _res, next) => {
  // Раздел входа открыт всегда — там же и подтверждают.
  //
  // Смотрим originalUrl, а не path: этот обработчик висит на /api,
  // и Express внутри него срезает начало пути. Полный адрес читается
  // однозначно и не зависит от того, куда его подключили.
  if (req.originalUrl.split("?")[0]?.startsWith("/api/auth/")) {
    next();
    return;
  }

  // Неопознанного отсюда не гоним: про него ещё ничего не известно,
  // и отвечать «подтвердите почту» тому, кто просто не вошёл, —
  // сбивать с толку. Дальше по цепочке стоит requireAuth, его дело.
  const userId = req.userId;
  if (!userId) {
    next();
    return;
  }

  next((await hasVerifiedEmail(userId)) ? undefined : emailNotVerified());
};
