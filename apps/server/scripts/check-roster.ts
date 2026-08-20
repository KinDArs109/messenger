import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import { io, type Socket } from "socket.io-client";
import { hashPassword } from "../src/lib/password.js";
import { войти } from "./login.js";

/**
 * Проверка: видно ли, что в голосовом канале кто-то сидит, если сам
 * туда не заходил.
 *
 * На это жаловались вживую: «пока не зайдёшь в войс, не отображается,
 * что там кто-то есть». Причина была в том, что состав канала сервер
 * слал одному лишь входящему, а остальным — только событие о чужом
 * входе в момент, когда оно происходит. Кто открыл приложение позже,
 * видел пустой канал.
 *
 * Здесь проверяется именно поздний подключившийся: он не заходит
 * в канал вовсе и обязан узнать состав сам.
 *
 *   npm run check:roster -w @messenger/server
 */

const URL = process.env.CHECK_URL ?? "http://127.0.0.1:3001";
const prisma = new PrismaClient();
const PASSWORD = `check-${randomUUID()}`;
const MARK = `roster-${Date.now()}`;

let failed = false;
const ok = (s: string) => console.log(`  ✔ ${s}`);
const fail = (s: string) => {
  console.log(`  ✘ ПРОВАЛ: ${s}`);
  failed = true;
};

function waitFor<T>(socket: Socket, event: string, ms = 6000): Promise<T | null> {
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

// Вход теперь в два шага — код из письма кладёт себе в ящик
// общий помощник, у него есть база.
const login = (who: string): Promise<string> => войти(URL, prisma, who, PASSWORD);

async function main(): Promise<void> {
  console.log(`\nПроверка состава голосового канала — ${URL}\n`);

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

  const [one, two] = await Promise.all([make(1), make(2)]);

  const server = await prisma.server.create({
    data: {
      id: ulid(),
      name: MARK,
      ownerId: one.id,
      members: {
        create: [
          { userId: one.id, role: "OWNER" },
          { userId: two.id, role: "MEMBER" },
        ],
      },
      channels: { create: [{ id: ulid(), type: "VOICE", name: "проверка", position: 0 }] },
    },
    include: { channels: true },
  });

  const channelId = server.channels[0]!.id;
  const sockets: Socket[] = [];

  try {
    // Первый заходит в голосовой канал и остаётся там.
    const first = await connect(await login(one.email));
    sockets.push(first);
    const вошёл = await first.emitWithAck("voice:join", { channelId });
    if (!вошёл) throw new Error("первый не смог войти в канал");
    ok("первый сидит в голосовом канале");

    // Второй подключается ПОСЛЕ и в канал не заходит вовсе.
    const token = await login(two.email);
    const second = io(URL, { auth: { token }, transports: ["websocket"], reconnection: false });
    sockets.push(second);
    const снимок = waitFor<{ channelId: string; peers: { userId: string }[] }>(
      second,
      "voice:peers",
    );
    await new Promise<void>((готово) => second.on("connect", () => готово()));

    const состав = await снимок;
    if (!состав) {
      fail("состав канала не пришёл — сидящих не видно, пока сам не зайдёшь");
    } else if (состав.channelId !== channelId) {
      fail(`состав пришёл не по тому каналу: ${состав.channelId}`);
    } else if (!состав.peers.some((p) => p.userId === one.id)) {
      fail("в составе нет того, кто там сидит");
    } else {
      ok("подключившийся позже сразу видит, кто сидит в канале");
    }

    /* Второе окно того же человека.
     *
     * Мессенджер открыт и приложением, и вкладкой браузера — это
     * обычное дело. Разговор идёт в одном из них, второе просто
     * висит. Закрыли лишнее — из разговора выйти не должно ничего:
     * соединений у человека два, а голосовой канал один. */
    const запасное = await connect(await login(one.email));
    await new Promise((готово) => setTimeout(готово, 300));

    const выход = waitFor<{ channelId: string; userId: string }>(second, "voice:left", 2500);
    запасное.disconnect();

    const ушёл = await выход;
    if (ушёл && ушёл.userId === one.id) {
      fail("закрытие второго окна выкинуло человека из разговора");
    } else {
      ok("закрытие второго окна не трогает разговор в первом");
    }

    /* Возврат в тот же канал.
     *
     * Так делает сам мессенджер после каждого обрыва связи — а обрыв
     * случается при любом перезапуске сервера. Человек при этом никуда
     * не выходил и по-прежнему сидит в разговоре.
     *
     * Ловим то, на что жаловались: «я в разговоре, а в канале никого».
     * Причина была в порядке сообщений — «вышел» уходил отложенно
     * и обгонял состав канала, отправленный при входе. Здесь проверяем
     * оба конца: и что состав правильный, и что после него не прилетает
     * «вышел» про самого вошедшего.
     */
    const снова = await connect(await login(one.email));
    sockets.push(снова);

    const составСнова = waitFor<{ channelId: string; peers: { userId: string }[] }>(
      снова,
      "voice:peers",
      4000,
    );
    const вошёлСнова = await снова.emitWithAck("voice:join", { channelId });
    if (!вошёлСнова) fail("повторный вход в тот же канал не удался");

    const состав2 = await составСнова;
    if (!состав2?.peers.some((p) => p.userId === one.id)) {
      fail("после возврата человека нет в составе собственного канала");
    } else {
      ok("после возврата человек видит себя в канале");
    }

    // Самое главное: «вышел» про себя после входа приходить не должен.
    const ложныйВыход = await waitFor<{ channelId: string; userId: string }>(
      снова,
      "voice:left",
      1500,
    );
    if (ложныйВыход?.userId === one.id && ложныйВыход.channelId === channelId) {
      fail("сразу после входа пришло «вышел» про самого себя — состав обнулится");
    } else {
      ok("после входа ложного «вышел» не приходит");
    }

    // И обратное: пустые каналы не должны присылать ничего.
    снова.emit("voice:leave");
    await new Promise((готово) => setTimeout(готово, 200));
    first.emit("voice:leave");
    await new Promise((готово) => setTimeout(готово, 300));

    const third = io(URL, {
      auth: { token: await login(two.email) },
      transports: ["websocket"],
      reconnection: false,
    });
    sockets.push(third);
    const лишнее = waitFor<{ channelId: string }>(third, "voice:peers", 2500);
    await new Promise<void>((готово) => third.on("connect", () => готово()));

    if (await лишнее) fail("по пустому каналу пришёл состав — лишний шум");
    else ok("по пустым каналам ничего не присылается");
  } finally {
    for (const socket of sockets) socket.disconnect();
    await prisma.server.deleteMany({ where: { name: MARK } });
    await prisma.user.deleteMany({ where: { username: { startsWith: MARK } } });
    await prisma.$disconnect();
  }

  console.log(failed ? "\nЕсть провалы\n" : "\nВсё сходится\n");
  process.exitCode = failed ? 1 : 0;
}

void main().catch(async (error: unknown) => {
  console.error("\nПроверка не запустилась:", error instanceof Error ? error.message : error);
  await prisma.server.deleteMany({ where: { name: MARK } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { username: { startsWith: MARK } } }).catch(() => undefined);
  await prisma.$disconnect();
  process.exitCode = 1;
});
