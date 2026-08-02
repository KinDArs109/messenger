import { Router } from "express";
import { createChannelSchema, createServerSchema } from "@messenger/shared";
import { room } from "@messenger/shared";
import { prisma } from "../../db/client.js";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { newId } from "../../lib/ids.js";
import { toPublicUser } from "../../lib/dto.js";
import { requireMembership, requirePermission } from "../../lib/access.js";
import { param } from "../../lib/params.js";
import { realtime } from "../../realtime/emitter.js";

export const serversRouter: Router = Router();
serversRouter.use(requireAuth);

/** Серверы текущего пользователя вместе с каналами — это первый запрос
 *  клиента после входа, поэтому отдаём всё разом, чтобы не заставлять
 *  его делать N дополнительных обращений. */
serversRouter.get("/", async (req, res) => {
  const memberships = await prisma.serverMember.findMany({
    where: { userId: currentUserId(req) },
    include: {
      server: { include: { channels: { orderBy: { position: "asc" } } } },
    },
    orderBy: { joinedAt: "asc" },
  });

  res.json({
    servers: memberships.map((m) => ({
      id: m.server.id,
      name: m.server.name,
      iconUrl: m.server.iconUrl,
      role: m.role,
      channels: m.server.channels.map((c) => ({
        id: c.id,
        serverId: c.serverId,
        type: c.type,
        name: c.name,
        topic: c.topic,
        position: c.position,
      })),
    })),
  });
});

serversRouter.post("/", validateBody(createServerSchema), async (req, res) => {
  const userId = currentUserId(req);

  // Пустой сервер бесполезен: сразу заводим текстовый и голосовой канал,
  // иначе новый пользователь попадает на экран, где ничего нельзя сделать.
  const server = await prisma.server.create({
    data: {
      id: newId(),
      name: req.body.name,
      ownerId: userId,
      members: { create: { userId, role: "OWNER" } },
      channels: {
        create: [
          { id: newId(), type: "TEXT", name: "общий", position: 0 },
          { id: newId(), type: "VOICE", name: "Разговор", position: 1 },
        ],
      },
    },
    include: { channels: { orderBy: { position: "asc" } } },
  });

  res.status(201).json({ server });
});

serversRouter.get("/:serverId/members", async (req, res) => {
  const serverId = param(req, "serverId");
  await requireMembership(currentUserId(req), serverId);

  const members = await prisma.serverMember.findMany({
    where: { serverId },
    include: { user: true },
  });

  res.json({
    members: members.map((m) => ({ ...toPublicUser(m.user), role: m.role })),
  });
});

serversRouter.post(
  "/:serverId/channels",
  validateBody(createChannelSchema),
  async (req, res) => {
    const serverId = param(req, "serverId");
    const role = await requireMembership(currentUserId(req), serverId);
    requirePermission(role, "channel:create");

    const last = await prisma.channel.findFirst({
      where: { serverId },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    const channel = await prisma.channel.create({
      data: {
        id: newId(),
        serverId,
        type: req.body.type,
        name: req.body.name,
        position: (last?.position ?? -1) + 1,
      },
    });

    realtime().to(room.server(serverId)).emit("channel:create", {
      id: channel.id,
      serverId: channel.serverId,
      type: channel.type as "TEXT" | "VOICE",
      name: channel.name,
      topic: channel.topic,
      position: channel.position,
    });

    res.status(201).json({ channel });
  },
);
