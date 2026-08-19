import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import { io, type Socket } from "socket.io-client";
import { hashPassword } from "../src/lib/password.js";

/**
 * Проверка показа экрана — служебной его части.
 *
 * Само изображение через сервер не идёт, проверять здесь нечего.
 * А вот объявление «я показываю, поток называется так-то» идёт именно
 * через него, и без него принимающая сторона не поймёт, что за видео
 * ей пришло: дорожки одного потока приходят порознь, и отличить экран
 * от микрофона по наличию картинки нельзя.
 *
 * Проверяются три вещи, каждая из которых уже ломалась в похожем виде
 * у голосовых событий:
 *   1. объявление доходит до тех, кто уже в канале;
 *   2. вошедший позже узнаёт о показе из состава, а не ждёт, пока
 *      показывающий выключит и включит;
 *   3. прекращение показа доходит тоже.
 *
 * Требует запущенного сервера. Свои учётные записи заводит сам
 * и убирает за собой.
 */

const URL = process.env.CHECK_URL ?? "http://127.0.0.1:3001";
const prisma = new PrismaClient();
const PASSWORD = `check-${randomUUID()}`;
const MARK = `screencheck-${Date.now()}`;

let failed = false;
const ok = (s: string) => console.log(`  ✔ ${s}`);
const fail = (s: string) => {
  console.log(`  ✘ ПРОВАЛ: ${s}`);
  failed = true;
};

/** Ждём событие с потолком по времени: молча висящая проверка
 *  бесполезнее упавшей. */
function waitFor<T>(socket: Socket, event: string, ms = 5000): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, ms);
    const handler = (data: T) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    };
    socket.on(event, handler);
  });
}

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { auth: { token }, transports: ["websocket"], reconnection: false });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (error) => reject(error));
  });
}

async function login(who: string): Promise<string> {
  // Поле называется login, а не email: входить можно и по имени
  // пользователя, и сервер различает их по наличию собаки.
  const res = await fetch(`${URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: who, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Вход как ${who}: HTTP ${res.status} ${await res.text()}`);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function main(): Promise<void> {
  console.log(`\nПроверка показа экрана — ${URL}\n`);

  const passwordHash = await hashPassword(PASSWORD);
  const make = (n: number) =>
    prisma.user.create({
      data: {
        id: ulid(),
        email: `${MARK}-${n}@example.invalid`,
        username: `${MARK}-${n}`,
        displayName: `Проверка ${n}`,
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });

  const [one, two, three] = await Promise.all([make(1), make(2), make(3)]);

  const server = await prisma.server.create({
    data: {
      id: ulid(),
      name: MARK,
      ownerId: one.id,
      members: {
        create: [
          { userId: one.id, role: "OWNER" },
          { userId: two.id, role: "MEMBER" },
          { userId: three.id, role: "MEMBER" },
        ],
      },
      channels: { create: [{ id: ulid(), type: "VOICE", name: "проверка", position: 0 }] },
    },
    include: { channels: true },
  });

  const channelId = server.channels[0]!.id;
  const sockets: Socket[] = [];

  try {
    const [a, b, c] = await Promise.all([
      connect(await login(one.email)),
      connect(await login(two.email)),
      connect(await login(three.email)),
    ]);
    sockets.push(a, b, c);

    // Двое заходят в канал.
    await a.emitWithAck("voice:join", { channelId });
    await b.emitWithAck("voice:join", { channelId });
    ok("оба вошли в голосовой канал");

    // 1. Объявление доходит до тех, кто уже внутри.
    const heard = waitFor<{ userId: string; screenId: string | null }>(b, "voice:screen");
    const screenId = "stream-" + randomUUID();
    a.emit("voice:screen", { screenId });

    const got = await heard;
    if (!got) fail("объявление о показе не дошло до собеседника");
    else if (got.userId !== one.id) fail(`объявление пришло не от того: ${got.userId}`);
    else if (got.screenId !== screenId) fail(`имя потока исказилось: ${got.screenId}`);
    else ok("объявление о показе дошло до тех, кто уже в канале");

    // 2. Вошедший позже узнаёт о показе из состава канала.
    const peers = waitFor<{ peers: { userId: string; screenId?: string | null }[] }>(
      c,
      "voice:peers",
    );
    await c.emitWithAck("voice:join", { channelId });
    const list = await peers;

    const sharer = list?.peers.find((p) => p.userId === one.id);
    if (!list) fail("состав канала не пришёл вовсе");
    else if (!sharer) fail("показывающего нет в составе канала");
    else if (sharer.screenId !== screenId) {
      fail(`вошедший позже не узнал о показе: ${JSON.stringify(sharer.screenId)}`);
    } else ok("вошедший позже сразу видит, что показ уже идёт");

    // 3. Прекращение показа.
    const stopped = waitFor<{ userId: string; screenId: string | null }>(b, "voice:screen");
    a.emit("voice:screen", { screenId: null });
    const end = await stopped;

    if (!end) fail("о прекращении показа никто не узнал");
    else if (end.screenId !== null) fail(`показ не снялся: ${end.screenId}`);
    else ok("прекращение показа дошло до собеседников");

    // 4. Чужие строки не проходят целиком: их разошлют всем в канале.
    const long = waitFor<{ screenId: string | null }>(b, "voice:screen");
    a.emit("voice:screen", { screenId: "x".repeat(500) });
    const trimmed = await long;
    if (!trimmed?.screenId) fail("длинное имя потока потерялось совсем");
    else if (trimmed.screenId.length > 64) fail(`имя потока не обрезано: ${trimmed.screenId.length}`);
    else ok("слишком длинное имя потока обрезается");
  } finally {
    for (const socket of sockets) socket.disconnect();
    // Сервер уходит каскадом вместе с каналами и участием.
    await prisma.server.deleteMany({ where: { name: MARK } });
    await prisma.user.deleteMany({ where: { username: { startsWith: MARK } } });
    await prisma.$disconnect();
  }

  console.log(failed ? "\nЕсть провалы\n" : "\nВсё сходится\n");
  process.exitCode = failed ? 1 : 0;
}

void main().catch(async (error) => {
  console.error("\nПроверка не запустилась:", error instanceof Error ? error.message : error);
  await prisma.server.deleteMany({ where: { name: MARK } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { username: { startsWith: MARK } } }).catch(() => undefined);
  await prisma.$disconnect();
  process.exitCode = 1;
});
