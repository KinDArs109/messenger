import { PrismaClient } from "@prisma/client";

/**
 * Отметить почту подтверждённой вручную — ключ от заставы у хозяина.
 *
 *   npm run db:verified -w @messenger/server -- <логин или почта>
 *
 * Нужен ровно для одного случая, зато безвыходного: человек
 * зарегистрировался с адресом, которого не существует (опечатка,
 * закрытый ящик, чужая почта), а пароль забыл. Сменить адрес он
 * не может — на это нужен пароль; восстановить пароль тоже —
 * письмо уйдёт на тот самый несуществующий адрес. Круг замкнулся,
 * и разомкнуть его можно только снаружи.
 *
 * Кнопкой в мессенджере это не делается намеренно: возможность
 * объявить чужую почту проверенной, не проверив её, — не то, что
 * стоит держать в интерфейсе. Здесь она требует доступа к серверу,
 * то есть того же, что и доступ к базе напрямую.
 */

const prisma = new PrismaClient();
const кто = process.argv[2]?.trim().toLowerCase();

if (!кто) {
  console.log("Укажите логин или почту: npm run db:verified -w @messenger/server -- ivan");
  process.exit(1);
}

const user = кто.includes("@")
  ? await prisma.user.findUnique({ where: { email: кто } })
  : await prisma.user.findUnique({ where: { username: кто } });

if (!user) {
  console.log(`Не нашёл: ${кто}`);
  process.exit(1);
}

if (user.emailVerifiedAt) {
  console.log(`${user.username}: почта и так подтверждена (${user.emailVerifiedAt.toISOString()})`);
} else {
  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: new Date(),
      emailCodeHash: null,
      emailCodeExpires: null,
      emailCodeAttempts: 0,
    },
  });
  console.log(`${user.username}: почта отмечена подтверждённой`);
  // Сервер помнит, кого уже проверял, но помнит только «да».
  // Отметка снаружи попадёт в эту память при первом же его запросе,
  // так что перезапуск не нужен.
}

await prisma.$disconnect();
