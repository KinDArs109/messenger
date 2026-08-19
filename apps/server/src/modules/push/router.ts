import { Router } from "express";
import { z } from "zod";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { devicesOf, forget, pushEnabled, remember, vapidPublicKey } from "./service.js";

/**
 * Подписка на уведомления.
 *
 * Три действия и ничего больше: узнать наш открытый ключ, записаться,
 * выписаться. Всё остальное происходит между браузером и его же
 * службой доставки — сервер в этом не участвует.
 */
export const pushRouter: Router = Router();

const subscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    // Ключи короткие и в base64url; длину ограничиваем, чтобы в базу
    // нельзя было положить мегабайт через это поле.
    p256dh: z.string().min(20).max(200),
    auth: z.string().min(10).max(100),
  }),
  /** Чем подписались — «Chrome на Android». Показывается только
   *  владельцу в настройках. */
  label: z.string().max(80).optional(),
});

/** Открытый ключ. Без входа: он и так уезжает на страницу каждому,
 *  кто её открыл, и тайной не является. */
pushRouter.get("/key", (_req, res) => {
  res.json({ key: pushEnabled ? vapidPublicKey : null });
});

pushRouter.post("/", requireAuth, validateBody(subscribeSchema), async (req, res) => {
  const userId = currentUserId(req);
  const { endpoint, keys, label } = req.body as z.infer<typeof subscribeSchema>;

  await remember(userId, { endpoint, p256dh: keys.p256dh, auth: keys.auth, label });
  res.status(201).json({ devices: await devicesOf(userId) });
});

/** Отписка. POST, а не DELETE: адрес подписки — строка на полкилобайта,
 *  и его место в теле запроса, а тело у DELETE полагается пустым. */
pushRouter.post("/forget", requireAuth, async (req, res) => {
  const endpoint = String((req.body as { endpoint?: string })?.endpoint ?? "");
  if (endpoint) await forget(endpoint);
  res.json({ devices: await devicesOf(currentUserId(req)) });
});
