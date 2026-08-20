import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/**
 * Положить человеку известный код на вход — для проверок оболочки.
 *
 *   npm run db:login-code -w @messenger/server -- <логин или почта> [код]
 *
 * Вход теперь в два шага, и второй — код из письма. Проверки, которые
 * ходят на живой сайт снаружи (окно приложения, оверлей, уведомления),
 * писем не читают и до базы не дотягиваются. Им код кладут заранее
 * этой командой — а дальше они вводят его так же, как человек
 * переписал бы из письма: сервер проверяет его обычным порядком.
 *
 * Действующий код сервер не заменяет новым, поэтому положенный
 * доживает до конца прогона.
 *
 * Кнопки в мессенджере для этого нет и быть не должно: тот, кто может
 * это сделать, и так распоряжается базой целиком.
 */

const prisma = new PrismaClient();
const кто = process.argv[2]?.trim().toLowerCase();
const код = process.argv[3]?.trim() ?? "424242";

if (!кто || !/^\d{6}$/.test(код)) {
  console.log("Как звать: npm run db:login-code -w @messenger/server -- ivan [424242]");
  process.exit(1);
}

const user = кто.includes("@")
  ? await prisma.user.findUnique({ where: { email: кто } })
  : await prisma.user.findUnique({ where: { username: кто } });

if (!user) {
  console.log(`Не нашёл: ${кто}`);
  process.exit(1);
}

await prisma.user.update({
  where: { id: user.id },
  data: {
    loginCodeHash: createHash("sha256").update(код).digest("hex"),
    // Час, а не пятнадцать минут: прогон проверок бывает долгим,
    // а это не человек, ждущий письмо.
    loginCodeExpires: new Date(Date.now() + 60 * 60 * 1000),
    loginCodeSentAt: new Date(),
    loginCodeAttempts: 0,
  },
});

console.log(`${user.username}: код на вход — ${код}, действует час`);

await prisma.$disconnect();
