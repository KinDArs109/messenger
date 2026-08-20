import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import { hashPassword } from "../src/lib/password.js";
import { войти } from "./login.js";

/**
 * Проверка ретранслятора голоса.
 *
 *   npm run check:turn -w @messenger/server
 *
 * Ретранслятор нужен там, где прямое соединение не строится. Проверить
 * это можно только одним честным способом: взять настоящий движок
 * WebRTC, запретить ему ходить напрямую и посмотреть, свяжется ли он
 * вообще. Если свяжется — значит весь путь работает: выдача временных
 * паролей, разрешения, каналы и перекладывание байтов.
 *
 * Заодно проверяется обратное: с неправильным паролем не должно
 * связываться ничего. Ретранслятор торчит в интернете, и открытый
 * канал за наш счёт — это не мелочь.
 */

const URL_BASE = process.env.CHECK_URL ?? "http://127.0.0.1:3001";
const prisma = new PrismaClient();
const PASSWORD = `check-${randomUUID()}`;
const MARK = `turn-${Date.now()}`;

let failed = false;
const ok = (s: string) => console.log(`  ✔ ${s}`);
const fail = (s: string) => {
  console.log(`  ✘ ПРОВАЛ: ${s}`);
  failed = true;
};

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

interface ProbeResult {
  ok: boolean;
  связались?: boolean;
  сообщение?: string | null;
  пара?: { свой: string | null; чужой: string | null; байт: number } | null;
  ошибки?: string[];
  error?: string;
}

/**
 * Запустить оболочку с настоящим движком WebRTC и дождаться ответа.
 *
 * Электрон должен быть уже установлен. Раньше проверки на это не было,
 * и на машине без него npx молча уходил качать четверть гигабайта —
 * на боевом сервере это съело полгигабайта диска и всё равно
 * не сработало. Проверять ретранслятор надо оттуда, где собирают
 * приложение: движок браузера здесь не деталь реализации, а суть
 * проверки — весь смысл в том, что путь ищет настоящий WebRTC.
 */
function probe(iceServers: IceServer[]): Promise<ProbeResult> {
  const desktop = path.join(import.meta.dirname, "../../desktop");

  const установлен = ["node_modules/electron", "../../node_modules/electron"].some((p) =>
    existsSync(path.join(desktop, p)),
  );
  if (!установлен) {
    return Promise.resolve({
      ok: false,
      error:
        "Electron не установлен. Эту проверку надо запускать там, где собирается " +
        "приложение (обычно рабочий компьютер), а не на сервере: ей нужен настоящий " +
        "движок браузера. Установить: npm install в apps/desktop.",
    });
  }

  return new Promise((resolve) => {
    const child = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["electron", "scripts/turn-probe.cjs"],
      {
        cwd: desktop,
        env: {
          ...process.env,
          PROBE: JSON.stringify({ iceServers, page: `${URL_BASE}/health` }),
        },
        shell: process.platform === "win32",
      },
    );

    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", () => undefined);
    child.on("close", () => {
      const line = output.split("\n").find((l) => l.startsWith("ПРОБА:"));
      if (!line) {
        resolve({ ok: false, error: `оболочка не ответила: ${output.slice(-200)}` });
        return;
      }
      resolve(JSON.parse(line.slice("ПРОБА:".length)) as ProbeResult);
    });
  });
}

async function main(): Promise<void> {
  console.log(`\nПроверка ретранслятора голоса — ${URL_BASE}\n`);

  const passwordHash = await hashPassword(PASSWORD);
  const user = await prisma.user.create({
    data: {
      id: ulid(),
      email: `${MARK}@example.invalid`,
      username: MARK,
      displayName: "Проверка TURN",
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  });

  try {
    const accessToken = await войти(URL_BASE, prisma, user.email, PASSWORD);

    const res = await fetch(`${URL_BASE}/api/voice/ice`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`список серверов: HTTP ${res.status}`);
    const { iceServers } = (await res.json()) as { iceServers: IceServer[] };

    const turn = iceServers.filter((server) =>
      [server.urls].flat().some((url) => url.startsWith("turn:")),
    );

    if (turn.length === 0) {
      fail("сервер не выдаёт ретранслятор — не задан TURN_SECRET в .env");
      return;
    }
    ok(`сервер выдал ретранслятор: ${[turn[0]!.urls].flat().join(", ")}`);

    // ── Настоящий путь ────────────────────────────────────────
    const relayed = await probe(turn);
    if (!relayed.ok) {
      fail(
        `через ретранслятор не связались: ${relayed.error ?? ""} ` +
          `${JSON.stringify(relayed.ошибки ?? [])}`,
      );
    } else {
      ok(`два соединения связались через ретранслятор, сообщение дошло: «${relayed.сообщение}»`);
    }

    const pair = relayed.пара;
    if (pair && pair.свой === "relay" && pair.чужой === "relay") {
      ok(`путь лёг через ретранслятор с обеих сторон, отправлено ${pair.байт} байт`);
    } else {
      fail(`путь оказался не через ретранслятор: ${JSON.stringify(pair)}`);
    }

    // ── Чужой пароль ──────────────────────────────────────────
    const forged = turn.map((server) => ({ ...server, credential: "не тот пароль" }));
    const denied = await probe(forged);
    if (denied.ok || denied.связались) {
      fail("с неправильным паролем ретранслятор всё равно пустил");
    } else {
      ok("с неправильным паролем ретранслятор не пускает");
    }

    // ── Протухший логин ───────────────────────────────────────
    const stale = turn.map((server) => ({ ...server, username: "1000000000:кто-то" }));
    const staleResult = await probe(stale);
    if (staleResult.ok || staleResult.связались) {
      fail("просроченные данные всё равно приняты");
    } else {
      ok("просроченные данные не принимаются");
    }
  } finally {
    await prisma.user.deleteMany({ where: { username: { startsWith: MARK } } });
    await prisma.$disconnect();
  }

  console.log(failed ? "\nЕсть провалы\n" : "\nВсё сходится\n");
  process.exit(failed ? 1 : 0);
}

void main().catch(async (error: unknown) => {
  console.error("\nПроверка не запустилась:", error instanceof Error ? error.message : error);
  await prisma.user.deleteMany({ where: { username: { startsWith: MARK } } }).catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});
