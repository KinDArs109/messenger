import { PrismaClient } from "@prisma/client";

/** Замер стабильности соединения с базой.
 *
 *  Нужен, когда запросы падают с P1017 «Server has closed the
 *  connection»: он показывает, рвётся ли соединение вообще и через
 *  сколько. Прикладной код тут ни при чём — проверяется канал.
 *
 *  Запуск: npm run check:db
 */
const prisma = new PrismaClient();

async function main() {
  const started = Date.now();
  const seconds = () => ((Date.now() - started) / 1000).toFixed(1);

  console.log("  Раз в секунду делаю простейший запрос. Всего 40.\n");

  for (let i = 1; i <= 40; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      if (i % 10 === 0) console.log(`  ${i} запросов — ${seconds()}с, всё живо`);
    } catch (error) {
      console.log(`\n  Оборвалось на запросе ${i}, через ${seconds()}с`);
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  Причина: ${message.split("\n").filter(Boolean).pop()}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\n  40 из 40 за ${seconds()}с — соединение стабильно.`);
}

main()
  .catch((error: unknown) => {
    console.error("  Не удалось даже подключиться:", error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
