import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { MulterError } from "multer";
import { LIMITS } from "@messenger/shared";
import { AppError } from "../lib/errors.js";
import { isProduction } from "../config/env.js";

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: "Такого эндпоинта нет" },
  });
};

/** Единственное место, где формируется ответ об ошибке.
 *  Express 5 сам ловит отклонённые промисы из async-обработчиков
 *  и приводит их сюда — оборачивать каждый роут в try/catch не нужно. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, fields: err.fields },
    });
    return;
  }

  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] ??= issue.message;
    }
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Проверьте заполненные поля",
        fields,
      },
    });
    return;
  }

  // Multer бросает свои ошибки мимо нашей иерархии. Без этой ветки
  // слишком большой файл превращался в «внутреннюю ошибку сервера»,
  // хотя это обычная ситуация, о которой человеку надо сказать прямо.
  if (err instanceof MulterError) {
    const messages: Record<string, string> = {
      LIMIT_FILE_SIZE: `Файл больше ${Math.round(LIMITS.uploadBytes / 1024 / 1024)} МБ`,
      LIMIT_FILE_COUNT: "Слишком много файлов за раз",
      LIMIT_UNEXPECTED_FILE: "Неожиданное поле с файлом",
    };
    res.status(400).json({
      error: {
        code: err.code,
        message: messages[err.code] ?? "Не удалось принять файл",
      },
    });
    return;
  }

  // Всё непредвиденное: подробности — в лог, наружу — общая фраза.
  // Текст исключения может содержать фрагменты SQL или пути на диске.
  console.error("Необработанная ошибка:", err);
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: isProduction
        ? "Внутренняя ошибка сервера"
        : String(err instanceof Error ? err.message : err),
    },
  });
};
