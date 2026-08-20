import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import { room } from "@messenger/shared";
import { hashPassword } from "../src/lib/password.js";
import { setRealtime } from "../src/realtime/emitter.js";
import { удалитьСервер, удалитьЧеловека } from "../src/modules/admin/actions.js";

/**
 * Проверка: удалённое исчезает у всех сразу, а не после перезагрузки.
 *
 *   npm run check:live -w @messenger/server
 *
 * Хозяин удаляет сервер в панели — и у четверых, которые в этот момент
 * сидят в мессенджере, он остаётся в списке: с каналами, в которые
 * больше никого не пустят, и с разговором, из которого уже никого
 * не слышно. Так было, потому что панель работала прямо с базой
 * и никому ничего не говорила.
 *
 * Здесь проверяется то самое: что вместе с записями уходит и весть
 * о них. Сокет-сервер подменён на записную книжку — нам важно не как
 * событие долетело (это общая машинерия, её проверяет check:realtime),
 * а что оно вообще отправлено, кому и с чем.
 */

const prisma = new PrismaClient();
const МЕТКА = `live${Date.now()}`;
const ПАРОЛЬ = `check-${randomUUID()}`;

const итоги: boolean[] = [];
const ok = (пункт: string, значение: unknown, ещё?: unknown) => {
  итоги.push(Boolean(значение));
  console.log(
    `${значение ? "  ✔" : "  ✘ ПРОВАЛ"} ${пункт}${ещё === undefined ? "" : " " + JSON.stringify(ещё)}`,
  );
};

/* ── Записная книжка вместо сокет-сервера ──────────────────────── */

interface Весть {
  куда: string;
  что: string;
  чем: unknown;
}

let вести: Весть[] = [];
let выставлены: string[] = [];

setRealtime({
  to: (куда: string) => ({
    emit: (что: string, чем: unknown) => {
      вести.push({ куда, что, чем });
      return true;
    },
  }),
  in: (куда: string) => ({
    disconnectSockets: () => выставлены.push(куда),
  }),
} as never);

/* ── Кого заводим ──────────────────────────────────────────────── */

async function человек(ключ: string) {
  return prisma.user.create({
    data: {
      id: ulid(),
      email: `${МЕТКА}.${ключ}@example.invalid`,
      username: `${МЕТКА}.${ключ}`,
      displayName: "Проверка живого",
      passwordHash: await hashPassword(ПАРОЛЬ),
      emailVerifiedAt: new Date(),
    },
  });
}

async function сервер(хозяинId: string, гостьId: string, имя: string) {
  const с = await prisma.server.create({
    data: {
      id: ulid(),
      name: `${МЕТКА} ${имя}`,
      ownerId: хозяинId,
      members: {
        create: [
          { userId: хозяинId, role: "OWNER" },
          { userId: гостьId, role: "MEMBER" },
        ],
      },
      channels: { create: [{ id: ulid(), type: "TEXT", name: "общий", position: 0 }] },
    },
    include: { channels: true },
  });

  const канал = с.channels[0]!;
  await prisma.message.createMany({
    data: [
      { id: ulid(), channelId: канал.id, authorId: хозяинId, content: "привет" },
      { id: ulid(), channelId: канал.id, authorId: гостьId, content: "и тебе" },
    ],
  });
  return с;
}

async function main() {
  console.log("\n=== Удалённое исчезает у всех ===\n");

  const хозяин = await человек("hozyain");
  const гость = await человек("gost");

  /* ── Сервер ──────────────────────────────────────────────────── */

  const первый = await сервер(хозяин.id, гость.id, "первый");
  вести = [];

  const итог = await удалитьСервер(первый.id);
  ok("сервер удалён", итог.удалён.endsWith("первый"), итог);

  const весть = вести.find((в) => в.что === "server:delete");
  ok("о сервере сказано всем, кто на нём был", весть?.куда === room.server(первый.id), {
    куда: весть?.куда,
    чем: весть?.чем,
  });
  ok(
    "и сказано именно про него",
    (весть?.чем as { id?: string } | undefined)?.id === первый.id,
  );

  ok(
    "каналы и переписка ушли следом",
    (await prisma.channel.count({ where: { serverId: первый.id } })) === 0,
  );

  let пропал = false;
  try {
    await удалитьСервер(первый.id);
  } catch {
    пропал = true;
  }
  ok("второй раз удалять уже нечего", пропал);

  /* ── Человек ─────────────────────────────────────────────────── */

  const второй = await сервер(хозяин.id, гость.id, "второй");
  вести = [];
  выставлены = [];

  const ушёл = await удалитьЧеловека(гость.id, хозяин.id);
  ok("человек удалён вместе со своими сообщениями", ушёл.сообщений === 1, ушёл);

  const оСоставе = вести.find((в) => в.что === "member:leave");
  ok("серверу сказано, что человека в нём больше нет", оСоставе?.куда === room.server(второй.id), {
    куда: оСоставе?.куда,
  });
  ok(
    "и названы и сервер, и человек",
    JSON.stringify(оСоставе?.чем) ===
      JSON.stringify({ serverId: второй.id, userId: гость.id }),
    оСоставе?.чем,
  );

  ok("его собственные окна выставлены", выставлены.includes(room.user(гость.id)), {
    выставлены,
  });

  ok("в базе его нет", (await prisma.user.count({ where: { id: гость.id } })) === 0);

  /* ── Чего делать нельзя ──────────────────────────────────────── */

  let себя = "";
  try {
    await удалитьЧеловека(хозяин.id, хозяин.id);
  } catch (беда) {
    себя = (беда as { code?: string }).code ?? "";
  }
  ok("себя удалить нельзя", себя === "SELF", { код: себя });

  const третий = await человек("hozyain2");
  await сервер(третий.id, хозяин.id, "третий");
  let свои = "";
  try {
    await удалитьЧеловека(третий.id, хозяин.id);
  } catch (беда) {
    свои = (беда as { code?: string }).code ?? "";
  }
  ok("хозяина серверов молча не удаляют", свои === "OWNS_SERVERS", { код: свои });
}

async function убрать() {
  const наши = await prisma.user.findMany({
    where: { username: { startsWith: МЕТКА } },
    select: { id: true },
  });
  const ids = наши.map((к) => к.id);

  const серверы = await prisma.server.findMany({
    where: { name: { startsWith: МЕТКА } },
    select: { id: true },
  });
  for (const { id } of серверы) {
    await prisma.message.deleteMany({ where: { channel: { serverId: id } } });
    await prisma.server.delete({ where: { id } });
  }

  await prisma.message.deleteMany({ where: { authorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });

  const осталось = await prisma.user.count({ where: { username: { startsWith: МЕТКА } } });
  ok("временные записи убраны", осталось === 0, { осталось });
}

try {
  await main();
} catch (беда) {
  ok(String(беда), false);
} finally {
  await убрать();
  await prisma.$disconnect();
}

const провалов = итоги.filter((х) => !х).length;
console.log(
  провалов === 0
    ? `\nВсё исчезает вовремя — проверок ${итоги.length}\n`
    : `\nПровалов: ${провалов} из ${итоги.length}\n`,
);
process.exit(провалов === 0 ? 0 : 1);
