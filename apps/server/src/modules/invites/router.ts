import { Router } from "express";
import { createInviteSchema, room, type InvitePreview } from "@messenger/shared";
import { prisma } from "../../db/client.js";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { newInviteCode } from "../../lib/ids.js";
import { param } from "../../lib/params.js";
import { toPublicUser, toServerDto } from "../../lib/dto.js";
import type { MemberRole } from "@messenger/shared";
import { requireMembership, requirePermission } from "../../lib/access.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { verifyAccessToken } from "../../lib/tokens.js";
import { realtime } from "../../realtime/emitter.js";

/** Приглашения — единственный способ попасть на чужой сервер.
 *  Без этого модуля продукт невозможно никому показать: друг просто
 *  не может войти внутрь. */
export const invitesRouter: Router = Router();

/** Предпросмотр открыт без входа: человек по ссылке должен увидеть,
 *  куда его зовут, ещё до регистрации. Отдаём минимум — название
 *  и число участников, никаких списков людей и каналов. */
invitesRouter.get("/:code", async (req, res) => {
  const code = param(req, "code").toLowerCase();

  const invite = await prisma.invite.findUnique({
    where: { code },
    include: {
      server: { include: { _count: { select: { members: true } } } },
      creator: { select: { displayName: true } },
    },
  });

  if (!invite) throw notFound("Приглашение не найдено или отозвано");
  assertUsable(invite.expiresAt, invite.maxUses, invite.uses);

  // Токен здесь не обязателен, но если он есть — скажем, что человек
  // уже участник, чтобы не показывать ему кнопку «Принять».
  let alreadyMember = false;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const userId = await verifyAccessToken(header.slice(7));
    if (userId) {
      const member = await prisma.serverMember.findUnique({
        where: { serverId_userId: { serverId: invite.serverId, userId } },
        select: { userId: true },
      });
      alreadyMember = member !== null;
    }
  }

  const preview: InvitePreview = {
    code: invite.code,
    server: {
      id: invite.server.id,
      name: invite.server.name,
      iconUrl: invite.server.iconUrl,
    },
    memberCount: invite.server._count.members,
    inviter: invite.creator.displayName,
    alreadyMember,
  };

  res.json(preview);
});

invitesRouter.post("/:code/join", requireAuth, async (req, res) => {
  const userId = currentUserId(req);
  const code = param(req, "code").toLowerCase();

  const invite = await prisma.invite.findUnique({ where: { code } });
  if (!invite) throw notFound("Приглашение не найдено или отозвано");
  assertUsable(invite.expiresAt, invite.maxUses, invite.uses);

  // Бан проверяем до всего остального. Иначе выгнанный возвращается
  // по той же ссылке через минуту, и бан не значит ничего.
  const banned = await prisma.ban.findUnique({
    where: { serverId_userId: { serverId: invite.serverId, userId } },
    select: { reason: true },
  });
  if (banned) {
    throw forbidden(
      banned.reason ? `Вход закрыт: ${banned.reason}` : "Вход на этот сервер закрыт",
    );
  }

  const existing = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId: invite.serverId, userId } },
    select: { userId: true },
  });

  // Повторный переход по ссылке не должен ни падать, ни тратить
  // использование: человек мог просто открыть её дважды.
  if (!existing) {
    const [, , user] = await prisma.$transaction([
      prisma.serverMember.create({
        data: { serverId: invite.serverId, userId, role: "MEMBER" },
      }),
      prisma.invite.update({
        where: { code },
        data: { uses: { increment: 1 } },
      }),
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ]);

    realtime()
      .to(room.server(invite.serverId))
      .emit("member:join", { serverId: invite.serverId, user: toPublicUser(user) });
  }

  const server = await prisma.server.findUniqueOrThrow({
    where: { id: invite.serverId },
    include: {
      channels: { orderBy: { position: "asc" } },
      boosts: { select: { userId: true } },
    },
  });
  const membership = await prisma.serverMember.findUniqueOrThrow({
    where: { serverId_userId: { serverId: invite.serverId, userId } },
    select: { role: true },
  });

  res.json({
    server: toServerDto(server, membership.role as MemberRole, server.boosts.map((b) => b.userId)),
  });
});

export const serverInvitesRouter: Router = Router({ mergeParams: true });

serverInvitesRouter.post(
  "/",
  requireAuth,
  validateBody(createInviteSchema),
  async (req, res) => {
    const userId = currentUserId(req);
    const serverId = param(req, "serverId");
    const role = await requireMembership(userId, serverId);
    requirePermission(role, "invite:create");

    const invite = await prisma.invite.create({
      data: {
        code: newInviteCode(),
        serverId,
        creatorId: userId,
        maxUses: req.body.maxUses,
        expiresAt:
          req.body.expiresInHours === null
            ? null
            : new Date(Date.now() + req.body.expiresInHours * 3600_000),
      },
    });

    res.status(201).json({
      code: invite.code,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
      maxUses: invite.maxUses,
    });
  },
);

function assertUsable(
  expiresAt: Date | null,
  maxUses: number | null,
  uses: number,
): void {
  if (expiresAt && expiresAt < new Date()) {
    throw badRequest("INVITE_EXPIRED", "Срок действия приглашения истёк");
  }
  if (maxUses !== null && uses >= maxUses) {
    throw badRequest("INVITE_USED_UP", "Приглашение исчерпано");
  }
}
