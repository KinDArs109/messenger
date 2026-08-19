import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import { io, type Socket } from "socket.io-client";
import { hashPassword } from "../src/lib/password.js";
import { signAccessToken } from "../src/lib/tokens.js";

/**
 * Нагрузочная проверка: сколько выдерживает эта машина.
 *
 * Меряет не «сколько сообщений в секунду выжмет сервер, если долбить
 * его в один поток» — такого не бывает. Меряет то, что бывает: сколько
 * человек могут одновременно сидеть в канале и переписываться, и через
 * сколько миллисекунд чужое сообщение доходит до остальных.
 *
 * Скорость одного человека ограничена самим сервером — пять сообщений
 * за пять секунд, — поэтому нагрузка растёт количеством людей, а не
 * частотой. Так же, как в жизни.
 *
 *   npm run stress -w @messenger/server
 *   npm run stress -w @messenger/server -- 10,25,50,100
 */

const URL = process.env.CHECK_URL ?? "http://127.0.0.1:3001";
const prisma = new PrismaClient();
const MARK = `stress${Date.now()}`;
const PASSWORD = `s-${randomUUID()}`;

/** Сколько человек проверяем на каждом шаге. */
const LEVELS = (process.argv[2] ?? "10,25,50,100").split(",").map(Number);
/** Сколько секунд длится обмен на каждом шаге. */
const SECONDS = 12;

interface Result {
  людей: number;
  подключилось: number;
  отправлено: number;
  доставлено: number;
  потеряно: number;
  задержкаМедиана: number;
  задержка95: number;
  задержкаМакс: number;
  ошибок: number;
}

const процентиль = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!);
};

async function makeUsers(count: number, passwordHash: string, prefix: string) {
  const data = Array.from({ length: count }, (_, i) => ({
    id: ulid(),
    email: `${prefix}-${i}@example.invalid`,
    username: `${prefix}${i}`,
    displayName: `Нагрузка ${i}`,
    passwordHash,
    emailVerifiedAt: new Date(),
  }));
  await prisma.user.createMany({ data });
  return data;
}

/** Токены выпускаем сами, тем же ключом, что и сервер.
 *
 *  Не потому, что так быстрее, а потому, что вход защищён от перебора
 *  паролей: десять попыток за пятнадцать минут с одного адреса.
 *  Двести входов подряд упираются в эту защиту, и проверка мерила бы
 *  её, а не машину. Само ограничение при этом трогать нельзя — оно
 *  здесь по делу. */
const token = (userId: string): Promise<string> => signAccessToken(userId);

