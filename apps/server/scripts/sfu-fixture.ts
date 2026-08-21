// Люди и канал для сквозной проверки раздачи.
//
//   npx tsx --env-file=.env scripts/sfu-fixture.ts create
//   npx tsx --env-file=.env scripts/sfu-fixture.ts clean
//
// Отдельным файлом, потому что зовут его из проверки, которая живёт
// в Electron: до базы ей не дотянуться, а заводить троих человек
// и голосовой канал руками перед каждым прогоном — верный способ
// перестать прогонять.

import { createHash } from "node:crypto";
import { ulid } from "ulid";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password.js";

const prisma = new PrismaClient();
const МЕТКА = "sfucheck";
const КОД = "424242";

async function создать() {
  const пароль = `sfu-${ulid().slice(0, 12)}`;
  const hash = await hashPassword(пароль);

  const люди = await Promise.all(
    ["a", "b", "c"].map((буква) =>
      prisma.user.upsert({
        where: { username: `${МЕТКА}.${буква}` },
        update: { passwordHash: hash },
        create: {
          id: ulid(),
          email: `${МЕТКА}.${буква}@example.invalid`,
          username: `${МЕТКА}.${буква}`,
          displayName: `Проверка ${буква.toUpperCase()}`,
          passwordHash: hash,
          emailVerifiedAt: new Date(),
        },
      }),
    ),
  );

  const был = await prisma.server.findFirst({
    where: { name: `${МЕТКА} сервер` },
    include: { channels: true },
  });

  const сервер =
    был ??
    (await prisma.server.create({
      data: {
        id: ulid(),
        name: `${МЕТКА} сервер`,
        ownerId: люди[0]!.id,
        members: {
          create: люди.map((кто, i) => ({
            userId: кто.id,
            role: i === 0 ? "OWNER" : "MEMBER",
          })),
        },
        channels: {
          create: [
            { id: ulid(), type: "TEXT", name: "общий", position: 0 },
            { id: ulid(), type: "VOICE", name: "Разговор", position: 1 },
          ],
        },
      },
      include: { channels: true },
    }));

  // Код на вход кладём сами: писем проверка не читает.
  await prisma.user.updateMany({
    where: { id: { in: люди.map((к) => к.id) } },
    data: {
      loginCodeHash: createHash("sha256").update(КОД).digest("hex"),
      loginCodeExpires: new Date(Date.now() + 60 * 60 * 1000),
      loginCodeSentAt: new Date(),
      loginCodeAttempts: 0,
    },
  });

  console.log(
    JSON.stringify({
      пароль,
      код: КОД,
      логины: люди.map((к) => к.username),
      люди: люди.map((к) => к.id),
      сервер: сервер.name,
      голосовой: сервер.channels.find((к) => к.type === "VOICE")?.id,
    }),
  );
}

async function убрать() {
  const люди = await prisma.user.findMany({
    where: { username: { startsWith: МЕТКА } },
    select: { id: true },
  });
  const ids = люди.map((к) => к.id);

  const серверы = await prisma.server.findMany({
    where: { name: { startsWith: МЕТКА } },
    select: { id: true },
  });
  for (const { id } of серверы) {
    await prisma.message.deleteMany({ where: { channel: { serverId: id } } });
    await prisma.channel.deleteMany({ where: { serverId: id } });
    await prisma.serverMember.deleteMany({ where: { serverId: id } });
    await prisma.invite.deleteMany({ where: { serverId: id } });
    await prisma.server.delete({ where: { id } });
  }

  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.message.deleteMany({ where: { authorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });

  const осталось = await prisma.user.count({ where: { username: { startsWith: МЕТКА } } });
  console.log(JSON.stringify({ убрано: ids.length, осталось }));
}

const что = process.argv[2];
if (что === "create") await создать();
else if (что === "clean") await убрать();
else {
  console.log("Как звать: sfu-fixture.ts create | clean");
  process.exitCode = 1;
}

await prisma.$disconnect();
