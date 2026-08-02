import type { Request } from "express";
import { badRequest } from "./errors.js";

/** Express 5 типизирует параметры маршрута как `string | string[]`:
 *  повторяющиеся сегменты могут прийти массивом. Брать `!` и надеяться
 *  нельзя — Prisma тогда получает массив там, где ждёт строку, и роняет
 *  вывод типов всего запроса.
 *
 *  Здесь же ловим и пустое значение: параметр из URL — это ввод
 *  пользователя, а не константа. */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw badRequest("BAD_PARAM", "Некорректный адрес запроса");
  }
  return value;
}
