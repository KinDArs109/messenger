import type { MemberRole, Permission } from "@messenger/shared";
import { can } from "@messenger/shared";
import { prisma } from "../db/client.js";
import { forbidden, notFound } from "./errors.js";

/** Все проверки доступа живут здесь и больше нигде.
 *
 *  Соблазн написать `if (server.ownerId === userId)` прямо в обработчике
 *  велик, но именно так и появляются дыры: один эндпоинт забыли, и через
 *  него читают чужие каналы. Клиент может прислать любой идентификатор,
 *  какой захочет, — значит каждый вход проверяем одинаково строго. */

export async function requireMembership(
  userId: string,
  serverId: string,
): Promise<MemberRole> {
  const member = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId, userId } },
    select: { role: true },
  });

  // Отвечаем «не найдено», а не «нет прав»: иначе перебором
  // идентификаторов можно выяснить, какие серверы существуют.
  if (!member) throw notFound("Сервер не найден");
  return member.role as MemberRole;
}

export function requirePermission(role: MemberRole, permission: Permission): void {
  if (!can(role, permission)) throw forbidden();
}

export interface ChannelAccess {
  channelId: string;
  serverId: string | null;
  type: string;
  role: MemberRole | null; // null для личных переписок — там нет ролей
}

export async function requireChannelAccess(
  userId: string,
  channelId: string,
): Promise<ChannelAccess> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, serverId: true, type: true },
  });
  if (!channel) throw notFound("Канал не найден");

  if (channel.serverId) {
    const role = await requireMembership(userId, channel.serverId);
    return { channelId: channel.id, serverId: channel.serverId, type: channel.type, role };
  }

  const participant = await prisma.channelParticipant.findUnique({
    where: { channelId_userId: { channelId, userId } },
    select: { userId: true },
  });
  if (!participant) throw notFound("Канал не найден");

  return { channelId: channel.id, serverId: null, type: channel.type, role: null };
}
