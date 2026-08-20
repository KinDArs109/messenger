import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import { hashPassword } from "../src/lib/password.js";

/**
 * Проверка второго шага входа: кода из письма.
 *
 *   npm run check:login -w @messenger/server
 *
 * Главное здесь — не «код подходит», а «без кода не пускают». Пароль
 * теперь только половина ключа, и проверка следит именно за второй
 * половиной: что первый шаг не выдаёт ни токена, ни cookie, что чужой
 * пропуск не годится, что подобрать шесть цифр не выйдет, и что
 * пропуск нельзя предъявить вместо токена и попасть внутрь.
 *
 * Писем проверка не читает: код кладёт в базу сама, как это делает
 * общий помощник для остальных проверок. Роль почтового ящика,
 * не обход — сервер проверяет код обычным порядком.
 */

const URL = process.env.CHECK_URL ?? "http://127.0.0.1:3001";
const prisma = new PrismaClient();

const PASSWORD = `check-${randomUUID()}`;
const КОД = "424242";
const MARK = `login${Date.now()}`;

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
  cookie: boolean;
  body: Record<string, unknown>;
}

async function запрос(path: string, body?: unknown, token?: string): Promise<Ответ> {
  const res = await fetch(`${URL}/api${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const данные = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const error = данные.error as { code?: string } | undefined;
  return {
    status: res.status,
    code: error?.code ?? "",
    // Сессия живёт в cookie: если первый шаг её поставит, значит
    // вход состоялся до кода — а этого быть не должно.
    cookie: res.headers.getSetCookie().some((c) => c.startsWith("refresh")),
    body: данные,
  };
}

const хеш = (код: string) => createHash("sha256").update(код).digest("hex");

/** Положить человеку известный код — за почтовый ящик. */
async function положитьКод(email: string, код = КОД) {
  await prisma.user.update({
    where: { email },
    data: {
      loginCodeHash: хеш(код),
      loginCodeExpires: new Date(Date.now() + 15 * 60 * 1000),
      loginCodeAttempts: 0,
    },
  });
}

async function завести(ключ: string) {
  const email = `${MARK}.${ключ}@example.invalid`;
  await prisma.user.create({
    data: {
      id: ulid(),
      email,
      username: `${MARK}.${ключ}`,
      displayName: "Проверка входа",
      passwordHash: await hashPassword(PASSWORD),
      emailVerifiedAt: new Date(),
    },
  });
  return email;
}

async function main() {
  console.log("\n=== Второй шаг входа ===");

  const политика = await запрос("/auth/password/forgot", { login: `${MARK}@example.invalid` });
  // Ограничитель входа считает неудачные попытки по адресу и помнит
  // их четверть часа. Проверка их и устраивает — а значит, второй
  // прогон подряд упрётся в него на первом же шаге. Молчать про это
  // нельзя: проверка, которая при отказе бодро пишет «всё хорошо»,
  // хуже, чем никакой.
  if (политика.status === 429) {
    ok("ограничитель входа отпустил прошлый прогон", false, {
      подсказка: "подождите четверть часа или перезапустите сервер",
    });
    return;
  }

  if (политика.body.mailEnabled !== true) {
    console.log("  · почта на сервере не настроена — второго шага нет, проверять нечего\n");
    return;
  }

  const почта = await завести("kto");
  const чужая = await завести("drugoy");

  // 1. Первый шаг: пароль верный — а сессии всё равно нет.
  const первый = await запрос("/auth/login", { login: почта, password: PASSWORD });
  ok("верный пароль сам по себе внутрь не пускает", первый.status === 200 && !первый.body.accessToken, {
    статус: первый.status,
    ответ: первый.body.pending,
  });
  ok("и cookie сессии не ставит", !первый.cookie);
  ok("сервер просит код и говорит, куда он ушёл", первый.body.pending === "email" && typeof первый.body.email === "string", {
    адрес: первый.body.email,
  });
  ok(
    "адрес показан наполовину закрытым",
    typeof первый.body.email === "string" && (первый.body.email as string).includes("•"),
    { адрес: первый.body.email },
  );

  const пропуск = первый.body.ticket as string;

  // 2. Неверный пароль не доходит и до первого шага.
  const мимо = await запрос("/auth/login", { login: почта, password: "не тот пароль" });
  ok("неверный пароль отвергается сразу", мимо.status === 401, { статус: мимо.status });

  // 3. Пропуск — не токен. Это отдельная проверка, потому что подписан
  //    он тем же ключом: без пометки получателя им можно было бы
  //    открыть дверь, не вводя код.
  const попытка = await запрос("/servers", undefined, пропуск);
  ok("пропуск нельзя предъявить вместо токена", попытка.status === 401, { статус: попытка.status });

  // 4. Код.
  await положитьКод(почта);

  const неверный = await запрос("/auth/login/confirm", { ticket: пропуск, code: "000001" });
  ok("неверный код не подходит", неверный.status === 400 && неверный.code === "BAD_CODE", {
    статус: неверный.status,
    код: неверный.code,
  });

  const чужойПропуск = await запрос("/auth/login/confirm", { ticket: "не-пропуск", code: КОД });
  ok("код без пропуска не годится", чужойПропуск.status === 401, { статус: чужойПропуск.status });

  const верный = await запрос("/auth/login/confirm", { ticket: пропуск, code: КОД });
  const token = верный.body.accessToken as string | undefined;
  ok("с кодом вход состоялся", верный.status === 200 && Boolean(token), { статус: верный.status });
  ok("и вот теперь ставится cookie сессии", верный.cookie);

  const внутри = await запрос("/servers", undefined, token);
  ok("выданный токен работает", внутри.status === 200, { статус: внутри.status });

  // 5. Использованный код сгорает: второй раз тем же не войти.
  const повторно = await запрос("/auth/login/confirm", { ticket: пропуск, code: КОД });
  ok("второй раз тот же код не принимают", повторно.status === 400, {
    статус: повторно.status,
    код: повторно.code,
  });

  // 6. Действующий код не заменяется новым: иначе письмо, открытое
  //    у человека, переставало бы годиться от одного лишнего нажатия
  //    «войти».
  const адрес = await завести("povtor");
  await запрос("/auth/login", { login: адрес, password: PASSWORD });
  await положитьКод(адрес);
  const снова = await запрос("/auth/login", { login: адрес, password: PASSWORD });
  const после = await prisma.user.findUnique({
    where: { email: адрес },
    select: { loginCodeHash: true },
  });
  ok("повторный вход не отменяет уже отправленный код", после?.loginCodeHash === хеш(КОД));
  const всёещё = await запрос("/auth/login/confirm", {
    ticket: снова.body.ticket as string,
    code: КОД,
  });
  ok("и код из первого письма всё ещё подходит", Boolean(всёещё.body.accessToken), {
    статус: всёещё.status,
  });

  /*
   * Перебор — последним, и это не прихоть порядка.
   *
   * Вход прикрыт ограничителем, который считает неудачные попытки
   * с одного адреса. Пять промахов подряд — ровно то, ради чего он
   * поставлен, и после них он отвечает «слишком много запросов» уже
   * на всё подряд. Стоя посреди проверки, эта пятёрка роняла те, что
   * шли следом: они падали не потому, что сломались, а потому, что
   * их не пускал сторож у двери.
   */
  const второй = await запрос("/auth/login", { login: чужая, password: PASSWORD });
  const пропуск2 = второй.body.ticket as string;
  await положитьКод(чужая);
  for (let i = 0; i < 5; i += 1) {
    await запрос("/auth/login/confirm", { ticket: пропуск2, code: "000002" });
  }
  const сгорел = await запрос("/auth/login/confirm", { ticket: пропуск2, code: КОД });
  ok(
    "после пяти промахов код сгорает",
    сгорел.status === 400 && сгорел.code === "TOO_MANY_ATTEMPTS",
    { статус: сгорел.status, код: сгорел.code },
  );
}

async function убрать() {
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
    `\n${провалов === 0 ? "Второй шаг держит" : `Провалов: ${провалов}`} — проверок ${результаты.length}\n`,
  );
  process.exitCode = провалов === 0 ? 0 : 1;
}
