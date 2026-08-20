import { randomUUID } from "node:crypto";
import { readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { ulid } from "ulid";
import { io, type Socket } from "socket.io-client";
import { hashPassword } from "../src/lib/password.js";
import { UPLOADS_DIR } from "../src/lib/storage.js";
import { pictureKeysInUse } from "../src/lib/pictures.js";
import { войти } from "./login.js";

/**
 * Проверка аватаров и настроек сервера.
 *
 *   npm run check:pictures -w @messenger/server
 *
 * Проверяется не только то, что картинка ставится, но и то, что чужую
 * поставить нельзя, что переименовать сервер может не всякий, что
 * заменённый аватар не остаётся лежать на диске и что уборка не сметёт
 * действующие аватары — она сметает всё, что не привязано к сообщению,
 * а аватар именно таков.
 */

const URL_BASE = process.env.CHECK_URL ?? "http://127.0.0.1:3001";
const prisma = new PrismaClient();
const PASSWORD = `check-${randomUUID()}`;
const MARK = `pict-${Date.now()}`;

let failed = false;
const ok = (s: string) => console.log(`  ✔ ${s}`);
const fail = (s: string) => {
  console.log(`  ✘ ПРОВАЛ: ${s}`);
  failed = true;
};

// Вход теперь в два шага: пароль, потом код из письма. Писем
// проверка не читает — за неё это делает общий помощник, которому
// доступна база.
const login = (who: string): Promise<string> => войти(URL_BASE, prisma, who, PASSWORD);

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Заведомо не квадратная картинка: обрезку иначе не проверить. */
async function picture(colour: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: { width: 600, height: 200, channels: 3, background: colour },
  })
    .png()
    .toBuffer();
}

async function upload(token: string, bytes: Buffer): Promise<Response> {
  const body = new FormData();
  body.append("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), "avatar.png");
  return fetch(`${URL_BASE}/api/uploads/picture`, { method: "POST", headers: auth(token), body });
}

function waitFor<T>(socket: Socket, event: string, ms = 5000): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, ms);
    const handler = (data: T) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    };
    socket.on(event, handler);
  });
}

