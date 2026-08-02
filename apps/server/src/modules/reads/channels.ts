import { prisma } from "../../db/client.js";

/** Все каналы, которые человек вправе видеть: текстовые каналы его
 *  серверов плюс личные переписки. Голосовые не считаем — там нет
 *  истории, значит нечему быть непрочитанным. */
export async function visibleChannelIds(userId: string): Promise<string[]> {
  const [memberships, dms] = await Promise.all([
    prisma.serverMember.findMany({ where: { userId }, select: { serverId: true } }),
    prisma.channelParticipant.findMany({ where: { userId }, select: { channelId: true } }),
  ]);

  const serverChannels = await prisma.channel.findMany({
    where: { serverId: { in: memberships.map((m) => m.serverId) }, type: "TEXT" },
    select: { id: true },
  });

  return [...serverChannels.map((c) => c.id), ...dms.map((d) => d.channelId)];
}
