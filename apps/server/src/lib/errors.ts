/** Единственный способ вернуть ошибку клиенту.
 *  Всё, что не AppError, считается непредвиденным: наружу уходит
 *  «внутренняя ошибка», подробности — только в лог. Так текст
 *  исключения из базы не утечёт в браузер. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (
  code: string,
  message: string,
  fields?: Record<string, string>,
) => new AppError(400, code, message, fields);

export const unauthorized = (message = "Требуется вход") =>
  new AppError(401, "UNAUTHORIZED", message);

export const forbidden = (message = "Недостаточно прав") =>
  new AppError(403, "FORBIDDEN", message);

export const notFound = (message = "Не найдено") =>
  new AppError(404, "NOT_FOUND", message);

export const conflict = (
  code: string,
  message: string,
  fields?: Record<string, string>,
) => new AppError(409, code, message, fields);

export const tooManyRequests = (message = "Слишком много запросов") =>
  new AppError(429, "RATE_LIMITED", message);
