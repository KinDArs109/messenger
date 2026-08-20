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

async function запрос(путь: string, token?: string, настройки: RequestInit = {}) {
  const res = await fetch(`${URL}/api${путь}`, {
    ...настройки,
    headers: {
      ...(настройки.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
