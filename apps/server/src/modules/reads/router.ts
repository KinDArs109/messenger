import { Router } from "express";
import { z } from "zod";
import { ulidSchema, type ReadStateDto } from "@messenger/shared";
import { prisma } from "../../db/client.js";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { param } from "../../lib/params.js";
import { requireChannelAccess } from "../../lib/access.js";
import { visibleChannelIds } from "./channels.js";

export const readsRouter: Router = Router();
readsRouter.use(requireAuth);

/** Состояние прочитанного по всем каналам сразу.
 *
 *  Клиенту нужно знать две вещи: где он остановился и что там сейчас
 *  последнее. Разница между ними и есть «непрочитано». Отдаём обе
 *  одним запросом — иначе клиент делал бы по запросу на канал. */
readsRouter.get("/", async (req, res) => {
  const userId = currentUserId(req);
  const channelIds = await visibleChannelIds(userId);

  const [states, latest] = await Promise.all([
    prisma.readState.findMany({ where: { userId, channelId: { in: channelIds } } }),
    // Последнее сообщение в каждом канале. Группировка бьёт точно
    // в индекс [channelId, id DESC], поэтому стоит копейки.
    prisma.message.groupBy({
      by: ["channelId"],
      where: { channelId: { in: channelIds }, deletedAt: null },
      _max: { id: true },
    }),
  ]);

  const readByChannel = new Map(states.map((s) => [s.channelId, s]));

  const readStates: ReadStateDto[] = latest.map((row) => {
    const state = readByChannel.get(row.channelId);
    return {
      channelId: row.channelId,
      lastMessageId: row._max.id,
      lastReadMessageId: state?.lastReadMessageId ?? null,
      mentionCount: state?.mentionCount ?? 0,
    };
  });

  res.json({ readStates });
});

const markReadSchema = z.object({ messageId: ulidSchema });

readsRouter.post("/:channelId", validateBody(markReadSchema), async (req, res) => {
  const userId = currentUserId(req);
  const channelId = param(req, "channelId");
  await requireChannelAccess(userId, channelId);

  const messageId = req.body.messageId as string;
  const existing = await prisma.readState.findUnique({
    where: { userId_channelId: { userId, channelId } },
    select: { lastReadMessageId: true },
  });

  // Метку двигаем только вперёд. ULID сортируется как строка, поэтому
  // сравнение простое. Без этой проверки прокрутка вверх по истории
  // «разчитывала» бы канал обратно.
  if (existing?.lastReadMessageId && existing.lastReadMessageId >= messageId) {
    res.status(204).end();
    return;
  }

  await prisma.readState.upsert({
    where: { userId_channelId: { userId, channelId } },
    create: { userId, channelId, lastReadMessageId: messageId, mentionCount: 0 },
    update: { lastReadMessageId: messageId, mentionCount: 0 },
  });

  res.status(204).end();
});
