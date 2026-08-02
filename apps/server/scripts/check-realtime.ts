import { io, type Socket } from "socket.io-client";
import { PrismaClient } from "@prisma/client";

/** Проверка WebSocket-слоя. Требует запущенного сервера: npm run dev
 *
 *  Статусы проверяем на Вере, а не на Ане: Аня — пользователь по
 *  умолчанию на проверочной странице, и открытая вкладка браузера
 *  держала бы её «в сети», роняя тест на ровном месте. */
const URL = "http://localhost:3001";
const prisma = new PrismaClient();

const ok = (s: string) => console.log(`  ✔ ${s}`);
const fail = (s: string) => {
  console.log(`  ✘ ПРОВАЛ: ${s}`);
  process.exitCode = 1;
};

async function login(email: string): Promise<string> {
  const res = await fetch(`${URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  if (!res.ok) throw new Error(`Не удалось войти как ${email}: HTTP ${res.status}`);
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

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { auth: { token }, transports: ["websocket"], reconnection: false });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Опрашиваем базу вместо фиксированной паузы: каждый запрос идёт
 *  во Франкфурт, и угадывать длительность бессмысленно. */
async function waitForStatus(username: string, expected: string, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const user = await prisma.user.findFirstOrThrow({ where: { username } });
    if (user.status === expected) return true;
    await wait(300);
  }
  return false;
}

async function main() {
  console.log("\n=== 1. Подключение без токена ===");
  const anon = await tryConnect();
  anon.connected ? fail("аноним подключился") : ok(`отклонено: ${anon.error}`);

  console.log("\n=== 2. Подключение с поддельным токеном ===");
  const forged = await tryConnect("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYWNrZXIifQ.BAD");
  forged.connected ? fail("поддельный токен принят") : ok(`отклонено: ${forged.error}`);

  const annaToken = await login("anna@example.com");
  const borisToken = await login("boris@example.com");
  const veraToken = await login("vera@example.com");

  console.log("\n=== 3. Подключение с настоящим токеном ===");
  const real = await tryConnect(veraToken);
  real.connected ? ok("подключение установлено") : fail(`не подключился: ${real.error}`);

  console.log("\n=== 4. Статус «в сети» при подключении ===");
  const vera = await connect(veraToken);
  (await waitForStatus("vera", "online"))
    ? ok("статус online")
    : fail("статус так и не стал online");

  console.log("\n=== 5. Доступ к своему и несуществующему каналу ===");
  const channel = await prisma.channel.findFirstOrThrow({
    where: { type: "TEXT" },
    orderBy: { position: "asc" },
  });
  const anna = await connect(annaToken);
  const boris = await connect(borisToken);

  const annaSub = await anna.emitWithAck("channel:subscribe", { channelId: channel.id });
  const borisSub = await boris.emitWithAck("channel:subscribe", { channelId: channel.id });
  const bogusSub = await anna.emitWithAck("channel:subscribe", {
    channelId: "01ZZZZZZZZZZZZZZZZZZZZZZZZ",
  });
  annaSub ? ok("Аня подписалась на свой канал") : fail("Аню не пустили в свой канал");
  borisSub ? ok("Борис подписался на свой канал") : fail("Бориса не пустили в свой канал");
  bogusSub ? fail("пустили в несуществующий канал") : ok("несуществующий канал отклонён");

  console.log("\n=== 6. Событие «печатает» доходит до другого участника ===");
  const annaUser = await prisma.user.findFirstOrThrow({ where: { username: "anna" } });
  const typing = await new Promise<{ channelId: string; userId: string } | null>((resolve) => {
    boris.on("typing", resolve);
    anna.emit("typing:start", { channelId: channel.id });
    setTimeout(() => resolve(null), 5000);
  });
  if (!typing) fail("Борис не получил событие");
  else if (typing.userId !== annaUser.id) fail(`пришёл чужой userId: ${typing.userId}`);
  else if (typing.channelId !== channel.id) fail(`пришёл чужой канал: ${typing.channelId}`);
  else ok("Борис получил typing от Ани, канал совпадает");

  console.log("\n=== 7. Отправитель не получает своё же «печатает» ===");
  const echo = await new Promise<boolean>((resolve) => {
    anna.on("typing", () => resolve(true));
    anna.emit("typing:start", { channelId: channel.id });
    setTimeout(() => resolve(false), 3000);
  });
  echo ? fail("отправителю вернулось своё событие") : ok("эха нет");

  console.log("\n=== 8. Новое сообщение прилетает подписчику канала ===");
  const delivered = await new Promise<{ id: string; content: string } | null>((resolve) => {
    boris.on("message:new", (m: { id: string; content: string; channelId: string }) => {
      if (m.channelId === channel.id) resolve(m);
    });
    void fetch(`${URL}/api/channels/${channel.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${annaToken}` },
      body: JSON.stringify({ content: "проверка доставки" }),
    });
    setTimeout(() => resolve(null), 8000);
  });
  if (delivered) {
    ok(`Борис получил сообщение: «${delivered.content}»`);
    // Убираем за собой, чтобы прогоны не засоряли историю канала.
    await prisma.message.delete({ where: { id: delivered.id } });
  } else {
    fail("сообщение не дошло через сокет");
  }

  console.log("\n=== 9. Статус «не в сети» после отключения ===");
  vera.disconnect();
  (await waitForStatus("vera", "offline"))
    ? ok("статус offline")
    : fail("статус не стал offline — возможно, Вера открыта где-то ещё");

  anna.disconnect();
  boris.disconnect();
}

main()
  .catch((e: unknown) => {
    console.error("ТЕСТ УПАЛ:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
