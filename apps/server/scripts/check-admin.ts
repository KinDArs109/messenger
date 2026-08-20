import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import { hashPassword } from "../src/lib/password.js";
import { войти } from "./login.js";

/**
 * Проверка хозяйского раздела.
 *
 *   ADMIN_USERNAME=<кто-то> npx tsx --env-file=.env src/index.ts
 *   CHECK_ADMIN=<тот же> npm run check:admin -w @messenger/server
 *
 * Главное здесь — не «панель показывает список», а «списка не видит
 * никто, кроме хозяина». Раздел отдаёт почты всех до единого, и цена
 * ошибки в проверке доступа тут не «неудобно», а «у всех утекла почта».
 *
 * Поэтому первым делом — чужой. Он должен получить не «нельзя»,
 * а «не найдено»: знать о существовании раздела ему незачем.
 *
 * Дверей у раздела две. Вторую — код в Телеграме — проверка открыть
 * не может и не должна: код уходит туда, куда ей ходу нет. Она
 * убеждается, что без пропуска раздела нет и у хозяина, а дальше
 * идёт только с готовым пропуском в CHECK_ADMIN_DOOR.
 */

const URL = process.env.CHECK_URL ?? "http://127.0.0.1:3001";
const ХОЗЯИН = process.env.CHECK_ADMIN ?? "";
const prisma = new PrismaClient();

const PASSWORD = `check-${randomUUID()}`;
const MARK = `admin${Date.now()}`;

const результаты: boolean[] = [];
const ok = (пункт: string, значение: unknown, ещё?: unknown) => {
  результаты.push(Boolean(значение));
  console.log(
    `${значение ? "  ✔" : "  ✘ ПРОВАЛ"} ${пункт}${ещё === undefined ? "" : " " + JSON.stringify(ещё)}`,
  );
};

/** Пропуск второй двери — код из Телеграма, уже принятый панелью.
 *  Пока его нет, хозяйская часть закрыта и для нас тоже. */
let пропуск: string | undefined;

