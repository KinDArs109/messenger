import { z } from "zod";
import { USER_STATUSES, type ChosenStatus } from "../constants.js";

/** ULID: 26 символов кодировки Кроуфорда. Сортируется по времени
 *  как строка, поэтому курсорная пагинация работает без отдельного
 *  поля с датой. */
export const ulidSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "Некорректный идентификатор");

/** Ссылка на нашу же загрузку — аватар профиля или значок сервера.
 *
 *  Проверяем форму, а не просто «строка»: сюда приходит то, что
 *  прислал браузер, и без проверки в поле картинки оказался бы
 *  чужой адрес. Тогда каждый, кто видит участника, незаметно для
 *  себя ходил бы на чужой сервер и сообщал ему свой IP. */
export const uploadUrlSchema = z
  .string()
  .regex(/^\/uploads\/[0-9A-HJKMNP-TV-Z]{26}\.webp$/, "Некорректная ссылка на картинку");

export const publicUserSchema = z.object({
  id: ulidSchema,
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  status: z.enum(USER_STATUSES),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

/** Тот же пользователь, но каким его видит он сам: с почтой и
 *  признаком её подтверждения. Отдельный тип, а не пересечение
 *  по месту, — иначе добавление поля означает правку каждого
 *  вызова, и компилятор находит их по одному. */
export type PrivateUser = PublicUser & {
  email: string;
  emailVerified: boolean;
  /** Что человек выбрал о себе сам — включая «невидимый», которого
   *  в публичном статусе нет и быть не может. Приходит только ему:
   *  выбор нужен, чтобы в меню стояла галочка там, где он её
   *  поставил, и переживал перезагрузку страницы. */
  chosenStatus: ChosenStatus;
};

/** Единый формат ошибки. Клиент всегда получает одну и ту же форму,
 *  поэтому обработка ошибок пишется один раз. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z.record(z.string(), z.string()).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const paginationQuerySchema = z.object({
  before: ulidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
