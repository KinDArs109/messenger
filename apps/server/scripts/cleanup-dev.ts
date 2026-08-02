import { readdir } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { UPLOADS_DIR, deleteFile } from "../src/lib/storage.js";

/** Уборка за ручными проверками.
 *
 *  По умолчанию удаляется только то, что мусором является заведомо:
 *  неприкреплённые вложения и файлы на диске без записи в базе.
 *  Учётные записи, серверы и переписки не трогаются — среди них
 *  давно могут быть настоящие, а не тестовые.
 *
 *  Полная зачистка до состояния сидов — только с явным флагом:
 *      npm run db:cleanup -- --hard
 */
const prisma = new PrismaClient();

const HARD = process.argv.includes("--hard");
const KEEP_USERS = ["anna", "boris", "vera"];
const KEEP_CHANNELS = ["общий", "флуд", "Разговор"];

async function main() {
  let removed = { servers: 0, channels: 0, dms: 0, users: 0, invites: 0 };

  if (HARD) {
    const seedServer = await prisma.server.findFirst({
      where: { name: "Тестовый сервер" },
      select: { id: true },
    });
    if (!seedServer) throw new Error("Сервер из сидов не найден — сначала npm run db:seed");

    const users = await prisma.user.findMany({
      where: { username: { notIn: KEEP_USERS } },
      select: { username: true },
    });
    if (users.length > 0) {
      console.log("  Будут удалены учётные записи:", users.map((u) => u.username).join(", "));
    }

    removed = {
      servers: (await prisma.server.deleteMany({ where: { id: { not: seedServer.id } } })).count,
      channels: (
        await prisma.channel.deleteMany({
          where: { serverId: seedServer.id, name: { notIn: KEEP_CHANNELS } },
        })
      ).count,
      dms: (await prisma.channel.deleteMany({ where: { serverId: null } })).count,
      users: (await prisma.user.deleteMany({ where: { username: { notIn: KEEP_USERS } } })).count,
      invites: (await prisma.invite.deleteMany({})).count,
    };
  }

  // Вложение создаётся при загрузке, а привязывается при отправке.
  // Если человек передумал и не отправил, файл остаётся висеть.
  const orphans = await prisma.attachment.findMany({
    where: { messageId: null },
    select: { id: true, storageKey: true },
  });
  for (const orphan of orphans) await deleteFile(orphan.storageKey);
  await prisma.attachment.deleteMany({ where: { id: { in: orphans.map((o) => o.id) } } });

  // Отдельно подметаем диск: при удалении сообщения запись уходит
  // каскадом, а файл остаётся лежать.
  const known = new Set(
    (await prisma.attachment.findMany({ select: { storageKey: true } })).map((a) => a.storageKey),
  );
  const onDisk = await readdir(UPLOADS_DIR).catch(() => [] as string[]);
  let sweptFiles = 0;
  for (const name of onDisk) {
    if (known.has(name)) continue;
    await deleteFile(name);
    sweptFiles += 1;
  }

  console.log(`\n  Режим: ${HARD ? "полная зачистка (--hard)" : "безопасный"}`);
  console.log(`  Брошенных вложений: ${orphans.length}, файлов с диска: ${sweptFiles}`);
  if (HARD) {
    console.log(
      `  Серверов: ${removed.servers}, каналов: ${removed.channels}, переписок: ${removed.dms},`,
    );
    console.log(`  учётных записей: ${removed.users}, приглашений: ${removed.invites}`);
  } else {
    console.log("  Учётные записи, серверы и переписки не тронуты (нужен --hard)");
  }

  console.log("");
  console.table({
    Пользователи: await prisma.user.count(),
    Серверы: await prisma.server.count(),
    Каналы: await prisma.channel.count(),
    Сообщения: await prisma.message.count(),
    Вложения: await prisma.attachment.count(),
  });
}

main()
  .catch((error: unknown) => {
    console.error("Уборка не удалась:", error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
