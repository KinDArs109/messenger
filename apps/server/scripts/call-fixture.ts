import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import { hashPassword } from "../src/lib/password.js";

/**
 * Двое временных людей с перепиской между ними — чтобы проверить
 * звонок руками, нажимая кнопки, а не вызывая события кодом.
 *
 *   npm run fixture:call -w @messenger/server -- --setup
 *   npm run fixture:call -w @messenger/server -- --cleanup
 *
 * Заводить настоящих людей ради проверки нельзя, а проверять звонок
 * на живых друзьях среди ночи — тем более. Эти двое живут ровно
 * столько, сколько идёт проверка, и уносятся тем же скриптом.
 *
 * Метка в почте одна на прогон: по ней и убираем, чтобы случайно
 * не задеть настоящих.
 */

const prisma = new PrismaClient();
const MARK = "call-check";

async function setup() {
  const password = `check-${randomUUID()}`;
  const hash = await hashPassword(password);

  const make = (name: string) =>
    prisma.user.create({
      data: {
        id: ulid(),
        email: `${MARK}-${name}@example.invalid`,
        username: `${MARK}-${name}`,
        displayName:
          { a: "Проверка Первый", b: "Проверка Второй", c: "Проверка Третий" }[name] ??
          "Проверка Четвёртый",
        passwordHash: hash,
        emailVerifiedAt: new Date(),
      },
    });

  const a = await make("a");
  const b = await make("b");
  // Ещё двое — ради проверки уровней сервера: третий уровень даёт
  // четыре буста, а бустят люди, по одному с человека. Вдвоём его
  // не набрать, и проверять эмодзи было бы не на чем.
  const c = await make("c");
  const d = await make("d");

  // Переписка между ними — то, откуда звонят.
  const dm = await prisma.channel.create({
    data: {
      id: ulid(),
      type: "DM",
      participants: { create: [{ userId: a.id }, { userId: b.id }] },
    },
  });

  // И дружба: без неё переписка есть, но в списке друзей пусто,
  // а проверить хочется и то и другое.
  await prisma.friendship.create({
    data: {
      id: ulid(),
      requesterId: a.id,
      addresseeId: b.id,
      status: "ACCEPTED",
      acceptedAt: new Date(),
    },
  });

  console.log(
    JSON.stringify(
      {
        password,
        a: { id: a.id, email: a.email, name: a.displayName },
        b: { id: b.id, email: b.email, name: b.displayName },
        c: { id: c.id, email: c.email, name: c.displayName },
        d: { id: d.id, email: d.email, name: d.displayName },
        dm: dm.id,
      },
      null,
      1,
    ),
  );
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: MARK } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) {
    console.log("убирать нечего");
    return;
  }

  // Каналы, где участвовал кто-то из наших, — только те, где нет
  // никого постороннего: чужую переписку сносить нельзя ни при каких
  // обстоятельствах.
  const channels = await prisma.channel.findMany({
    where: { participants: { some: { userId: { in: ids } } } },
    select: { id: true, participants: { select: { userId: true } } },
  });
  const ours = channels
    .filter((c) => c.participants.every((p) => ids.includes(p.userId)))
    .map((c) => c.id);

  // Серверы, созданные проверкой. Только свои: чужие не трогаем даже
  // если наш человек в них состоял — он там гость, а не хозяин.
  const servers = await prisma.server.findMany({
    where: { ownerId: { in: ids } },
    select: { id: true, channels: { select: { id: true } } },
  });
  const serverIds = servers.map((s) => s.id);
  const serverChannels = servers.flatMap((s) => s.channels.map((c) => c.id));

  const channelsToDrop = [...new Set([...ours, ...serverChannels])];

  await prisma.message.deleteMany({ where: { channelId: { in: channelsToDrop } } });
  await prisma.channelParticipant.deleteMany({ where: { channelId: { in: channelsToDrop } } });
  await prisma.channel.deleteMany({ where: { id: { in: channelsToDrop } } });
  await prisma.serverMember.deleteMany({ where: { serverId: { in: serverIds } } });
  await prisma.server.deleteMany({ where: { id: { in: serverIds } } });
  await prisma.friendship.deleteMany({
    where: { OR: [{ requesterId: { in: ids } }, { addresseeId: { in: ids } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });

  console.log(
    `убрано: людей ${ids.length}, каналов ${channelsToDrop.length}, серверов ${serverIds.length}`,
  );
}

const mode = process.argv.includes("--cleanup") ? cleanup : setup;

void mode()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
