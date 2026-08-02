import { createServer } from "node:http";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { createRealtime } from "./realtime/index.js";
import { setRealtime } from "./realtime/emitter.js";
import { prisma } from "./db/client.js";

const app = createApp();
const httpServer = createServer(app);
const io = createRealtime(httpServer);
setRealtime(io);

// Занятый порт — обычная ситуация при перезапуске: предыдущий процесс
// ещё не отпустил сокет. Без этого обработчика Node вываливает стек
// на двадцать строк, в котором сама причина теряется.
httpServer.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `\n  Порт ${env.PORT} уже занят. Возможно, сервер уже запущен в другом окне.\n` +
        `  Найти и остановить:  npx kill-port ${env.PORT}\n`,
    );
    process.exit(1);
  }
  throw error;
});

httpServer.listen(env.PORT, () => {
  const isProduction = env.NODE_ENV === "production";
  console.log(`  Режим:   ${env.NODE_ENV}`);
  console.log(`  API:     http://localhost:${env.PORT}`);
  // В продакшене клиент отдаёт этот же процесс, в разработке — Vite.
  console.log(
    `  Клиент:  ${isProduction ? `http://localhost:${env.PORT}` : env.CLIENT_ORIGIN}\n`,
  );
});

/** Корректное завершение: дать текущим запросам договорить,
 *  закрыть сокеты и пул соединений с базой. Без этого pm2 при
 *  перезапуске будет оставлять висящие подключения к Postgres. */
async function shutdown(signal: string) {
  console.log(`\n  ${signal} — останавливаюсь...`);
  io.close();
  httpServer.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
