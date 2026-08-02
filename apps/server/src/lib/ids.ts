import { ulid } from "ulid";
import { customAlphabet } from "./nanoid.js";

/** ULID вместо автоинкремента:
 *  — сортируется по времени как обычная строка, поэтому курсорная
 *    пагинация работает без отдельного поля с датой;
 *  — не раскрывает, сколько всего записей в таблице;
 *  — генерируется на стороне приложения, значит клиент может
 *    показать сообщение оптимистично, ещё не дождавшись ответа. */
export const newId = (): string => ulid();

/** Код приглашения. Алфавит без похожих символов (0/O, 1/l/I),
 *  чтобы код можно было продиктовать голосом. */
const inviteAlphabet = "23456789abcdefghjkmnpqrstuvwxyz";
const generateInviteCode = customAlphabet(inviteAlphabet, 8);

export const newInviteCode = (): string => generateInviteCode();
