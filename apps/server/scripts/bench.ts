import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import { hashPassword } from "../src/lib/password.js";
import { signAccessToken } from "../src/lib/tokens.js";

/**
 * Сколько запросов машина держит одновременно.
 *
 * Отличается от нагрузочной проверки (stress.ts) тем, что меряет:
 * там — сколько человек могут переписываться, здесь — сколько
 * обращений к серверу проходит в секунду и как быстро они отвечают,
 * когда их запускают пачками разной величины.
 *
 * Запросы двух видов, потому что стоят они разного:
 *   — «кто я» — проверка входа плюс одна строка из базы, самое дешёвое,
 *     что вообще бывает; так меряется потолок самой машины;
 *   — «история канала» — настоящий запрос с выборкой полусотни
 *     сообщений, вложений и авторов; так меряется то, что происходит
 *     каждый раз, когда человек открывает канал.
 *
 * Людей заводим много и токены подписываем сами: у каждого свой счётчик
 * ограничителя (триста запросов в минуту), и с малым числом людей
 * проверка мерила бы ограничитель, а не сервер. Сколько запросов он
 * всё же отбил, считается отдельно — если это число не ноль, замер
 * занижен и людей надо больше.
 *
 *   npm run bench -w @messenger/server
 *   npm run bench -w @messenger/server -- 1,10,50,100,200
 */

const URL = process.env.CHECK_URL ?? "http://127.0.0.1:3001";
const prisma = new PrismaClient();
const MARK = `bench${Date.now()}`;
const PASSWORD = `b-${randomUUID()}`;

/** Сколько запросов держим в воздухе одновременно. */
const LEVELS = (process.argv[2] ?? "1,10,25,50,100").split(",").map(Number);
/** Сколько секунд длится каждый замер. */
const SECONDS = 8;
/** Учётных записей. С запасом: на каждую свой счётчик ограничителя. */
const USERS = 200;

interface Case {
  название: string;
  путь: (channelId: string) => string;
}

const СЛУЧАИ: Case[] = [
  { название: "«кто я»", путь: () => "/api/auth/me" },
  {
    название: "история канала",
    путь: (channelId) => `/api/channels/${channelId}/messages?limit=50`,
  },
];

const процентиль = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!);
};

interface Result {
  одновременно: number;
  успешно: number;
  отбито: number;
  ошибок: number;
  вСекунду: number;
  медиана: number;
  девяносто5: number;
}

/**
 * Один замер: держим ровно `одновременно` запросов в воздухе.
 *
 * Не «выпустить залп и посмотреть»: залп меряет всплеск. Каждый
 * работник шлёт следующий запрос сразу после ответа на предыдущий,
 * поэтому в любой момент времени в работе ровно столько запросов,
 * сколько мы задали, — это и есть одновременность.
 */
async function замер(одновременно: number, путь: string, tokens: string[]): Promise<Result> {
  const задержки: number[] = [];
  let успешно = 0;
  let отбито = 0;
  let ошибок = 0;

  const конец = Date.now() + SECONDS * 1000;
  let следующий = 0;

  const работник = async (): Promise<void> => {
    while (Date.now() < конец) {
      // Каждый запрос от нового человека: иначе упрёмся в его личный
      // счётчик ограничителя, а не в машину.
      const token = tokens[следующий++ % tokens.length]!;
      const начало = Date.now();
      try {
        const res = await fetch(`${URL}${путь}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        // Тело читаем до конца: без этого замер закончился бы раньше
        // самой работы, а соединение осталось бы висеть.
        await res.arrayBuffer();
        if (res.ok) {
          успешно++;
          задержки.push(Date.now() - начало);
        } else if (res.status === 429) отбито++;
        else ошибок++;
      } catch {
        ошибок++;
      }
    }
  };

  await Promise.all(Array.from({ length: одновременно }, работник));

  return {
    одновременно,
    успешно,
    отбито,
    ошибок,
    вСекунду: Math.round(успешно / SECONDS),
    медиана: процентиль(задержки, 0.5),
    девяносто5: процентиль(задержки, 0.95),
  };
}

async function main(): Promise<void> {
  console.log(`\nСколько запросов держит машина — ${URL}`);
  console.log(`Ступени: ${LEVELS.join(", ")} одновременных, по ${SECONDS} с каждая\n`);

  const passwordHash = await hashPassword(PASSWORD);
  const users = Array.from({ length: USERS }, (_, i) => ({
    id: ulid(),
    email: `${MARK}-${i}@example.invalid`,
    username: `${MARK}${i}`,
    displayName: `Замер ${i}`,
    passwordHash,
    emailVerifiedAt: new Date(),
  }));
  await prisma.user.createMany({ data: users });

  const server = await prisma.server.create({
    data: {
      id: ulid(),
      name: `${MARK} сервер`,
      ownerId: users[0]!.id,
      members: { create: users.map((u) => ({ userId: u.id, role: "MEMBER" as const })) },
      channels: { create: [{ id: ulid(), type: "TEXT", name: "замер", position: 0 }] },
    },
    include: { channels: true },
  });
  const channelId = server.channels[0]!.id;

  // Историю надо из чего-то читать: пустой канал отвечал бы мгновенно
  // и мерил бы не то.
  await prisma.message.createMany({
    data: Array.from({ length: 200 }, (_, i) => ({
      id: ulid(),
      channelId,
      authorId: users[i % users.length]!.id,
      content: `замер ${i}: строка обычной длины, как в живой переписке`,
    })),
  });

  const tokens = await Promise.all(users.map((u) => signAccessToken(u.id)));
  console.log(`  Готово: ${tokens.length} учётных записей, 200 сообщений в канале\n`);

  for (const случай of СЛУЧАИ) {
    console.log(`  ── ${случай.название} ──`);
    for (const level of LEVELS) {
      const r = await замер(level, случай.путь(channelId), tokens);
      console.log(
        `  ${String(r.одновременно).padStart(4)} одновременно: ` +
          `${String(r.вСекунду).padStart(5)} запросов/с, ` +
          `ответ ${r.медиана} мс (95% до ${r.девяносто5}), ` +
          `отбито ${r.отбито}, ошибок ${r.ошибок}`,
      );
      // Даём ограничителю и машине выдохнуть между ступенями.
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log();
  }
}

void main()
  .catch((error) =>
    console.error("\nЗамер не запустился:", error instanceof Error ? error.message : error),
  )
  .finally(async () => {
    // Сервер тянет за собой каналы, канал — сообщения.
    await prisma.server.deleteMany({ where: { name: { startsWith: MARK } } }).catch(() => undefined);
    await prisma.user
      .deleteMany({ where: { username: { startsWith: MARK } } })
      .catch(() => undefined);
    await prisma.$disconnect();
    console.log("  Убрано за собой\n");
  });