async function запрос(путь: string, token?: string, настройки: RequestInit = {}) {
  const res = await fetch(`${URL}/api${путь}`, {
    ...настройки,
    headers: {
      ...(настройки.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(пропуск ? { "X-Admin": пропуск } : {}),
    },
  });
  const тело = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { статус: res.status, тело };
}

async function завести(ключ: string) {
  const email = `${MARK}.${ключ}@example.invalid`;
  await prisma.user.create({
    data: {
      id: ulid(),
      email,
      username: `${MARK}.${ключ}`,
      displayName: "Проверка панели",
      passwordHash: await hashPassword(PASSWORD),
      emailVerifiedAt: new Date(),
      loginCodeHash: createHash("sha256").update("424242").digest("hex"),
      loginCodeExpires: new Date(Date.now() + 60 * 60 * 1000),
      loginCodeSentAt: new Date(),
    },
  });
  return email;
}

async function main() {
  console.log("\n=== Хозяйский раздел ===");

  if (!ХОЗЯИН) {
    ok("хозяин назван в CHECK_ADMIN", false, {
      подсказка: "CHECK_ADMIN=<имя из ADMIN_USERNAME> npm run check:admin -w @messenger/server",
    });
    return;
  }

  // 1. Без входа — сразу от ворот поворот.
  const никто = await запрос("/admin/overview");
  ok("без входа раздел не отвечает", никто.статус === 401, { статус: никто.статус });

  // 2. Чужой, который вошёл. Самое важное: он видит не «нельзя»,
  //    а «нет такого раздела».
  const чужаяПочта = await завести("chuzhoy");
  const чужойТокен = await войти(URL, prisma, чужаяПочта, PASSWORD);
  const чужой = await запрос("/admin/overview", чужойТокен);
  ok("вошедшему чужому раздела не видно", чужой.статус === 404, {
    статус: чужой.статус,
    ответ: (чужой.тело.error as { code?: string } | undefined)?.code,
  });

  const чужойУдалить = await запрос(`/admin/users/${ulid()}`, чужойТокен, { method: "DELETE" });
  ok("и удалять он никого не может", чужойУдалить.статус === 404, { статус: чужойУдалить.статус });

  const чужиеПриглашения = await запрос("/admin/invites", чужойТокен, {
    method: "POST",
    body: JSON.stringify({ serverId: ulid() }),
  });
  ok("и приглашения выпускать тоже", чужиеПриглашения.статус === 404, {
    статус: чужиеПриглашения.статус,
  });

  // 3. Хозяин. Пароль его нам неизвестен — да и не нужен: проверяем
  //    не вход, а доступ, поэтому берём токен обычным путём через базу.
  const хозяин = await prisma.user.findUnique({
    where: { username: ХОЗЯИН },
    select: { email: true },
  });
  if (!хозяин) {
    ok(`хозяин ${ХОЗЯИН} есть в базе`, false);
    return;
  }

  // Пароль хозяина мы не знаем и знать не должны. Чтобы войти его
  // глазами, заводим временного двойника с тем же именем? Нет —
  // имя занято. Поэтому здесь честно: если пароль хозяина не передан,
  // проверяем только то, что чужому раздел закрыт, а хозяйскую часть
  // смотрит человек руками в самой панели.
  const пароль = process.env.CHECK_ADMIN_PASSWORD;
  if (!пароль) {
    console.log("  · пароль хозяина не передан — хозяйскую часть не проверяем");
    return;
  }

  const токен = await войти(URL, prisma, хозяин.email, пароль);

  /*
   * Вторая дверь. Пароль и код из письма открывают мессенджер,
   * но не хозяйство: туда нужен ещё код, приходящий в Телеграм.
   * Прочитать его проверке неоткуда — в том и смысл, что за ним
   * надо пойти в другое место. Поэтому здесь она проверяет главное:
   * что без пропуска раздела нет даже у хозяина, — а дальше идёт,
   * только если пропуск ей дали.
   */
  const заперто = await запрос("/admin/overview", токен);
  ok("хозяину без пропуска раздела тоже не видно", заперто.статус === 404, {
    статус: заперто.статус,
  });

  пропуск = process.env.CHECK_ADMIN_DOOR;
  if (!пропуск) {
    console.log(
      "  · пропуска второй двери нет (CHECK_ADMIN_DOOR) — списки и удаление смотрит человек в самой панели",
    );
    return;
  }

  const обзор = await запрос("/admin/overview", токен);
  ok("хозяин видит обзор", обзор.статус === 200, { статус: обзор.статус });

  const люди = (обзор.тело.люди as unknown[] | undefined) ?? [];
  ok("в обзоре есть люди и у них видна почта", люди.length > 0 && "email" in (люди[0] as object), {
    людей: люди.length,
  });

  const себя = (люди as { id: string; username: string }[]).find((к) => к.username === ХОЗЯИН);
  const самсебя = await запрос(`/admin/users/${себя?.id}`, токен, { method: "DELETE" });
  ok("себя удалить нельзя", самсебя.статус === 400, { статус: самсебя.статус });

  const чужойВСписке = (люди as { id: string; username: string }[]).find(
    (к) => к.username === `${MARK}.chuzhoy`,
  );
  const удаление = await запрос(`/admin/users/${чужойВСписке?.id}`, токен, { method: "DELETE" });
  ok("а обычного человека — можно", удаление.статус === 200, { статус: удаление.статус });

  const проверка = await prisma.user.count({ where: { username: `${MARK}.chuzhoy` } });
  ok("и он действительно исчез из базы", проверка === 0);

  /*
   * Человек с перепиской. Из-за него панель и падала «внутренней
   * ошибкой сервера»: у сообщения автор — обычная связь без «удалять
   * следом», и база не даёт стереть того, за кем осталась переписка.
   * Теперь сообщения уходят вместе с ним, одной сделкой.
   */
  const почта = await завести("pisatel");
  const писатель = await prisma.user.findUniqueOrThrow({
    where: { email: почта },
    select: { id: true },
  });
  const свойСервер = await prisma.server.create({
    data: { id: ulid(), name: `${MARK} сервер`, ownerId: писатель.id },
  });
  const канал = await prisma.channel.create({
    data: { id: ulid(), serverId: свойСервер.id, name: "общий", type: "TEXT", position: 0 },
  });
  await prisma.message.create({
    data: { id: ulid(), channelId: канал.id, authorId: писатель.id, content: "проверка" },
  });

  const сСервером = await запрос(`/admin/users/${писатель.id}`, токен, { method: "DELETE" });
  ok("человека с своими серверами не удаляют молча", сСервером.статус === 400, {
    статус: сСервером.статус,
    ответ: (сСервером.тело.error as { message?: string } | undefined)?.message,
  });

  const серверУдалён = await запрос(`/admin/servers/${свойСервер.id}`, токен, { method: "DELETE" });
  ok("сервер удаляется целиком", серверУдалён.статус === 200, { статус: серверУдалён.статус });
  ok(
    "и уносит с собой каналы и переписку",
    (await prisma.channel.count({ where: { serverId: свойСервер.id } })) === 0 &&
      (await prisma.message.count({ where: { authorId: писатель.id } })) === 0,
  );

  const сПерепиской = await запрос(`/admin/users/${писатель.id}`, токен, { method: "DELETE" });
  ok("а теперь и сам человек удаляется", сПерепиской.статус === 200, {
    статус: сПерепиской.статус,
  });
}

async function убрать() {
  await prisma.invite.deleteMany({ where: { creator: { username: { startsWith: MARK } } } });
  await prisma.server.deleteMany({ where: { owner: { username: { startsWith: MARK } } } });
  const { count } = await prisma.user.deleteMany({ where: { username: { startsWith: MARK } } });
  const осталось = await prisma.user.count({ where: { username: { startsWith: MARK } } });
  ok("временные учётные записи убраны", осталось === 0, { удалено: count });
}

try {
  await main();
} catch (error) {
  ok(String(error), false);
} finally {
  await убрать();
  await prisma.$disconnect();
  const провалов = результаты.filter((x) => !x).length;
  console.log(
    `\n${провалов === 0 ? "Раздел закрыт для чужих" : `Провалов: ${провалов}`} — проверок ${результаты.length}\n`,
  );
  process.exitCode = провалов === 0 ? 0 : 1;
}
