import type { RequestHandler } from "express";
import type { ZodType } from "zod";

/** Тело запроса заменяется на результат разбора схемы.
 *  Дальше по цепочке лежат только проверенные данные нужного типа —
 *  никаких `req.body.email as string` в обработчиках.
 *
 *  ZodError долетает до errorHandler и превращается в разбивку
 *  по полям, которую форма на клиенте показывает под инпутами. */
export function validateBody(schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(result.error);
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(result.error);
      return;
    }
    // req.query в Express 5 — только для чтения, поэтому результат
    // кладём отдельным полем.
    (req as { validatedQuery?: unknown }).validatedQuery = result.data;
    next();
  };
}
