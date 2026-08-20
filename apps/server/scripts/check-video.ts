import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import { io, type Socket } from "socket.io-client";
import { hashPassword } from "../src/lib/password.js";
import { войти } from "./login.js";

/**
 * Проверка камеры — служебной её части.
 *
 * Само изображение через сервер не идёт, проверять здесь нечего.
 * А вот объявление «камера включена, поток называется так-то» идёт
 * именно через него, и без него принимающая сторона не поймёт, что
 * за видео ей пришло.
 *
 * Главное здесь — четвёртая проверка. Камера и экран живут в одном
 * участнике, и заманчиво было хранить их одним полем: показывает или
 * нет. Тогда включение камеры стирало бы идущий показ экрана, а его
 * прекращение выключало бы камеру. Со стороны это выглядело бы как
 * «иногда само пропадает», и искали бы это в WebRTC, где ошибки нет.
 *
 * Требует запущенного сервера. Свои учётные записи заводит сам
 * и убирает за собой.
 *
 *   npm run check:video -w @messenger/server
 *   CHECK_URL=http://127.0.0.1:3002 npm run check:video -w @messenger/server
 */

const URL = process.env.CHECK_URL ?? "http://127.0.0.1:3001";
const prisma = new PrismaClient();
const PASSWORD = `check-${randomUUID()}`;
const MARK = `videocheck-${Date.now()}`;

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

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { auth: { token }, transports: ["websocket"], reconnection: false });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (error) => reject(error));
  });
}

// Вход в два шага; код из письма подкладывает общий помощник.
const login = (who: string): Promise<string> => войти(URL, prisma, who, PASSWORD);

async function main(): Promise<void> {
  console.log(`\nПроверка камеры — ${URL}\n`);

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

    await a.emitWithAck("voice:join", { channelId });
    await b.emitWithAck("voice:join", { channelId });
    ok("оба вошли в голосовой канал");

    // 1. Объявление доходит до тех, кто уже внутри.
    const heard = waitFor<{ userId: string; videoId: string | null }>(b, "voice:video");
    const videoId = "camera-" + randomUUID();
    a.emit("voice:video", { videoId });

    const got = await heard;
    if (!got) fail("объявление о камере не дошло до собеседника");
    else if (got.userId !== one.id) fail(`объявление пришло не от того: ${got.userId}`);
    else if (got.videoId !== videoId) fail(`имя потока исказилось: ${got.videoId}`);
    else ok("объявление о камере дошло до тех, кто уже в канале");

    // 2. Камера и экран не мешают друг другу.
    const screenId = "screen-" + randomUUID();
    const screenHeard = waitFor<{ screenId: string | null }>(b, "voice:screen");
    a.emit("voice:screen", { screenId });
    const screenGot = await screenHeard;
    if (screenGot?.screenId !== screenId) fail("объявление об экране не дошло");
    else ok("экран объявлен поверх включённой камеры");

    // 3. Вошедший позже узнаёт про оба потока сразу.
    const peers = waitFor<{
      peers: { userId: string; screenId?: string | null; videoId?: string | null }[];
    }>(c, "voice:peers");
    await c.emitWithAck("voice:join", { channelId });
    const list = await peers;

    const sharer = list?.peers.find((p) => p.userId === one.id);
    if (!list) fail("состав канала не пришёл вовсе");
    else if (!sharer) fail("показывающего нет в составе канала");
    else if (sharer.videoId !== videoId) {
      fail(`вошедший позже не узнал о камере: ${JSON.stringify(sharer.videoId)}`);
    } else if (sharer.screenId !== screenId) {
      fail(`вошедший позже не узнал об экране: ${JSON.stringify(sharer.screenId)}`);
    } else ok("вошедший позже сразу видит и камеру, и экран");

    // 4. Главное: выключение одного не трогает другое.
    const off = waitFor<{ screenId: string | null }>(b, "voice:screen");
    a.emit("voice:screen", { screenId: null });
    if ((await off)?.screenId !== null) fail("экран не снялся");

    // Слушаем на c, а не на b: состав канала сервер шлёт только тому,
    // кто входит, остальным идёт короткое «такой-то вошёл».
    const after = waitFor<{
      peers: { userId: string; screenId?: string | null; videoId?: string | null }[];
    }>(c, "voice:peers");
    // Состав перезапрашиваем чужим входом-выходом: отдельной команды
    // «покажи состав» в протоколе нет, и выдумывать её ради проверки
    // значило бы проверять не то, что работает у людей.
    // voice:leave подтверждения не присылает — ждать его нечего,
    // а emitWithAck на нём висит вечно. Даём событию дойти паузой.
    c.emit("voice:leave");
    await pause(150);
    await c.emitWithAck("voice:join", { channelId });
    const still = (await after)?.peers.find((p) => p.userId === one.id);

    if (!still) fail("участник пропал из состава");
    else if (still.screenId !== null) fail(`экран остался включённым: ${still.screenId}`);
    else if (still.videoId !== videoId) {
      fail(`камеру погасило вместе с экраном: ${JSON.stringify(still.videoId)}`);
    } else ok("выключение экрана не задело камеру");

    // 5. Обратная сторона того же: выключение камеры не трогает экран.
    a.emit("voice:screen", { screenId });
    a.emit("voice:video", { videoId: null });
    const back = waitFor<{
      peers: { userId: string; screenId?: string | null; videoId?: string | null }[];
    }>(c, "voice:peers");
    // voice:leave подтверждения не присылает — ждать его нечего,
    // а emitWithAck на нём висит вечно. Даём событию дойти паузой.
    c.emit("voice:leave");
    await pause(150);
    await c.emitWithAck("voice:join", { channelId });
    const last = (await back)?.peers.find((p) => p.userId === one.id);

    if (!last) fail("участник пропал из состава");
    else if (last.videoId !== null) fail(`камера осталась включённой: ${last.videoId}`);
    else if (last.screenId !== screenId) {
      fail(`экран погасило вместе с камерой: ${JSON.stringify(last.screenId)}`);
    } else ok("выключение камеры не задело экран");

    // 6. Чужие строки не проходят целиком: их разошлют всем в канале.
    const long = waitFor<{ videoId: string | null }>(b, "voice:video");
    a.emit("voice:video", { videoId: "x".repeat(500) });
    const trimmed = await long;
    if (!trimmed?.videoId) fail("длинное имя потока потерялось совсем");
    else if (trimmed.videoId.length > 64) fail(`имя потока не обрезано: ${trimmed.videoId.length}`);
    else ok("слишком длинное имя потока обрезается");
  } finally {
    for (const socket of sockets) socket.disconnect();
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