function connect(token: string): Promise<Socket | null> {
  return new Promise((resolve) => {
    const socket = io(URL, { auth: { token }, transports: ["websocket"], reconnection: false });
    const timer = setTimeout(() => resolve(null), 15000);
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on("connect_error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function run(count: number, channelId: string, tokens: string[]): Promise<Result> {
  const sockets: Socket[] = [];
  const задержки: number[] = [];
  let доставлено = 0;
  let ошибок = 0;

  // Подключаемся пачками: тысяча одновременных рукопожатий — это
  // проверка на устойчивость к всплеску, а не на ёмкость.
  for (let i = 0; i < count; i += 10) {
    const пачка = await Promise.all(tokens.slice(i, i + 10).map(connect));
    for (const s of пачка) if (s) sockets.push(s);
  }

  for (const socket of sockets) {
    socket.emit("channel:subscribe", { channelId });
    socket.on("message:new", (message: { content: string }) => {
      const [, отправлено] = message.content.split("|");
      if (!отправлено) return;
      доставлено++;
      задержки.push(Date.now() - Number(отправлено));
    });
  }
  // Подписки доходят не мгновенно.
  await new Promise((r) => setTimeout(r, 800));

  // Каждый шлёт по сообщению в секунду — вдвое ниже потолка сервера,
  // чтобы упереться в машину, а не в ограничитель.
  const конец = Date.now() + SECONDS * 1000;
  let отправлено = 0;

  await Promise.all(
    tokens.slice(0, sockets.length).map(async (token, index) => {
      // Разводим по времени: одновременный залп меряет всплеск,
      // а не установившуюся нагрузку.
      await new Promise((r) => setTimeout(r, (index % 10) * 100));
      while (Date.now() < конец) {
        try {
          const res = await fetch(`${URL}/api/channels/${channelId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ content: `н|${Date.now()}` }),
          });
          if (res.ok) отправлено++;
          else if (res.status !== 429) ошибок++;
        } catch {
          ошибок++;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }),
  );

  // Хвост доставки.
  await new Promise((r) => setTimeout(r, 1500));
  for (const socket of sockets) socket.disconnect();

  // Каждое сообщение уходит всем, кроме автора.
  const ожидалось = отправлено * Math.max(0, sockets.length - 1);
  return {
    людей: count,
    подключилось: sockets.length,
    отправлено,
    доставлено,
    потеряно: Math.max(0, ожидалось - доставлено),
    задержкаМедиана: процентиль(задержки, 0.5),
    задержка95: процентиль(задержки, 0.95),
    задержкаМакс: задержки.length ? Math.round(Math.max(...задержки)) : 0,
    ошибок,
  };
}

async function cleanup(): Promise<void> {
  // Сообщения отдельной строкой не удаляем, хотя раньше удаляли:
  // условием было «начинается с н|», без привязки к своему каналу.
  // На пустой машине это работало, а на живой снесло бы настоящее
  // сообщение, которое случайно начинается так же. Свои уходят сами:
  // сервер тянет за собой каналы, канал — сообщения.
  await prisma.server.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: MARK } } });
}

async function main(): Promise<void> {
  console.log(`\nНагрузочная проверка — ${URL}`);
  console.log(`Шаги: ${LEVELS.join(", ")} человек, по ${SECONDS} с каждый\n`);

  const passwordHash = await hashPassword(PASSWORD);
  const max = Math.max(...LEVELS);
  const users = await makeUsers(max, passwordHash, MARK);

  const server = await prisma.server.create({
    data: {
      id: ulid(),
      name: `${MARK} сервер`,
      ownerId: users[0]!.id,
      members: { create: users.map((u) => ({ userId: u.id, role: "MEMBER" as const })) },
      channels: { create: [{ id: ulid(), type: "TEXT", name: "нагрузка", position: 0 }] },
    },
    include: { channels: true },
  });
  const channelId = server.channels[0]!.id;

  const tokens = await Promise.all(users.map((u) => token(u.id)));
  console.log(`  Готово: ${tokens.length} учётных записей, канал создан\n`);

  const результаты: Result[] = [];
  for (const level of LEVELS) {
    process.stdout.write(`  ${String(level).padStart(4)} человек… `);
    const r = await run(level, channelId, tokens.slice(0, level));
    результаты.push(r);
    console.log(
      `подключилось ${r.подключилось}, отправлено ${r.отправлено}, ` +
        `доставлено ${r.доставлено}, задержка ${r.задержкаМедиана}/${r.задержка95} мс, ` +
        `потерь ${r.потеряно}, ошибок ${r.ошибок}`,
    );
    // Даём серверу выдохнуть между шагами.
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log("\n  ── Итог ──");
  for (const r of результаты) {
    const доставка = r.потеряно === 0 ? "всё дошло" : `потеряно ${r.потеряно}`;
    console.log(
      `  ${String(r.людей).padStart(4)} чел: связей ${r.подключилось}/${r.людей}, ` +
        `${(r.доставлено / SECONDS).toFixed(0)} доставок/с, ` +
        `задержка ${r.задержкаМедиана} мс (95% до ${r.задержка95}), ${доставка}`,
    );
  }
  console.log();
}

void main()
  .catch((error) => console.error("\nПроверка не запустилась:", error instanceof Error ? error.message : error))
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
    console.log("  Убрано за собой\n");
  });
