import { Router } from "express";
import { z } from "zod";
import { room, ulidSchema, type DmChannelDto } from "@messenger/shared";
import { prisma } from "../../db/client.js";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { newId } from "../../lib/ids.js";
import { toPublicUser } from "../../lib/dto.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { realtime } from "../../realtime/emitter.js";

export const dmsRouter: Router = Router();
dmsRouter.use(requireAuth);

const openDmSchema = z.object({ userId: ulidSchema });

type ChannelWithParticipants = {
  id: string;
  type: string;
  participants: { user: Parameters<typeof toPublicUser>[0] }[];
  messages: { createdAt: Date }[];
};

function toDto(channel: ChannelWithParticipants): DmChannelDto {
  return {
    id: channel.id,
    type: channel.type as "DM" | "GROUP_DM",
    participants: channel.participants.map((p) => toPublicUser(p.user)),
    lastMessageAt: channel.messages[0]?.createdAt.toISOString() ?? null,
  };
}

const include = {
  participants: { include: { user: true } },
  // Одно последнее сообщение — только чтобы отсортировать список.
  // Полный текст здесь не нужен и стоил бы лишнего трафика.
  messages: {
    where: { deletedAt: null },
    orderBy: { id: "desc" },
    take: 1,
    select: { createdAt: true },
  },
} as const;

dmsRouter.get("/", async (req, res) => {
  const userId = currentUserId(req);

  const channels = await prisma.channel.findMany({
    where: { serverId: null, participants: { some: { userId } } },
    include,
  });

  // Сортируем по последней активности: переписка, в которой только
  // что написали, должна быть сверху.
  const dms = channels
    .map(toDto)
    .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));

  res.json({ dms });
});

dmsRouter.post("/", validateBody(openDmSchema), async (req, res) => {
  const userId = currentUserId(req);
  const otherId = req.body.userId as string;

  if (otherId === userId) {
    throw badRequest("SELF_DM", "Нельзя начать переписку с самим собой");
  }

  const other = await prisma.user.findUnique({ where: { id: otherId }, select: { id: true } });
  if (!other) throw notFound("Пользователь не найден");

  // Переписка между двумя людьми одна на двоих. Личный канал состоит
  // ровно из двух участников, поэтому «есть оба» однозначно находит её.
  const existing = await prisma.channel.findFirst({
    where: {
      serverId: null,
      type: "DM",
      AND: [
        { participants: { some: { userId } } },
        { participants: { some: { userId: otherId } } },
      ],
    },
    include,
  });

  if (existing) {
    res.json({ dm: toDto(existing) });
    return;
  }

  const created = await prisma.channel.create({
    data: {
      id: newId(),
      type: "DM",
      serverId: null,
      participants: { create: [{ userId }, { userId: otherId }] },
    },
    include,
  });

  const dm = toDto(created);
  // Второму участнику переписка должна появиться в списке сразу,
  // а не после перезагрузки страницы.
  realtime().to(room.user(otherId)).emit("dm:created", dm);

  res.status(201).json({ dm });
});
