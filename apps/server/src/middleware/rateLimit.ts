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

/**
 * Своя же машина в разработке — мимо счётчика.
 *
 * Проверки входа, регистрации и почты нарочно стучатся неверными
 * паролями: в этом их смысл. Втроём они выбирают десяток попыток
 * за прогон, и последняя проверка получает от ограничителя отказ —
 * то есть провал, за которым нет ошибки в мессенджере. Ждать
 * четверть часа между проверками — верный способ перестать
 * их прогонять.
 *
 * В бою правило не меняется ничем: там NODE_ENV — production,
 * и эта поблажка выключена целиком. Да и адрес там всегда чужой:
 * запросы приходят через веб-сервер, а не с самой машины.
 */
const своиВРазработке = (req: Request): boolean => {
  if (process.env.NODE_ENV === "production") return false;
  const адрес = req.ip ?? "";
  return адрес === "127.0.0.1" || адрес === "::1" || адрес === "::ffff:127.0.0.1";
};

/** Вход и регистрация: защита от перебора паролей. Ключ — IP,
 *  потому что пользователь ещё не опознан. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message,
  skipSuccessfulRequests: true,
  skip: своиВРазработке,
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
