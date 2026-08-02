import { ulid } from "ulid";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password.js";

const prisma = new PrismaClient();

const PASSWORD = "password123";

const PHRASES = [
  "привет, как оно",
  "я тут потестить зашёл",
  "работает вроде",
  "а голосовой когда будет",
  "смотри что нашёл",
  "ага, видел",
  "давай вечером созвон",
  "+",
  "лол",
  "погоди, сейчас проверю",
  "оно упало",
  "уже починил",
  "красиво получилось",
  "шрифт бы поменял",
  "не, нормально",
];

const SEED_USERNAMES = ["anna", "boris", "vera"];

async function main() {
  // Сиды стирают базу целиком. Пока в ней жили только тестовые Аня,
  // Борис и Вера, это было безобидно. Как только появилась настоящая
  // учётная запись, безобидность кончилась: одна команда — и человек
  // лишился аккаунта вместе со всей перепиской.
  const strangers = await prisma.user.findMany({
    where: { username: { notIn: SEED_USERNAMES } },
    select: { username: true },
  });

  if (strangers.length > 0 && !process.argv.includes("--force")) {
    console.error(`
  Остановился: в базе есть учётные записи, которых нет в сидах —
  ${strangers.map((u) => `@${u.username}`).join(", ")}

  Сиды стирают базу целиком, вместе с ними. Если это и нужно:
      npm run db:seed -- --force
`);
    process.exitCode = 1;
    return;
  }

  console.log("  Очищаю базу...");
  // Порядок важен: сначала то, что ссылается, потом то, на что ссылаются.
  await prisma.message.deleteMany();
  await prisma.channelParticipant.deleteMany();
  await prisma.channel.deleteMany();
  await prisma.serverMember.deleteMany();
  await prisma.invite.deleteMany();
  await prisma.server.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();

  console.log("  Создаю пользователей...");
  const passwordHash = await hashPassword(PASSWORD);

  const [anna, boris, vera] = await Promise.all(
    [
      { username: "anna", displayName: "Аня" },
      { username: "boris", displayName: "Борис" },
      { username: "vera", displayName: "Вера" },
    ].map((u) =>
      prisma.user.create({
        data: {
          id: ulid(),
          email: `${u.username}@example.com`,
          username: u.username,
          displayName: u.displayName,
          passwordHash,
        },
      }),
    ),
  );

  if (!anna || !boris || !vera) throw new Error("Не удалось создать пользователей");

  console.log("  Создаю сервер и каналы...");
  const server = await prisma.server.create({
    data: {
      id: ulid(),
      name: "Тестовый сервер",
      ownerId: anna.id,
      members: {
        create: [
          { userId: anna.id, role: "OWNER" },
          { userId: boris.id, role: "ADMIN" },
          { userId: vera.id, role: "MEMBER" },
        ],
      },
      channels: {
        create: [
          { id: ulid(), type: "TEXT", name: "общий", position: 0 },
          { id: ulid(), type: "TEXT", name: "флуд", position: 1 },
          { id: ulid(), type: "VOICE", name: "Разговор", position: 2 },
        ],
      },
    },
    include: { channels: true },
  });

  const general = server.channels.find((c) => c.name === "общий");
  if (!general) throw new Error("Канал не создан");

  console.log("  Пишу 200 сообщений...");
  const authors = [anna, boris, vera];
  // Раскладываем сообщения по последним трём часам, по одному
  // примерно раз в минуту. ULID генерируем от той же метки времени,
  // чтобы сортировка по id совпадала с сортировкой по дате —
  // на этом держится вся курсорная пагинация.
  const startedAt = Date.now() - 200 * 60_000;

  await prisma.message.createMany({
    data: Array.from({ length: 200 }, (_, i) => {
      const at = startedAt + i * 60_000;
      const author = authors[i % authors.length]!;
      const phrase = PHRASES[i % PHRASES.length]!;
      return {
        id: ulid(at),
        channelId: general.id,
        authorId: author.id,
        content: `${phrase} (${i + 1})`,
        createdAt: new Date(at),
      };
    }),
  });

  console.log(`
  Готово.

  Вход для проверки:
    anna@example.com  / ${PASSWORD}
    boris@example.com / ${PASSWORD}
    vera@example.com  / ${PASSWORD}
`);
}

main()
  .catch((error: unknown) => {
    console.error("  Сиды не проставились:", error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
