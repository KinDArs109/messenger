import { createHash, randomUUID } from "node:crypto";
import { io } from "socket.io-client";
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import { hashPassword } from "../src/lib/password.js";
import { войти as общийВход } from "./login.js";

/**
 * Проверка подтверждения почты — того, что от него осталось.
 *
 *   npm run check:verify -w @messenger/server
 *
 * Заставы «подтверди почту, иначе не пустим» больше нет: она стояла
 * между приглашением и первым сообщением и встречала позванного
 * человека поручением сходить в почту. Поэтому первым делом проверяем
 * обратное — что непроверенного пускают и в API, и в сокет.
 *
 * Сам код никуда не делся: им можно подтвердить адрес по своей воле
 * и поправить опечатку, пока сессия жива. Это и проверяем дальше.
 *
 * Учётные записи заводятся на время прогона и уносятся за собой:
 * держать на боевой машине «вечно неподтверждённого» ради проверки
 * нельзя — это готовая дыра.
 *
 * Писем проверка не шлёт — кроме одного, при смене адреса: там код
 * уходит на новый адрес по самой сути проверяемого. Это цена честной
 * проверки настоящего пути, и она невелика: адрес на домене .invalid,
 * которого не существует и существовать не может, поэтому письмо либо
 * отвергается на месте, либо возвращается недоставленным — по одному
 * на прогон. Остальные отправки глушим заранее: ставим отметку «письмо
 * только что ушло», и минутная пауза между письмами делает своё дело.
 */

const URL = process.env.CHECK_URL ?? "http://127.0.0.1:3001";
const prisma = new PrismaClient();

const PASSWORD = `check-${randomUUID()}`;
const CODE = "424242";
const MARK = `verify${Date.now()}`;

const ok = (s: string, ещё?: unknown) =>
  console.log(`  ✔ ${s}${ещё === undefined ? "" : " " + JSON.stringify(ещё)}`);
const fail = (s: string, ещё?: unknown) => {
  console.log(`  ✘ ПРОВАЛ: ${s}${ещё === undefined ? "" : " " + JSON.stringify(ещё)}`);
  process.exitCode = 1;
};
const check = (условие: boolean, s: string, ещё?: unknown) =>
  условие ? ok(s, ещё) : fail(s, ещё);

interface Ответ {
  status: number;
  code: string;
  body: Record<string, unknown>;
}

