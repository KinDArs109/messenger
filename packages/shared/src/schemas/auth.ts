import { z } from "zod";
import { LIMITS } from "../constants.js";
import { publicUserSchema } from "./common.js";

/** Логин пользователя: только латиница, цифры, точка и подчёркивание.
 *  Он участвует в упоминаниях (@username), поэтому пробелы и кириллица
 *  здесь недопустимы. Красивое имя живёт отдельно, в displayName. */
export const usernameSchema = z
  .string()
  .min(LIMITS.username.min, `Минимум ${LIMITS.username.min} символа`)
  .max(LIMITS.username.max, `Максимум ${LIMITS.username.max} символов`)
  .regex(
    /^[a-z0-9._]+$/,
    "Только строчные латинские буквы, цифры, точка и подчёркивание",
  )
  .refine((v) => !v.startsWith(".") && !v.endsWith("."), {
    message: "Не может начинаться или заканчиваться точкой",
  });

export const passwordSchema = z
  .string()
  .min(LIMITS.password.min, `Минимум ${LIMITS.password.min} символов`)
  .max(LIMITS.password.max, `Максимум ${LIMITS.password.max} символов`);

export const registerSchema = z.object({
  email: z.email("Некорректный адрес почты").toLowerCase(),
  username: usernameSchema,
  displayName: z
    .string()
    .trim()
    .min(LIMITS.displayName.min, "Укажите отображаемое имя")
    .max(LIMITS.displayName.max, `Максимум ${LIMITS.displayName.max} символов`),
  password: passwordSchema,
  /** Пропуск: общий код или код приглашения.
   *
   *  Нужен, только если сервер настроен закрытым. Одно поле на оба
   *  случая намеренно: человеку всё равно, что именно ему прислали,
   *  а разводить два поля значит заставлять его выбирать. */
  signupCode: z.string().trim().max(64).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

/** Запрос кода на смену пароля. */
export const forgotPasswordSchema = z.object({
  login: z.string().trim().min(1, "Введите почту или имя пользователя").max(255).toLowerCase(),
});

/** Смена пароля по коду из письма. */
export const resetPasswordSchema = z.object({
  login: z.string().trim().min(1).max(255).toLowerCase(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Код состоит из шести цифр"),
  password: passwordSchema,
});

/** Открыта ли регистрация — клиент спрашивает до показа формы,
 *  чтобы не рисовать лишнее поле там, где оно не нужно. */
export interface SignupPolicyDto {
  codeRequired: boolean;
}

/** Вход по почте или по имени пользователя.
 *
 *  Одно поле на оба варианта, а не переключатель: человек не обязан
 *  помнить, чем он регистрировался. Различаем по наличию собаки —
 *  логин её содержать не может по правилам usernameSchema. */
export const loginSchema = z.object({
  login: z
    .string()
    .trim()
    .min(1, "Введите почту или имя пользователя")
    .max(255)
    .toLowerCase(),
  password: z.string().min(1, "Введите пароль"),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Вход по одноразовому коду вместо пароля.
 *
 *  Отдельная схема, а не необязательный код в обычном входе: это
 *  другой способ доказать, что учётная запись ваша, и путать их
 *  в одном обработчике — верный способ однажды пустить с пустым
 *  паролем. */
export const loginCodeSchema = z.object({
  login: z.string().trim().min(1, "Введите почту или имя пользователя").max(255).toLowerCase(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Код состоит из шести цифр"),
});
export type LoginCodeInput = z.infer<typeof loginCodeSchema>;

/** Refresh-токен возвращается не здесь, а в httpOnly-cookie:
 *  до него не должен дотягиваться JavaScript страницы. */
export const authResponseSchema = z.object({
  user: publicUserSchema.extend({ email: z.email() }),
  accessToken: z.string(),
  expiresIn: z.number(),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

/** Второй шаг входа: пропуск с первого шага и шесть цифр из письма. */
export const loginConfirmSchema = z.object({
  ticket: z.string().min(10).max(2048),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Код состоит из шести цифр"),
});

/** Письмо не дошло — отправить ещё раз по тому же пропуску. */
export const loginResendSchema = z.object({
  ticket: z.string().min(10).max(2048),
});

/**
 * Ответ на первый шаг входа, когда нужен код из письма.
 *
 * Сессии здесь ещё нет — ни токена, ни cookie. Клиент отличает этот
 * ответ от обычного по полю pending и показывает поле для кода.
 */
export interface LoginPendingDto {
  pending: "email";
  /** Пропуск на второй шаг: подписан сервером, живёт пятнадцать минут. */
  ticket: string;
  /** Адрес, наполовину закрытый: человеку — подсказка, в какой ящик
   *  идти; чужому, знающему только пароль, — ничего нового. */
  email: string;
  /** Ушло ли письмо. false — почта на сервере молчит, и это надо
   *  сказать прямо, а не оставлять человека ждать. */
  sent: boolean;
}
