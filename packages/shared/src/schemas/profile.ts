import { z } from "zod";
import { LIMITS } from "../constants.js";
import { uploadUrlSchema } from "./common.js";

/** Правка профиля.
 *
 *  Имени пользователя здесь нет намеренно: оно задаётся один раз при
 *  регистрации и дальше неизменно. По нему упоминают в сообщениях,
 *  по нему находят и добавляют в друзья, и по нему же теперь входят.
 *  Смена логина рвала бы всё это разом: старые упоминания указывали бы
 *  в пустоту, а освободившееся имя мог бы занять кто угодно и получить
 *  чужие уведомления. */
export const updateProfileSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(LIMITS.displayName.min, "Укажите отображаемое имя")
      .max(LIMITS.displayName.max, `Максимум ${LIMITS.displayName.max} символов`)
      .optional(),
    // null — убрать аватар и вернуться к букве на цветном кружке.
    avatarUrl: uploadUrlSchema.nullable().optional(),
  })
  .refine((v) => v.displayName !== undefined || v.avatarUrl !== undefined, {
    message: "Менять нечего",
    path: ["displayName"],
  });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Одноразовые коды: подключение и состояние. */
export const totpEnableSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Код состоит из шести цифр"),
});

export const totpDisableSchema = z.object({
  password: z.string().min(1, "Введите пароль"),
});

export interface TotpSetupDto {
  /** Ключ для ручного ввода — если камера не работает или QR не читается. */
  secret: string;
  /** PNG-картинка в виде data-URL: готова к вставке в <img>. */
  qr: string;
}

export interface TotpStatusDto {
  enabled: boolean;
  enabledAt: string | null;
}

/** Код подтверждения почты — те же шесть цифр, что и у TOTP,
 *  но приходят письмом и живут пятнадцать минут, а не тридцать секунд. */
export const emailCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Код состоит из шести цифр"),
});

/** Активная сессия — одна строка в списке «Безопасность».
 *
 *  Ни самого токена, ни его хеша здесь нет и быть не может: список
 *  показывается в браузере, а токен даёт полный доступ к учётной
 *  записи. Наружу уходит только то, по чему сессию можно опознать
 *  глазами и отозвать по идентификатору. */
export interface SessionDto {
  id: string;
  userAgent: string | null;
  /** Чем зашли: «app-desktop», «app-mobile» или «browser».
   *  null — вход был до того, как клиент начал об этом сообщать. */
  client?: string | null;
  createdAt: string;
  expiresAt: string;
  /** Та сессия, из которой пришёл запрос. Её нельзя закрыть кнопкой
   *  «Отозвать» — для этого есть «Выйти». */
  current: boolean;
}
