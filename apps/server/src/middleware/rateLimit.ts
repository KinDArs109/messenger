import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

/** Ограничения ставим сразу, а не «на этапе безопасности».
 *  Дописать их в готовое приложение — значит перебрать все роуты
 *  заново; заложить сейчас — пять минут. */

const message = {
  error: {
    code: "RATE_LIMITED",
    message: "Слишком много запросов. Подождите немного.",
  },
};

/** Опознанного пользователя считаем по его идентификатору, остальных —
 *  по адресу. Голый req.ip брать нельзя: провайдер выдаёт клиенту целую
 *  подсеть IPv6, и, меняя адрес внутри неё, тот обходил бы лимит.
 *  ipKeyGenerator сворачивает адрес до подсети. */
const byUserOrIp = (req: Request): string =>
  req.userId ?? ipKeyGenerator(req.ip ?? "unknown");

/** Вход и регистрация: защита от перебора паролей. Ключ — IP,
 *  потому что пользователь ещё не опознан. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message,
  skipSuccessfulRequests: true,
});

/** Отправка сообщений: против флуда и случайных циклов в клиенте. */
export const messageLimiter = rateLimit({
  windowMs: 5000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message,
  keyGenerator: byUserOrIp,
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message,
  keyGenerator: byUserOrIp,
});

/** Общий потолок на всё остальное. */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message,
  keyGenerator: byUserOrIp,
});
