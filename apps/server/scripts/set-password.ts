/**
 * Смена пароля учётной записи.
 *
 *     npm run db:password -- почта@example.com
 *
 * Пароль спрашивается интерактивно и не печатается на экране.
 * Аргументом его передавать нельзя намеренно: командная строка видна
 * в списке процессов и остаётся в истории оболочки.
 *
 * Скрипт нужен потому, что восстановить забытый пароль невозможно —
 * в базе лежит только его хеш. Единственный выход — задать новый.
 */

import { createInterface } from "node:readline";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password.js";
import { LIMITS } from "@messenger/shared";

const prisma = new PrismaClient();

/** Чтение без эха. readline умеет прятать ввод только через
 *  перехват вывода: штатной опции «скрытый пароль» в Node нет. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const output = rl as unknown as { output: NodeJS.WriteStream; _writeToOutput?: unknown };

    process.stdout.write(question);
    output._writeToOutput = () => {};

    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("Укажите почту: npm run db:password -- почта@example.com");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`Учётной записи с почтой ${email} нет.`);
    process.exit(1);
  }

  console.log(`Учётная запись: ${user.displayName} (@${user.username})`);

  const password = await askHidden("Новый пароль: ");
  const again = await askHidden("Ещё раз: ");

  if (password !== again) {
    console.error("Пароли не совпали. Ничего не изменено.");
    process.exit(1);
  }
  if (password.length < LIMITS.password.min) {
    console.error(`Минимум ${LIMITS.password.min} символов. Ничего не изменено.`);
    process.exit(1);
  }
  if (/[а-яё]/i.test(password)) {
    // Не запрет, а предупреждение: кириллица в пароле законна,
    // но чаще всего означает забытую раскладку.
    console.warn("Внимание: в пароле кириллица. Проверьте раскладку.");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password) },
  });

  // Старые сессии отзываем: смена пароля — это чаще всего ответ на
  // «кто-то мог зайти», и оставлять чужие входы живыми нельзя.
  const { count } = await prisma.refreshToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  console.log(`Пароль изменён. Отозвано сессий: ${count}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
