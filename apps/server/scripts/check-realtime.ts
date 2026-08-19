import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import { hashPassword } from "../src/lib/password.js";

/**
 * Проверка сокетного слоя: вход, подписки, «печатает», доставка
 * сообщений и статусы «в сети».
 *
 *   npm run check:realtime -w @messenger/server
 *
 * Раньше проверка ходила под учётные записи из примеров (Аня, Борис,
 * Вера) с общеизвестным паролем. Держать такие на боевой машине нельзя,
 * их убрали — и проверка перестала запускаться вовсе. Теперь она
 * заводит своих на время прогона и уносит их за собой; заодно
 * и сообщения летят в её собственный канал, а не в живую переписку.
 */

const URL = process.env.CHECK_URL ?? "http://127.0.0.1:3001";
const prisma = new PrismaClient();
const PASSWORD = `check-${randomUUID()}`;
const MARK = `rt-${Date.now()}`;

const ok = (s: string) => console.log(`  ✔ ${s}`);
const fail = (s: string) => {
  console.log(`  ✘ ПРОВАЛ: ${s}`);
  process.exitCode = 1;
};

async function login(who: string): Promise<string> {
  const res = await fetch(`${URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: who, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Не удалось войти как ${who}: HTTP ${res.status}`);
  const data = (await res.json()) as { accessToken: string };
  return data.accessToken;
}

function tryConnect(token?: string): Promise<{ connected: boolean; error?: string }> {
  return new Promise((resolve) => {
    const socket = io(URL, {
      auth: token ? { token } : {},
      transports: ["websocket"],
      reconnection: false,
    });
    const done = (r: { connected: boolean; error?: string }) => {
      socket.disconnect();
      resolve(r);
    };
    socket.on("connect", () => done({ connected: true }));
    socket.on("connect_error", (e) => done({ connected: false, error: e.message }));
    setTimeout(() => done({ connected: false, error: "таймаут" }), 8000);
  });
}

/**
 * Подключение, которое с первой секунды записывает всё, что ему
 * сказали про чужие статусы.
 *
 * Обработчик вешаем до того, как соединение установилось: сервер
 * рассылает «в сети» сразу после входа в комнаты, и подписка после
 * connect успевает опоздать. Ждать потом — уже по накопленному
 * списку, а не по новому событию, которого может и не быть.
 */
interface Watched {
  socket: Socket;
  presence: { userId: string; status: string }[];
}

function connect(token: string): Promise<Watched> {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { auth: { token }, transports: ["websocket"], reconnection: false });
    const presence: { userId: string; status: string }[] = [];
    socket.on("presence:update", (event: { userId: string; status: string }) => {
      presence.push(event);
    });
    socket.on("connect", () => resolve({ socket, presence }));
    socket.on("connect_error", reject);
  });
}

async function sawPresence(
  who: Watched,
  userId: string,
  status: string,
  timeoutMs = 8000,
): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (who.presence.some((e) => e.userId === userId && e.status === status)) return true;
    await wait(200);
  }
  return false;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Опрашиваем базу вместо фиксированной паузы: статус пишется не
 *  мгновенно, а угадывать длительность бессмысленно. */
async function waitForStatus(username: string, expected: string, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const user = await prisma.user.findFirstOrThrow({ where: { username } });
    if (user.status === expected) return true;
    await wait(300);
  }
  return false;
}

/** Пятерых заводим на время прогона.
 *
 *  Третий нужен отдельно от первых двух: на нём проверяются статусы,
 *  а первые двое к этому моменту уже держат по открытому сокету
 *  и «не в сети» не станут.
 *
 *  Четвёртый и пятый — про рассылку статусов тем, с кем нет общего
 *  сервера: четвёртый в друзьях у первого, пятый только переписывается
 *  с ним. Оба пути отдельные, и оба надо пройти. */
async function makeUsers() {
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
  return Promise.all([make(1), make(2), make(3), make(4), make(5)]);
}

/** Личные переписки не принадлежат серверу, и удаление сервера
 *  их не уносит. Запоминаем, что завели. */
const madeChannels: string[] = [];

async function cleanup() {
  await prisma.channel
    .deleteMany({ where: { id: { in: madeChannels } } })
    .catch(() => undefined);
  await prisma.server.deleteMany({ where: { name: { startsWith: MARK } } }).catch(() => undefined);
  await prisma.user
    .deleteMany({ where: { username: { startsWith: MARK } } })
    .catch(() => undefined);
}

