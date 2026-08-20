import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import { createHash } from "node:crypto";
import { hashPassword } from "../src/lib/password.js";
import { войти } from "./login.js";

const хеш = (код: string) => createHash("sha256").update(код).digest("hex");

/**
 * Проверка входной двери: что говорят человеку, который пришёл
 * регистрироваться.
 *
 *   npm run check:signup -w @messenger/server
 *
 * Появилась после того, как друг, которого позвали, не смог
 * зарегистрироваться и ушёл. Причин было две, и обе — про слова,
 * а не про безопасность:
 *
 *   · отказ прилетал красной строкой поверх всей формы, над письмом
 *     и паролем, — то есть не там, где ошибся человек, и без единого
 *     слова о том, где этот код берут;
 *   · код, набранный кириллицей, ронял сравнение: длину брали
 *     у строки, а сравнивали байты, и русская буква весом в два байта
 *     превращала «код не подошёл» во «внутреннюю ошибку сервера».
 *
 * Поэтому проверка смотрит не «пустили или нет» — это как раз просто, —
 * а что именно человек прочтёт в каждом из случаев.
 */

const URL = process.env.CHECK_URL ?? "http://127.0.0.1:3001";
const prisma = new PrismaClient();

const PASSWORD = `check-${randomUUID()}`;
const MARK = `signup${Date.now()}`;

const результаты: boolean[] = [];
const ok = (пункт: string, значение: unknown, ещё?: unknown) => {
  результаты.push(Boolean(значение));
  console.log(
    `${значение ? "  ✔" : "  ✘ ПРОВАЛ"} ${пункт}${ещё === undefined ? "" : " " + JSON.stringify(ещё)}`,
  );
};

interface Ответ {
  status: number;
  code: string;
  поле: string;
  body: Record<string, unknown>;
}

