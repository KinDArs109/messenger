import { createHash, randomUUID } from "node:crypto";
import { io } from "socket.io-client";
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import { hashPassword } from "../src/lib/password.js";

/**
 * Проверка того, из-за чего связь пропадала после долгого простоя.
 *
 *   Сервер запускают с коротким сроком жизни токена, иначе ждать
 *   пришлось бы пятнадцать минут:
 *
 *     ACCESS_TOKEN_TTL=20s npx tsx --env-file=.env src/index.ts
 *     CHECK_TTL=20 npm run check:idle -w @messenger/server
 *
 * Что случилось. Access-токен живёт пятнадцать минут и обновляется
 * по ходу дела: запрос получил отказ — обновились, повторили. Пока
 * человек что-то делает, этого хватает. У свёрнутого мессенджера
 * запросов нет: токен тихо протухает, а сокет живёт своей жизнью.
 * Стоит связи моргнуть — он переподключается с мёртвым токеном,
 * получает отказ и стучится так до бесконечности. Снаружи: «свернул
 * на час, развернул — связи нет».
 *
 * Проверка идёт тем же путём, только без окна: берёт токен, ждёт,
 * пока он протухнет, и стучится в сокет — сначала им, потом обновив
 * сессию. Первое должно не пустить, второе — пустить. Ровно это
 * и делает теперь клиент перед каждым подключением.
 */

const URL = process.env.CHECK_URL ?? "http://127.0.0.1:3001";
const TTL = Number(process.env.CHECK_TTL ?? 20);
const prisma = new PrismaClient();

const PASSWORD = `check-${randomUUID()}`;
const КОД = "424242";
const MARK = `idle${Date.now()}`;

const результаты: boolean[] = [];
const ok = (пункт: string, значение: unknown, ещё?: unknown) => {
  результаты.push(Boolean(значение));
  console.log(
    `${значение ? "  ✔" : "  ✘ ПРОВАЛ"} ${пункт}${ещё === undefined ? "" : " " + JSON.stringify(ещё)}`,
  );
};

const подождать = (мс: number) => new Promise((r) => setTimeout(r, мс));

/** Пускает ли сокет с этим токеном. */
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

async function main() {
  console.log("\n=== Связь после простоя ===");

  const email = `${MARK}@example.invalid`;
  await prisma.user.create({
    data: {
      id: ulid(),
      email,
      username: MARK,
      displayName: "Простой",
      passwordHash: await hashPassword(PASSWORD),
      emailVerifiedAt: new Date(),
      // Код на вход — за почтовый ящик, как и в остальных проверках.
      loginCodeHash: createHash("sha256").update(КОД).digest("hex"),
      loginCodeExpires: new Date(Date.now() + 60 * 60 * 1000),
      loginCodeSentAt: new Date(),
    },
  });

  // Вход целиком, руками: нужна не только выдача токена, но и cookie —
  // ею потом обновляют сессию, как это делает клиент.
  const первый = await fetch(`${URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: email, password: PASSWORD }),
  });
  const шаг = (await первый.json()) as { ticket?: string; accessToken?: string };

  let token = шаг.accessToken ?? "";
  let cookie = первый.headers.getSetCookie().join("; ");

  if (!token) {
    const второй = await fetch(`${URL}/api/auth/login/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: шаг.ticket, code: КОД }),
    });
    const тело = (await второй.json()) as { accessToken?: string };
    token = тело.accessToken ?? "";
    cookie = второй.headers.getSetCookie().join("; ");
  }

  ok("вошли и получили токен", Boolean(token));
  ok("и cookie сессии", cookie.includes("refresh_token"));

  const сразу = await сокет(token);
  ok("свежий токен пускает в сокет", сразу.впустили, сразу);

  // Столько же, сколько мессенджер провёл бы свёрнутым: ничего
  // не делаем, токен просто стареет.
  const ждём = (TTL + 5) * 1000;
  console.log(`  · ждём ${Math.round(ждём / 1000)} с — столько же не делал бы ничего свёрнутый мессенджер`);
  await подождать(ждём);

  const протух = await сокет(token);
  ok("протухший токен в сокет не пускают", !протух.впустили && протух.причина === "UNAUTHORIZED", протух);

  /*
   * А вот это и есть починка. Раньше клиент в этом месте подставлял
   * тот же самый мёртвый токен — и получал отказ за отказом, пока
   * человек не трогал мессенджер руками. Теперь он сначала обновляет
   * сессию по cookie и подключается уже с новым токеном.
   */
  const обновление = await fetch(`${URL}/api/auth/refresh`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const свежий = ((await обновление.json()) as { accessToken?: string }).accessToken ?? "";
  ok("сессия обновляется по cookie, без пароля", Boolean(свежий), { статус: обновление.status });
  ok("и токен получился другой", свежий !== token);

  const снова = await сокет(свежий);
  ok("с обновлённым токеном сокет снова пускает", снова.впустили, снова);
}

async function убрать() {
  const { count } = await prisma.user.deleteMany({ where: { username: { startsWith: MARK } } });
  const осталось = await prisma.user.count({ where: { username: { startsWith: MARK } } });
  ok("временная учётная запись убрана", осталось === 0, { удалено: count });
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
    `\n${провалов === 0 ? "Связь возвращается" : `Провалов: ${провалов}`} — проверок ${результаты.length}\n`,
  );
  process.exitCode = провалов === 0 ? 0 : 1;
}