async function запрос(
  path: string,
  options: { token?: string; body?: unknown; method?: string } = {},
): Promise<Ответ> {
  const res = await fetch(`${URL}/api${path}`, {
    method: options.method ?? (options.body ? "POST" : "GET"),
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const error = body.error as { code?: string } | undefined;
  return { status: res.status, code: error?.code ?? "", body };
}

/** Пускает ли сокет. Ждём именно причину отказа, а не просто отказ:
 *  «не пустили» из-за протухшего токена и «не пустили» из-за почты —
 *  разные вещи, и путать их нельзя. */
function сокет(token: string): Promise<{ впустили: boolean; причина?: string }> {
  return new Promise((resolve) => {
    const socket = io(URL, { auth: { token }, transports: ["websocket"], reconnection: false });
    const готово = (r: { впустили: boolean; причина?: string }) => {
      socket.disconnect();
      resolve(r);
    };
    socket.on("connect", () => готово({ впустили: true }));
    socket.on("connect_error", (e) => готово({ впустили: false, причина: e.message }));
    setTimeout(() => готово({ впустили: false, причина: "таймаут" }), 8000);
  });
}

// Вход теперь в два шага: пароль, потом код из письма. Второй шаг
// берёт на себя общий помощник — писем проверка не читает, зато
// у неё есть база, и она кладёт туда известный себе код.
const войтиКак = (login: string): Promise<string> => общийВход(URL, prisma, login, PASSWORD);

/** Заводим человека с готовым кодом на руках.
 *
 *  Код кладём сами, хешем: узнать настоящий можно было бы только из
 *  письма, а писем проверка не читает. Отметка «письмо только что
 *  ушло» — чтобы вход не отправил ещё одно. */
async function завести(ключ: string, имя: string, подтверждён: boolean) {
  const email = `${MARK}.${ключ}@example.invalid`;
  await prisma.user.create({
    data: {
      id: ulid(),
      email,
      username: `${MARK}.${ключ}`,
      displayName: имя,
      passwordHash: await hashPassword(PASSWORD),
      emailVerifiedAt: подтверждён ? new Date() : null,
      emailCodeHash: createHash("sha256").update(CODE).digest("hex"),
      emailCodeExpires: new Date(Date.now() + 15 * 60 * 1000),
      emailCodeSentAt: new Date(),
    },
  });
  return email;
}

/** Кого застава коснётся прямо сейчас.
 *
 *  Отдельным режимом, потому что спрашивать это надо до включения,
 *  а не после: включить и потом узнать, что заперли половину, —
 *  плохой порядок действий.
 *
 *      npm run check:verify -w @messenger/server -- кого */
async function кого() {
  const все = await prisma.user.count();
  const без = await prisma.user.findMany({
    where: { emailVerifiedAt: null },
    select: { username: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\n=== Кого коснётся ===\n  учётных записей: ${все}, без подтверждённой почты: ${без.length}`);
  for (const кто of без) {
    console.log(`  · ${кто.username} — с ${кто.createdAt.toISOString().slice(0, 10)}`);
  }
  console.log("");
}

async function main() {
  console.log("\n=== Подтверждение почты ===");

  // Почта на сервере не настроена — заставы нет вовсе, и это
  // не поломка, а её же предохранитель: иначе одна забытая строка
  // в .env заперла бы снаружи всех. Проверять тогда нечего.
  const политика = await запрос("/auth/password/forgot", {
    body: { login: `${MARK}@example.invalid` },
  });
  if (политика.body.mailEnabled !== true) {
    console.log("  · отправка почты на сервере не настроена — заставу проверять нечем\n");
    return;
  }

  const почта = await завести("novichok", "Новичок", false);
  const чужая = await завести("sosed", "Сосед", true);

  const token = await войтиКак(почта);

  /*
   * Вход теперь сам подтверждает почту — и правильно делает: человек
   * только что достал код из своего ящика, доказательство прямее
   * некуда. Но заставу мы проверяем не на нём, а на том, кто до входа
   * ещё не добрался: зарегистрировался, получил сессию сразу — и сидит
   * с неподтверждённым адресом.
   *
   * Поэтому возвращаем отметку обратно. Сделать это надо до первого
   * же запроса внутрь: сервер помнит, кого проверял, и «подтверждён»
   * он запомнил бы навсегда.
   */
  await prisma.user.update({ where: { email: почта }, data: { emailVerifiedAt: null } });

  // 1. Неподтверждённая почта больше не запирает: заставу убрали,
  //    и человек с непроверенным адресом пользуется мессенджером
  //    как все. Проверяем именно это — что дверь открыта.
  const внутрь = await запрос("/servers", { token });
  check(внутрь.status === 200, "неподтверждённая почта не запирает мессенджер", {
    статус: внутрь.status,
  });

  const дверь = await сокет(token);
  check(дверь.впустили, "и сокет пускает", дверь);

  const себя = await запрос("/auth/me", { token });
  check(себя.status === 200, "свои данные читаются — иначе экран подтверждения пуст", {
    статус: себя.status,
  });

  const ещёРаз = await запрос("/auth/email/send", { token, body: {} });
  check(
    ещёРаз.status === 429 || ещёРаз.status === 200,
    "кнопка «отправить ещё раз» отвечает по-человечески",
    { статус: ещёРаз.status, код: ещёРаз.code },
  );

  // 3. Код.
  const мимо = await запрос("/auth/email/verify", { token, body: { code: "000001" } });
  check(мимо.status === 400 && мимо.code === "BAD_CODE", "неверный код не подходит", {
    статус: мимо.status,
    код: мимо.code,
  });

  const верный = await запрос("/auth/email/verify", { token, body: { code: CODE } });
  check(верный.status === 200 && верный.body.emailVerified === true, "верный код подтверждает почту", {
    статус: верный.status,
  });

  // 4. Двери открылись — и сразу, без перезахода.
  const снова = await запрос("/servers", { token });
  check(снова.status === 200, "после подтверждения API пускает тем же токеном", {
    статус: снова.status,
  });

  const дверь2 = await сокет(token);
  check(дверь2.впустили, "и сокет пускает", дверь2);

  // 5. Смена адреса — только пока он не подтверждён.
  const поздно = await запрос("/auth/email/change", {
    token,
    body: { email: `${MARK}.drugoy@example.invalid`, password: PASSWORD },
  });
  check(
    поздно.status === 400 && поздно.code === "EMAIL_VERIFIED",
    "подтверждённый адрес так просто не меняется",
    { статус: поздно.status, код: поздно.code },
  );

  // Возвращаем в неподтверждённое состояние — как у того, кто
  // зарегистрировался с опечаткой в адресе.
  await prisma.user.update({ where: { email: почта }, data: { emailVerifiedAt: null } });

  const чужойПароль = await запрос("/auth/email/change", {
    token,
    body: { email: `${MARK}.drugoy@example.invalid`, password: "не тот пароль" },
  });
  check(чужойПароль.status === 401, "без пароля адрес не сменить", { статус: чужойПароль.status });

  const занято = await запрос("/auth/email/change", {
    token,
    body: { email: чужая, password: PASSWORD },
  });
  check(занято.status === 409 && занято.code === "EMAIL_TAKEN", "чужой адрес не занять", {
    статус: занято.status,
    код: занято.code,
  });

  const новый = `${MARK}.fixed@example.invalid`;
  const смена = await запрос("/auth/email/change", { token, body: { email: новый, password: PASSWORD } });
  check(смена.status === 200 && смена.body.email === новый, "адрес меняется на новый", {
    статус: смена.status,
  });

  const после = await prisma.user.findUnique({
    where: { email: новый },
    select: { emailVerifiedAt: true, emailCodeHash: true },
  });
  check(после !== null && после.emailVerifiedAt === null, "новый адрес заново требует подтверждения");
  check(
    после?.emailCodeHash !== createHash("sha256").update(CODE).digest("hex"),
    "старый код к новому адресу не подходит",
  );

  const послеСмены = await запрос("/servers", { token });
  check(послеСмены.status === 200, "и мессенджер при этом работает как работал", {
    статус: послеСмены.status,
  });
}

async function убрать() {
  const { count } = await prisma.user.deleteMany({ where: { username: { startsWith: MARK } } });
  const осталось = await prisma.user.count({ where: { username: { startsWith: MARK } } });
  check(осталось === 0, "временные учётные записи убраны", { удалено: count });
}

if (process.argv[2] === "кого") {
  await кого();
  await prisma.$disconnect();
} else {
  try {
    await main();
  } catch (error) {
    fail(String(error));
  } finally {
    await убрать();
    await prisma.$disconnect();
    console.log(process.exitCode ? "\nЕсть провалы\n" : "\nЗастава держит\n");
  }
}
