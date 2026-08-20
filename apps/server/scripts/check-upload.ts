import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import sharp from "sharp";
import { hashPassword } from "../src/lib/password.js";
import { войти } from "./login.js";

/**
 * Сквозная проверка загрузки картинки.
 *
 * Прогоняет настоящий путь: вход, POST на /api/uploads, потом скачивание
 * и оригинала, и превью через раздачу. Проверяет, что картинка приехала
 * пережатой, что превью отдаётся и весит меньше, и что запасной путь
 * работает — если превью нет, вместо пустоты приходит оригинал.
 *
 * Требует запущенного сервера. Учётную запись заводит сам и убирает.
 */

const URL_BASE = process.env.CHECK_URL ?? "http://127.0.0.1:3001";
const prisma = new PrismaClient();
const PASSWORD = `up-${randomUUID()}`;
const MARK = `upcheck${Date.now()}`;

let failed = false;
const ok = (s: string) => console.log(`  ✔ ${s}`);
const fail = (s: string) => {
  console.log(`  ✘ ПРОВАЛ: ${s}`);
  failed = true;
};
const кб = (n: number) => `${Math.round(n / 1024)} КБ`;

async function main(): Promise<void> {
  console.log(`\nСквозная проверка загрузки — ${URL_BASE}\n`);

  const user = await prisma.user.create({
    data: {
      id: ulid(),
      email: `${MARK}@example.invalid`,
      username: MARK,
      displayName: "Проверка загрузки",
      passwordHash: await hashPassword(PASSWORD),
      emailVerifiedAt: new Date(),
    },
  });

  try {
    const accessToken = await войти(URL_BASE, prisma, user.email, PASSWORD);
    const auth = { Authorization: `Bearer ${accessToken}` };

    // Скриншотоподобный PNG — худший случай для WebP.
    const текст = Array.from(
      { length: 30 },
      (_, i) =>
        `<text x="40" y="${40 + i * 32}" font-family="sans-serif" font-size="15" fill="#dbdee1">Строка ${i} — обычный текст</text>`,
    ).join("");
    const png = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#313338"/>${текст}</svg>`,
      ),
    )
      .png()
      .toBuffer();

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "скриншот.png");

    const upload = await fetch(`${URL_BASE}/api/uploads`, {
      method: "POST",
      headers: auth,
      body: form,
    });
    if (!upload.ok) throw new Error(`загрузка: HTTP ${upload.status} ${await upload.text()}`);

    const { attachment } = (await upload.json()) as {
      attachment: {
        id: string;
        mimeType: string;
        size: number;
        url: string;
        thumbUrl: string | null;
        width: number | null;
      };
    };

    if (attachment.mimeType !== "image/webp") fail(`сервер сохранил ${attachment.mimeType}`);
    else ok(`PNG ${кб(png.length)} → WebP ${кб(attachment.size)} — в ${(png.length / attachment.size).toFixed(1)} раза меньше`);

    if (attachment.width !== 1920) fail(`ширина потерялась: ${attachment.width}`);
    else ok("размеры дошли до клиента");

    if (!attachment.thumbUrl) return fail("превью не предложено клиенту");
    ok(`клиенту предложено превью: ${attachment.thumbUrl}`);

    const полная = await fetch(`${URL_BASE}${attachment.url}`, { headers: auth });
    const превью = await fetch(`${URL_BASE}${attachment.thumbUrl}`, { headers: auth });
    if (!полная.ok || !превью.ok) {
      return fail(`раздача: оригинал ${полная.status}, превью ${превью.status}`);
    }

    const полнаяБайт = (await полная.arrayBuffer()).byteLength;
    const превьюБайт = (await превью.arrayBuffer()).byteLength;

    if (превьюБайт >= полнаяБайт) fail(`превью не легче: ${превьюБайт} против ${полнаяБайт}`);
    else {
      ok(
        `раздача отдаёт оба: оригинал ${кб(полнаяБайт)}, превью ${кб(превьюБайт)} — ` +
          `в ленту едет в ${(полнаяБайт / превьюБайт).toFixed(1)} раза меньше`,
      );
    }

    if (превью.headers.get("content-type") !== "image/webp") {
      fail(`превью отдано как ${превью.headers.get("content-type")}`);
    } else ok("тип превью верный");

    // Запасной путь: превью нет на диске — должен приехать оригинал.
    const { deleteFile } = await import("../src/lib/storage.js");
    await deleteFile(attachment.thumbUrl.replace("/uploads/", ""));
    const после = await fetch(`${URL_BASE}${attachment.thumbUrl}`, { headers: auth });
    const послеБайт = (await после.arrayBuffer()).byteLength;
    if (!после.ok) fail("превью пропало — раздача ответила ошибкой вместо оригинала");
    else if (послеБайт !== полнаяБайт) fail(`вместо оригинала приехало ${послеБайт} байт`);
    else ok("превью пропало — вместо пустоты приезжает оригинал");
  } finally {
    const files = await prisma.attachment.findMany({
      where: { uploaderId: user.id },
      select: { storageKey: true },
    });
    const { deleteFile } = await import("../src/lib/storage.js");
    for (const f of files) await deleteFile(f.storageKey);
    await prisma.attachment.deleteMany({ where: { uploaderId: user.id } });
    await prisma.user.deleteMany({ where: { username: MARK } });
    await prisma.$disconnect();
  }

  console.log(failed ? "\nЕсть провалы\n" : "\nВсё сходится\n");
  process.exitCode = failed ? 1 : 0;
}

void main().catch(async (error) => {
  console.error("\nПроверка не запустилась:", error instanceof Error ? error.message : error);
  await prisma.user.deleteMany({ where: { username: MARK } }).catch(() => undefined);
  await prisma.$disconnect();
  process.exitCode = 1;
});
