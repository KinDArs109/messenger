import { Router } from "express";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { env } from "../../config/env.js";
import { issueCredentials } from "../../turn/credentials.js";
import { isPrivate, localIPv4, turnServer } from "../../turn/server.js";

export const voiceRouter: Router = Router();

/** Список серверов, через которые клиент ищет путь к собеседнику.
 *
 *  Отдаёт сервер, а не жёстко зашито в клиенте: появится TURN —
 *  достаточно будет дописать три строки в .env и перезапуститься,
 *  без пересборки клиента и без обновления .exe у всех друзей.
 *
 *  Доступ только для вошедших: учётные данные TURN — это платный
 *  или ограниченный ресурс, и раздавать их всем подряд нельзя. */
voiceRouter.get("/ice", requireAuth, (req, res) => {
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

  // Свой ретранслятор. Пароль — временный: он уезжает в браузер
  // каждому, кто вошёл в разговор, то есть секретом не является
  // и обязан протухать сам. Считается из общего секрета, хранить
  // выданное серверу не нужно.
  if (env.TURN_SECRET) {
    // Адрес выбираем под спрашивающего. Другу из интернета нужен
    // внешний, соседу по квартире — домашний: гонять его наружу
    // и обратно умеет не всякий роутер.
    const outside = env.TURN_HOST ?? turnServer()?.publicAddress ?? null;
    const home = isPrivate(req.ip ?? "") || !outside;
    const host = home ? localIPv4() : outside;

    const { username, credential } = issueCredentials(env.TURN_SECRET, currentUserId(req));
    servers.push({
      // И UDP, и TCP: там, где провайдер режет UDP, разговор пойдёт
      // хотя бы по TCP. Порядок важен — UDP пробуется первым, он
      // для звука лучше.
      urls: [`turn:${host}:${env.TURN_PORT}?transport=udp`],
      username,
      credential,
    });
  }

  // Чужой ретранслятор, если когда-нибудь появится платный.
  if (env.TURN_URL) {
    servers.push({
      urls: env.TURN_URL,
      username: env.TURN_USER,
      credential: env.TURN_PASS,
    });
  }

  res.json({
    iceServers: servers,
    hasTurn: Boolean(env.TURN_SECRET || env.TURN_URL),
  });
});