async function main(): Promise<void> {
  console.log(`\nПроверка аватаров и настроек сервера — ${URL_BASE}\n`);

  const passwordHash = await hashPassword(PASSWORD);
  const make = (n: number) =>
    prisma.user.create({
      data: {
        id: ulid(),
        email: `${MARK}-${n}@example.invalid`,
        username: `${MARK}-${n}`,
        displayName: `Проверка ${n}`,
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });

  const [owner, member] = await Promise.all([make(1), make(2)]);

  const server = await prisma.server.create({
    data: {
      id: ulid(),
      name: MARK,
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: "OWNER" },
          { userId: member.id, role: "MEMBER" },
        ],
      },
      channels: { create: [{ id: ulid(), type: "TEXT", name: "общий", position: 0 }] },
    },
  });

  const sockets: Socket[] = [];

  try {
    const ownerToken = await login(owner.email);
    const memberToken = await login(member.email);

    // ── Загрузка ──────────────────────────────────────────────
    const res = await upload(ownerToken, await picture({ r: 200, g: 60, b: 60 }));
    if (!res.ok) throw new Error(`загрузка картинки: HTTP ${res.status}`);
    const { url } = (await res.json()) as { url: string };

    if (/^\/uploads\/[0-9A-HJKMNP-TV-Z]{26}\.webp$/.test(url)) ok(`картинка загружена: ${url}`);
    else fail(`ссылка не той формы: ${url}`);

    const key = url.slice("/uploads/".length);
    // Читаем байтами, а не отдаём sharp путь: sharp держит открытый
    // файл в своём кеше, а Windows не даёт удалить открытый файл —
    // и проверка «прежний аватар убран» проваливалась из-за самой
    // же проверки.
    const meta = await sharp(await readFile(path.join(UPLOADS_DIR, key))).metadata();
    if (meta.width === 256 && meta.height === 256) ok("обрезана в квадрат 256×256");
    else fail(`размер после обработки ${meta.width}×${meta.height}, а не 256×256`);

    // ── Аватар профиля ────────────────────────────────────────
    const set = await fetch(`${URL_BASE}/api/users/me`, {
      method: "PATCH",
      headers: { ...auth(ownerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ avatarUrl: url }),
    });
    if (set.ok) ok("аватар поставлен");
    else fail(`аватар не поставился: HTTP ${set.status}`);

    const after = await prisma.user.findUnique({ where: { id: owner.id } });
    if (after?.avatarUrl === url) ok("аватар записан в профиль");
    else fail(`в профиле лежит ${after?.avatarUrl ?? "ничего"}`);

    // ── Чужую картинку ставить нельзя ─────────────────────────
    const stolen = await fetch(`${URL_BASE}/api/users/me`, {
      method: "PATCH",
      headers: { ...auth(memberToken), "Content-Type": "application/json" },
      body: JSON.stringify({ avatarUrl: url }),
    });
    if (stolen.status === 400) ok("чужую картинку поставить себе нельзя");
    else fail(`чужая картинка принята: HTTP ${stolen.status}`);

    // ── Подмена аватара убирает старый файл ───────────────────
    const second = await upload(ownerToken, await picture({ r: 60, g: 160, b: 90 }));
    if (!second.ok) throw new Error(`вторая загрузка: HTTP ${second.status}`);
    const { url: freshUrl } = (await second.json()) as { url: string };
    const replaced = await fetch(`${URL_BASE}/api/users/me`, {
      method: "PATCH",
      headers: { ...auth(ownerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ avatarUrl: freshUrl }),
    });
    if (!replaced.ok) {
      throw new Error(`замена аватара: HTTP ${replaced.status} ${await replaced.text()}`);
    }

    const gone = await stat(path.join(UPLOADS_DIR, key)).then(
      () => false,
      () => true,
    );
    const row = await prisma.attachment.findUnique({ where: { storageKey: key } });
    if (gone && !row) ok("прежний аватар убран — и запись, и файл");
    else fail(`прежний аватар остался: запись ${row ? "есть" : "нет"}, файл ${gone ? "нет" : "есть"}`);

    // ── Настройки сервера ─────────────────────────────────────
    const watcher = io(URL_BASE, {
      auth: { token: memberToken },
      transports: ["websocket"],
      reconnection: false,
    });
    sockets.push(watcher);
    await new Promise<void>((готово) => watcher.on("connect", () => готово()));
    const broadcast = waitFor<{ id: string; name: string; iconUrl: string | null }>(
      watcher,
      "server:update",
    );

    const renamed = `${MARK}-новое`;
    const rename = await fetch(`${URL_BASE}/api/servers/${server.id}`, {
      method: "PATCH",
      headers: { ...auth(ownerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ name: renamed }),
    });
    if (rename.ok) ok("сервер переименован");
    else fail(`переименование не прошло: HTTP ${rename.status}`);

    const heard = await broadcast;
    if (heard?.name === renamed) ok("остальные участники узнали о переименовании");
    else fail(`участнику пришло ${heard ? heard.name : "ничего"}`);

    // ── Обычному участнику переименовывать нельзя ─────────────
    const denied = await fetch(`${URL_BASE}/api/servers/${server.id}`, {
      method: "PATCH",
      headers: { ...auth(memberToken), "Content-Type": "application/json" },
      body: JSON.stringify({ name: `${MARK}-чужое` }),
    });
    if (denied.status === 403) ok("обычный участник переименовать не может");
    else fail(`участнику разрешили переименовать: HTTP ${denied.status}`);

    // ── Значок сервера ────────────────────────────────────────
    const iconRes = await upload(ownerToken, await picture({ r: 80, g: 80, b: 200 }));
    const { url: iconUrl } = (await iconRes.json()) as { url: string };
    const icon = await fetch(`${URL_BASE}/api/servers/${server.id}`, {
      method: "PATCH",
      headers: { ...auth(ownerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ iconUrl }),
    });
    if (icon.ok) ok("значок сервера поставлен");
    else fail(`значок не поставился: HTTP ${icon.status}`);

    // ── Уборка не должна сметать действующие картинки ─────────
    const inUse = await pictureKeysInUse();
    const missing = [freshUrl, iconUrl]
      .map((u) => u.slice("/uploads/".length))
      .filter((k) => !inUse.has(k));
    if (missing.length === 0) ok("уборка считает действующие аватары занятыми");
    else fail(`уборка снесла бы: ${missing.join(", ")}`);

    // ── Раздача отдаёт картинку ───────────────────────────────
    const served = await fetch(`${URL_BASE}${freshUrl}`);
    const type = served.headers.get("content-type");
    if (served.ok && type === "image/webp") ok("картинка отдаётся браузеру");
    else fail(`раздача ответила HTTP ${served.status}, тип ${type}`);
  } finally {
    for (const socket of sockets) socket.disconnect();
    // Файлы этих учётных записей — следом за ними: записи уйдут
    // каскадом, а файлы на диске останутся.
    const files = await prisma.attachment.findMany({
      where: { uploader: { username: { startsWith: MARK } } },
      select: { storageKey: true },
    });
    await prisma.server.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.user.deleteMany({ where: { username: { startsWith: MARK } } });
    for (const file of files) {
      await unlink(path.join(UPLOADS_DIR, file.storageKey)).catch(() => undefined);
    }
    await prisma.$disconnect();
  }

  console.log(failed ? "\nЕсть провалы\n" : "\nВсё сходится\n");
  process.exitCode = failed ? 1 : 0;
  // Сокеты закрыты, но соединение с базой держит процесс живым
  // ровно до таймаута пула — выходим сами.
  process.exit(failed ? 1 : 0);
}

void main().catch(async (error: unknown) => {
  console.error("\nПроверка не запустилась:", error instanceof Error ? error.message : error);
  await prisma.server.deleteMany({ where: { name: { startsWith: MARK } } }).catch(() => undefined);
  await prisma.user
    .deleteMany({ where: { username: { startsWith: MARK } } })
    .catch(() => undefined);
  await prisma.$disconnect();
  process.exitCode = 1;
});
