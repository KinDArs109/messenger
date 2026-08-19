import { Router } from "express";
import { banSchema, canActOn, room, type MemberRole } from "@messenger/shared";
import { validateBody } from "../../middleware/validate.js";
import { currentUserId } from "../../middleware/auth.js";
import { requireMembership, requirePermission } from "../../lib/access.js";
import { prisma } from "../../db/client.js";
import { toPublicUser } from "../../lib/dto.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { param } from "../../lib/params.js";
import { realtime } from "../../realtime/emitter.js";
import { leaveVoice } from "../../realtime/voice.js";

/** Кик и бан. Монтируется внутрь serversRouter, поэтому requireAuth
 *  уже отработал выше. */
export const moderationRouter: Router = Router({ mergeParams: true });

/** Общая часть обоих действий: выяснить, вправе ли актор трогать цель.
 *
 *  Правило одно — только тех, кто ниже по роли. Владельца не трогает
 *  никто, включая другого владельца, и самого себя тоже нельзя:
 *  «выгнать себя» — это выход, у него другая кнопка и другой смысл. */
async function requireTarget(
  req: Parameters<Parameters<Router["get"]>[1]>[0],
  permission: "member:kick" | "member:ban",
): Promise<{ serverId: string; actorId: string; targetId: string; targetRole: MemberRole | null }> {
  const serverId = param(req, "serverId");
  const targetId = param(req, "userId");
  const actorId = currentUserId(req);

  const actorRole = await requireMembership(actorId, serverId);
  requirePermission(actorRole, permission);

  if (targetId === actorId) {
    throw badRequest("SELF_ACTION", "Себя нельзя — для этого есть выход из сервера");
  }

  const target = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId, userId: targetId } },
    select: { role: true },
  });

  // Забанить можно и того, кого уже нет на сервере: он мог выйти сам,
  // чтобы вернуться по ссылке. Кикать при этом некого — но проверку
  // ролей это не отменяет.
  if (target && !canActOn(actorRole, target.role as MemberRole)) {
    throw forbidden("Нельзя трогать участника с равной или высшей ролью");
  }

  return { serverId, actorId, targetId, targetRole: (target?.role as MemberRole) ?? null };
}

/** Убрать из сервера: членство, прочитанное, приглашения, голос.
 *
 *  Сообщения остаются — переписка это общая история, и вычищать её
 *  задним числом значит переписывать разговор, в котором участвовали
 *  и другие. */
async function removeFromServer(serverId: string, userId: string): Promise<void> {
  const io = realtime();

  await prisma.serverMember.delete({
    where: { serverId_userId: { serverId, userId } },
  });

  const channels = await prisma.channel.findMany({
    where: { serverId },
    select: { id: true },
  });
  await prisma.readState.deleteMany({
    where: { userId, channelId: { in: channels.map((c) => c.id) } },
  });

  // Если человек сидел в голосовом канале этого сервера — выводим.
  void leaveVoice(io, userId);

  io.to(room.server(serverId)).emit("member:leave", { serverId, userId });
  // Отдельно самому изгнанному: он в комнате сервера уже не состоит
  // после выхода из неё, а узнать о случившемся должен.
  io.to(room.user(userId)).emit("member:leave", { serverId, userId });

  for (const socket of await io.in(room.user(userId)).fetchSockets()) {
    void socket.leave(room.server(serverId));
    for (const channel of channels) void socket.leave(room.channel(channel.id));
  }
}

moderationRouter.delete("/:userId", async (req, res) => {
  const { serverId, targetId, targetRole } = await requireTarget(req, "member:kick");
  if (!targetRole) throw notFound("Участник не найден");

  await removeFromServer(serverId, targetId);
  res.status(204).end();
});

moderationRouter.post("/:userId/ban", validateBody(banSchema), async (req, res) => {
  const { serverId, actorId, targetId, targetRole } = await requireTarget(req, "member:ban");
  const { reason } = req.body as { reason?: string };

  await prisma.ban.upsert({
    where: { serverId_userId: { serverId, userId: targetId } },
    create: { serverId, userId: targetId, bannedById: actorId, reason: reason ?? null },
    update: { bannedById: actorId, reason: reason ?? null },
  });

  if (targetRole) await removeFromServer(serverId, targetId);

  res.status(204).end();
});

moderationRouter.delete("/:userId/ban", async (req, res) => {
  const serverId = param(req, "serverId");
  const role = await requireMembership(currentUserId(req), serverId);
  requirePermission(role, "member:ban");

  await prisma.ban
    .delete({ where: { serverId_userId: { serverId, userId: param(req, "userId") } } })
    .catch(() => null);

  res.status(204).end();
});

/** Список забаненных — чтобы разбанить было кого. */
export const bansRouter: Router = Router({ mergeParams: true });

bansRouter.get("/", async (req, res) => {
  const serverId = param(req, "serverId");
  const role = await requireMembership(currentUserId(req), serverId);
  requirePermission(role, "member:ban");

  const bans = await prisma.ban.findMany({
    where: { serverId },
    orderBy: { createdAt: "desc" },
    include: { user: true },
  });

  res.json({
    bans: bans.map((b) => ({
      user: toPublicUser(b.user),
      reason: b.reason,
      createdAt: b.createdAt.toISOString(),
    })),
  });
});