async function main() {
  console.log(`\nПроверка сокетного слоя — ${URL}\n`);

  console.log("=== 1. Подключение без токена ===");
  const anon = await tryConnect();
  anon.connected ? fail("аноним подключился") : ok(`отклонено: ${anon.error}`);

  console.log("\n=== 2. Подключение с поддельным токеном ===");
  const forged = await tryConnect("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYWNrZXIifQ.BAD");
  forged.connected ? fail("поддельный токен принят") : ok(`отклонено: ${forged.error}`);

  const [one, two, three, four, five] = await makeUsers();

  // Четвёртый — друг первого, но не участник его сервера.
  await prisma.friendship.create({
    data: {
      id: ulid(),
      requesterId: one.id,
      addresseeId: four.id,
      status: "ACCEPTED",
      acceptedAt: new Date(),
    },
  });

  // Пятый — только переписка, ни сервера, ни дружбы.
  const talk = await prisma.channel.create({
    data: {
      id: ulid(),
      type: "DM",
      participants: { create: [{ userId: one.id }, { userId: five.id }] },
    },
  });
  madeChannels.push(talk.id);

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
      channels: { create: [{ id: ulid(), type: "TEXT", name: "проверка", position: 0 }] },
    },
    include: { channels: true },
  });
  const channel = server.channels[0]!;

  const oneToken = await login(one.email);
  const twoToken = await login(two.email);
  const threeToken = await login(three.email);

  console.log("\n=== 3. Подключение с настоящим токеном ===");
  const real = await tryConnect(threeToken);
  real.connected ? ok("подключение установлено") : fail(`не подключился: ${real.error}`);

  console.log("\n=== 4. Статус «в сети» при подключении ===");
  const third = await connect(threeToken);
  (await waitForStatus(three.username, "online"))
    ? ok("статус online")
    : fail("статус так и не стал online");

  console.log("\n=== 5. Доступ к своему и несуществующему каналу ===");
  const first = await connect(oneToken);
  const second = await connect(twoToken);

  const firstSub = await first.socket.emitWithAck("channel:subscribe", { channelId: channel.id });
  const secondSub = await second.socket.emitWithAck("channel:subscribe", { channelId: channel.id });
  const bogusSub = await first.socket.emitWithAck("channel:subscribe", {
    channelId: "01ZZZZZZZZZZZZZZZZZZZZZZZZ",
  });
  firstSub ? ok("участник подписался на свой канал") : fail("участника не пустили в свой канал");
  secondSub ? ok("второй подписался на свой канал") : fail("второго не пустили в свой канал");
  bogusSub ? fail("пустили в несуществующий канал") : ok("несуществующий канал отклонён");

  console.log("\n=== 6. Событие «печатает» доходит до другого участника ===");
  const typing = await new Promise<{ channelId: string; userId: string } | null>((resolve) => {
    second.socket.on("typing", resolve);
    first.socket.emit("typing:start", { channelId: channel.id });
    setTimeout(() => resolve(null), 5000);
  });
  if (!typing) fail("второй не получил событие");
  else if (typing.userId !== one.id) fail(`пришёл чужой userId: ${typing.userId}`);
  else if (typing.channelId !== channel.id) fail(`пришёл чужой канал: ${typing.channelId}`);
  else ok("«печатает» дошло, канал и автор совпадают");

  console.log("\n=== 7. Отправитель не получает своё же «печатает» ===");
  const echo = await new Promise<boolean>((resolve) => {
    first.socket.on("typing", () => resolve(true));
    first.socket.emit("typing:start", { channelId: channel.id });
    setTimeout(() => resolve(false), 3000);
  });
  echo ? fail("отправителю вернулось своё событие") : ok("эха нет");

  console.log("\n=== 8. Новое сообщение прилетает подписчику канала ===");
  const delivered = await new Promise<{ id: string; content: string } | null>((resolve) => {
    second.socket.on("message:new", (m: { id: string; content: string; channelId: string }) => {
      if (m.channelId === channel.id) resolve(m);
    });
    void fetch(`${URL}/api/channels/${channel.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${oneToken}` },
      body: JSON.stringify({ content: "проверка доставки" }),
    });
    setTimeout(() => resolve(null), 8000);
  });
  delivered
    ? ok(`сообщение дошло через сокет: «${delivered.content}»`)
    : fail("сообщение не дошло через сокет");

  console.log("\n=== 9. Статус «не в сети» после отключения ===");
  third.socket.disconnect();
  (await waitForStatus(three.username, "offline"))
    ? ok("статус offline")
    : fail("статус не стал offline");

  // Ниже — не про запись статуса в базу, а про то, доходит ли он
  // до тех, кому нарисован кружок. Раньше рассылка шла только
  // в комнаты серверов, и человек не узнавал даже собственного
  // статуса, если ни в одном сервере не состоял.
  console.log("\n=== 10. Свой статус приходит себе ===");
  const fourth = await connect(await login(four.email));
  (await sawPresence(fourth, four.id, "online"))
    ? ok("сам себе «в сети»")
    : fail("свой статус до себя не дошёл");

  console.log("\n=== 11. Статус доходит до друга без общего сервера ===");
  (await sawPresence(first, four.id, "online"))
    ? ok("друг узнал про «в сети»")
    : fail("друг ничего не получил");

  console.log("\n=== 12. Статус доходит до собеседника по переписке ===");
  const fifth = await connect(await login(five.email));
  (await sawPresence(first, five.id, "online"))
    ? ok("собеседник узнал про «в сети»")
    : fail("собеседник ничего не получил");

  console.log("\n=== 13. Статус доходит до участника того же сервера ===");
  second.socket.disconnect();
  (await sawPresence(first, two.id, "offline"))
    ? ok("участник сервера узнал про «не в сети»")
    : fail("участник сервера ничего не получил");

  // ── Звонки ──────────────────────────────────────────────────
  //
  // Проверяем не звук — звук идёт мимо сервера, — а вызов: доходит ли
  // он до второго, и правильно ли кончается. Первый и пятый связаны
  // только перепиской, без сервера и дружбы: если звонок дойдёт
  // и так, дойдёт и в остальных случаях.

  console.log("\n=== 14. Звонок доходит до собеседника ===");
  const rings: { channelId: string; from: { id: string } }[] = [];
  fifth.socket.on("call:ring", (e: { channelId: string; from: { id: string } }) => rings.push(e));

  const states: { channelId: string; state: string }[] = [];
  first.socket.on("call:state", (e: { channelId: string; state: string }) => states.push(e));
  fifth.socket.on("call:state", (e: { channelId: string; state: string }) => states.push(e));

  const invited = await new Promise<boolean>((resolve) => {
    first.socket.emit("call:invite", { channelId: talk.id }, (accepted: boolean) =>
      resolve(accepted),
    );
    setTimeout(() => resolve(false), 5000);
  });
  invited ? ok("звонок принят сервером") : fail("сервер не дал позвонить");

  const rang = await until(() => rings.some((r) => r.channelId === talk.id && r.from.id === one.id));
  rang ? ok("собеседнику зазвонило") : fail("вызов не дошёл");

  console.log("\n=== 15. Отклонение доходит до звонящего ===");
  fifth.socket.emit("call:decline", { channelId: talk.id });
  const declined = await until(
    () => states.filter((s) => s.channelId === talk.id && s.state === "declined").length >= 2,
  );
  declined ? ok("оба узнали про отказ") : fail("отказ не дошёл");

  console.log("\n=== 16. Звонить самому себе и в чужое нельзя ===");
  const toServerChannel = await new Promise<boolean>((resolve) => {
    // В канал сервера звонить нечего: туда просто заходят.
    first.socket.emit("call:invite", { channelId: channel.id }, (accepted: boolean) =>
      resolve(accepted),
    );
    setTimeout(() => resolve(false), 5000);
  });
  !toServerChannel ? ok("в канал сервера позвонить нельзя") : fail("сервер разрешил лишнее");

  console.log("\n=== 17. Не в сети — звонка не будет ===");
  fifth.socket.disconnect();
  await wait(600);
  const toOffline = await new Promise<boolean>((resolve) => {
    first.socket.emit("call:invite", { channelId: talk.id }, (accepted: boolean) =>
      resolve(accepted),
    );
    setTimeout(() => resolve(false), 5000);
  });
  !toOffline
    ? ok("выключенному не звоним, а честно отказываем")
    : fail("сервер сделал вид, что звонит выключенному");

  first.socket.disconnect();
  fourth.socket.disconnect();
}

/** Подождать, пока условие станет верным. */
async function until(check: () => boolean, timeoutMs = 8000): Promise<boolean> {
  const till = Date.now() + timeoutMs;
  while (Date.now() < till) {
    if (check()) return true;
    await wait(200);
  }
  return false;
}

main()
  .catch((e: unknown) => {
    console.error("ТЕСТ УПАЛ:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    console.log(process.exitCode ? "\nЕсть провалы\n" : "\nВсё сходится\n");
    process.exit(process.exitCode ?? 0);
  });
