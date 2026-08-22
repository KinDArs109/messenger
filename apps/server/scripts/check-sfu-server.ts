import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import { hashPassword } from "../src/lib/password.js";
import { войти } from "./login.js";

/**
 * Проверка раздачи со стороны сервера.
 *
 *   npm run check:sfu-server -w @messenger/server
 *
 * Сквозная проверка (apps/desktop/scripts/check-sfu.cjs) гоняет
 * настоящую картинку через три окна мессенджера, но для этого ей нужен
 * браузер. Здесь — то, что можно спросить без него и что чаще всего
 * и ломается при переезде на другую машину:
 *
 *   1. раздача вообще поднялась (а не молча выключилась);
 *   2. дорога выдаётся, и в приглашении стоит адрес, по которому
 *      до сервера можно достучаться, — не 0.0.0.0 и не «пусто»;
 *   3. порты те, что открыты в файрволе.
 *
 * Второй пункт стоил вечера: без внешнего адреса сервер честно
 * отдавал приглашение к самому себе по адресу 0.0.0.0, показ висел
 * в тишине, и выглядело это как «раздача не работает».
 */

const URL = process.env.CHECK_URL ?? "http://127.0.0.1:3001";
const prisma = new PrismaClient();
const PASSWORD = `check-${randomUUID()}`;
const МЕТКА = `sfusrv${Date.now()}`;

const итоги: boolean[] = [];
const ok = (пункт: string, значение: unknown, ещё?: unknown) => {
  итоги.push(Boolean(значение));
  console.log(
    `${значение ? "  ✔" : "  ✘ ПРОВАЛ"} ${пункт}${ещё === undefined ? "" : " " + JSON.stringify(ещё)}`,
  );
};

/** Спросить сервер и не ждать вечно. */
function спросить<T>(socket: Socket, событие: string, данные?: unknown): Promise<T | null> {
  return new Promise((готово) => {
    const срок = setTimeout(() => готово(null), 8000);
    const ответ = (что: T) => {
      clearTimeout(срок);
      готово(что);
    };
    if (данные === undefined) socket.emit(событие, ответ);
    else socket.emit(событие, данные, ответ);
  });
}

async function main() {
  console.log("\n=== Раздача картинки ===\n");

  // Свои люди и свой канал: лезть в живой разговор проверке незачем.
  const hash = await hashPassword(PASSWORD);
  const кто = await prisma.user.create({
    data: {
      id: ulid(),
      email: `${МЕТКА}@example.invalid`,
      username: МЕТКА,
      displayName: "Проверка раздачи",
      passwordHash: hash,
      emailVerifiedAt: new Date(),
    },
  });

  const сервер = await prisma.server.create({
    data: {
      id: ulid(),
      name: `${МЕТКА} сервер`,
      ownerId: кто.id,
      members: { create: [{ userId: кто.id, role: "OWNER" }] },
      channels: { create: [{ id: ulid(), type: "VOICE", name: "Разговор", position: 0 }] },
    },
    include: { channels: true },
  });
  const канал = сервер.channels[0]!;

  const token = await войти(URL, prisma, кто.username, PASSWORD);
  const socket = io(URL, { auth: { token }, transports: ["websocket"] });

  await new Promise<void>((готово, беда) => {
    socket.once("connect", () => готово());
    socket.once("connect_error", (e) => беда(e));
  });

  const вошёл = await спросить<boolean>(socket, "voice:join", { channelId: канал.id });
  ok("вошли в голосовой канал", вошёл === true);

  const возможности = await спросить<{ codecs?: { mimeType: string }[] }>(
    socket,
    "sfu:capabilities",
  );
  ok("раздача поднята и отвечает", Boolean(возможности?.codecs?.length), {
    кодеков: возможности?.codecs?.length ?? 0,
  });

  const кодеки = (возможности?.codecs ?? []).map((к) => к.mimeType.toLowerCase());
  ok("умеет H264 — им и идёт показ", кодеки.includes("video/h264"));

  // Звук показа идёт той же дорогой, что и картинка, и своим кодеком.
  // Без него собеседник увидит чужую игру немой.
  ok("умеет opus — им идёт звук показа", кодеки.includes("audio/opus"));

  const дорога = await спросить<{
    id: string;
    iceCandidates?: { ip?: string; address?: string; port: number; protocol: string }[];
  }>(socket, "sfu:transport", { куда: "send" });

  ok("дорога до раздачи выдаётся", Boolean(дорога?.id));

  const кандидаты = дорога?.iceCandidates ?? [];
  const адреса = кандидаты.map((к) => к.address ?? к.ip ?? "?");
  ok("в приглашении настоящий адрес, а не 0.0.0.0", адреса.length > 0 && !адреса.includes("0.0.0.0"), {
    адреса,
  });

  const порты = кандидаты.map((к) => к.port);
  ok(
    "порты из того же промежутка, что открыт в файрволе",
    порты.length > 0 && порты.every((п) => п >= 40000 && п <= 40059),
    { порты },
  );

  ok(
    "есть и запасной путь по TCP — для тех, у кого режут UDP",
    кандидаты.some((к) => к.protocol === "tcp"),
  );

  socket.emit("voice:leave");
  socket.disconnect();
}

async function убрать() {
  const серверы = await prisma.server.findMany({
    where: { name: { startsWith: МЕТКА } },
    select: { id: true },
  });
  for (const { id } of серверы) {
    await prisma.message.deleteMany({ where: { channel: { serverId: id } } });
    await prisma.channel.deleteMany({ where: { serverId: id } });
    await prisma.serverMember.deleteMany({ where: { serverId: id } });
    await prisma.server.delete({ where: { id } });
  }
  const { count } = await prisma.user.deleteMany({ where: { username: { startsWith: МЕТКА } } });
  const осталось = await prisma.user.count({ where: { username: { startsWith: МЕТКА } } });
  ok("временные записи убраны", осталось === 0, { удалено: count });
}

try {
  await main();
} catch (беда) {
  ok(String(беда instanceof Error ? беда.message : беда), false);
} finally {
  await убрать();
  await prisma.$disconnect();
}

const провалов = итоги.filter((х) => !х).length;
console.log(
  провалов === 0
    ? `\nРаздача на месте — проверок ${итоги.length}\n`
    : `\nПровалов: ${провалов} из ${итоги.length}\n`,
);
process.exit(провалов === 0 ? 0 : 1);
