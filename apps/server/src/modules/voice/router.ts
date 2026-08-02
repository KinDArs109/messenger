import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { env } from "../../config/env.js";

export const voiceRouter: Router = Router();

/** Список серверов, через которые клиент ищет путь к собеседнику.
 *
 *  Отдаёт сервер, а не жёстко зашито в клиенте: появится TURN —
 *  достаточно будет дописать три строки в .env и перезапуститься,
 *  без пересборки клиента и без обновления .exe у всех друзей.
 *
 *  Доступ только для вошедших: учётные данные TURN — это платный
 *  или ограниченный ресурс, и раздавать их всем подряд нельзя. */
voiceRouter.get("/ice", requireAuth, (_req, res) => {
  // STUN не передаёт звук — только сообщает компьютеру, как он
  // выглядит снаружи.
  //
  // Порядок важен. Серверы Google стояли первыми и не отвечали вовсе:
  // из российских сетей они недоступны, и клиент тратил секунды
  // на ожидание молчащих адресов. Проверено скриптом check:nat —
  // из восьми известных серверов ответили ровно эти два.
  const servers: { urls: string | string[]; username?: string; credential?: string }[] = [
    { urls: ["stun:stun.sipnet.ru:3478", "stun:stun.miwifi.com:3478"] },
    // Google оставлен последним: там, где он работает, лишним
    // не будет, а ждать его первым — терять время на пустом месте.
    { urls: "stun:stun.l.google.com:19302" },
  ];

  if (env.TURN_URL) {
    servers.push({
      urls: env.TURN_URL,
      username: env.TURN_USER,
      credential: env.TURN_PASS,
    });
  }

  res.json({ iceServers: servers, hasTurn: Boolean(env.TURN_URL) });
});
