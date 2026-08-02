import { z } from "zod";
import { usernameSchema } from "./auth.js";
import type { PublicUser } from "./common.js";

/** Заявка отправляется по имени пользователя, а не по идентификатору.
 *
 *  Идентификаторы наружу не показываются нигде, и человеку неоткуда
 *  их взять. Логин же он видит в профиле собеседника и может просто
 *  спросить в другом мессенджере — ради этого логин и существует. */
export const friendRequestSchema = z.object({
  username: usernameSchema,
});
export type FriendRequestInput = z.infer<typeof friendRequestSchema>;

/** Дружба глазами конкретного человека.
 *
 *  На сервере это одна строка на пару, но показывать её надо
 *  по-разному: для отправителя заявка «исходящая», для получателя
 *  «входящая». Направление считает сервер — клиенту незачем знать,
 *  кто там requester. */
export interface FriendshipDto {
  id: string;
  user: PublicUser;
  status: "PENDING" | "ACCEPTED";
  /** Только для PENDING: чья заявка. */
  direction: "incoming" | "outgoing";
  createdAt: string;
}