async function зарегистрировать(ключ: string, signupCode?: string): Promise<Ответ> {
  const res = await fetch(`${URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `${MARK}.${ключ}@example.invalid`,
      username: `${MARK}.${ключ}`,
      displayName: "Проверка двери",
      password: PASSWORD,
      ...(signupCode === undefined ? {} : { signupCode }),
    }),
  });
  const данные = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const error = данные.error as
    | { code?: string; fields?: Record<string, string> }
    | undefined;
  return {
    status: res.status,
    code: error?.code ?? "",
    поле: error?.fields?.signupCode ?? "",
    body: данные,
  };
}

async function main() {
  console.log("\n=== Что говорят на входной двери ===");

  // Закрыт ли сервер вообще: если код на регистрацию не задан, дверь
  // открыта всем, и проверять здесь нечего.
  const открыт = (await зарегистрировать("otkryt", undefined)).status === 201;
  if (открыт) {
    console.log("  · регистрация открыта без кода — проверять нечего\n");
    return;
  }

  // 1. Пустое поле: человек должен прочесть, где взять код, и прочесть
  //    это под самим полем, а не поверх формы.
  const пусто = await зарегистрировать("pusto");
  ok("без кода не пускают", пусто.status === 403 && пусто.code === "SIGNUP_CODE_REQUIRED", {
    статус: пусто.status,
    код: пусто.code,
  });
  ok("и подсказывают, у кого спросить", пусто.поле.includes("позвал"), { поле: пусто.поле });

  // 2. Неверный код.
  const мимо = await зарегистрировать("mimo", "nekakoi-kod");
  ok("неверный код отвергают", мимо.status === 403 && мимо.code === "SIGNUP_CODE_BAD", {
    статус: мимо.status,
    код: мимо.code,
  });
  ok("и говорят это полем, а не общей строкой", мимо.поле.length > 0, { поле: мимо.поле });

  /*
   * 3. Кириллица. Тот самый случай, из-за которого проверка и появилась:
   *    шестнадцать русских букв — это двадцать семь байт, и сравнение
   *    буферов разной длины бросало ошибку вместо ответа. Человеку
   *    прилетала «внутренняя ошибка сервера».
   */
  // Длин берём три, а не пять: каждая неудачная попытка идёт
  // в счётчик ограничителя, а он считает по адресу и помнит
  // четверть часа — проверка не должна упираться в саму себя.
  for (const длина of [8, 16, 24]) {
    const кириллицей = "я".repeat(длина);
    const ответ = await зарегистрировать(`kir${длина}`, кириллицей);
    ok(`код из ${длина} русских букв — это отказ, а не поломка`, ответ.status === 403, {
      статус: ответ.status,
      код: ответ.code,
    });
  }

  // 4. Приглашения. Заводим своё — просроченное и годное.
  const хозяин = await prisma.user.create({
    data: {
      id: ulid(),
      email: `${MARK}.hozyain@example.invalid`,
      username: `${MARK}.hozyain`,
      displayName: "Хозяин",
      passwordHash: await hashPassword(PASSWORD),
      emailVerifiedAt: new Date(),
    },
  });
  const сервер = await prisma.server.create({
    data: { id: ulid(), name: "Проверка двери", ownerId: хозяин.id },
  });
  const приглашение = async (code: string, expiresAt: Date | null) =>
    prisma.invite.create({ data: { code, serverId: сервер.id, creatorId: хозяин.id, expiresAt } });

  await приглашение(`${MARK}old`.slice(-8), new Date(Date.now() - 60_000));
  await приглашение(`${MARK}new`.slice(-8), new Date(Date.now() + 3600_000));
  const старое = `${MARK}old`.slice(-8);
  const годное = `${MARK}new`.slice(-8);

  const истекло = await зарегистрировать("isteklo", старое);
  ok("про истёкшее приглашение так и говорят", истекло.status === 403 && истекло.поле.includes("истекла"), {
    статус: истекло.status,
    поле: истекло.поле,
  });

  const заглавными = await зарегистрировать("zaglavnymi", годное.toUpperCase());
  ok("код, переписанный заглавными, тоже подходит", заглавными.status === 201, {
    статус: заглавными.status,
    код: заглавными.code,
  });

  const годным = await зарегистрировать("godnym", годное);
  ok("по годному приглашению регистрация проходит", годным.status === 201, {
    статус: годным.status,
    код: годным.code,
  });

  /*
   * Дальше — весь путь новичка целиком, от кнопки «Продолжить»
   * до переписки.
   *
   * По кускам всё это проверено в других местах: застава подтверждения
   * в check-verify, второй шаг входа в check-login. Но человек проходит
   * их подряд, и ломается обычно не кусок, а стык: например, вход после
   * регистрации, когда почта ещё не подтверждена, а сессия уже выдана.
   */
  const почта = `${MARK}.godnym@example.invalid`;
  const токен = годным.body.accessToken as string | undefined;

  ok("сразу после регистрации сессия выдана", Boolean(токен));

  const сразу = await внутрь(токен);
  ok("но внутрь не пускают: почта не подтверждена", сразу === 403, { статус: сразу });

  // За почтовый ящик — как и во всех остальных проверках.
  await prisma.user.update({
    where: { email: почта },
    data: {
      emailCodeHash: хеш("308914"),
      emailCodeExpires: new Date(Date.now() + 15 * 60 * 1000),
      emailCodeAttempts: 0,
    },
  });

  const подтвердил = await fetch(`${URL}/api/auth/email/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${токен}` },
    body: JSON.stringify({ code: "308914" }),
  });
  ok("код из письма подтверждает почту", подтвердил.status === 200, { статус: подтвердил.status });

  const после = await внутрь(токен);
  ok("и тем же токеном человек оказывается внутри", после === 200, { статус: после });

  // И наконец вход заново — уже со вторым шагом.
  const свежий = await войти(URL, prisma, почта, PASSWORD);
  ok("вход после регистрации проходит через код из письма", Boolean(свежий));

  const снова = await внутрь(свежий);
  ok("и пускает внутрь", снова === 200, { статус: снова });
}

/** Пускают ли с этим токеном внутрь. Спрашиваем список серверов:
 *  он есть у всех, и застава подтверждения почты стоит перед ним. */
async function внутрь(token?: string): Promise<number> {
  if (!token) return 0;
  const res = await fetch(`${URL}/api/servers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.status;
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
    `\n${провалов === 0 ? "Дверь объясняет себя" : `Провалов: ${провалов}`} — проверок ${результаты.length}\n`,
  );
  process.exitCode = провалов === 0 ? 0 : 1;
}
