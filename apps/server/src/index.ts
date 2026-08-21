import { createServer } from "node:http";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { createRealtime } from "./realtime/index.js";
import { setRealtime } from "./realtime/emitter.js";
import { prisma } from "./db/client.js";
import { TurnServer, localIPv4, setTurnServer } from "./turn/server.js";
import { раздачаЕсть } from "./realtime/sfu.js";

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

/** Ретранслятор голоса. Живёт в этом же процессе: отдельный демон
 *  на домашней машине — это ещё одна вещь, которую надо не забыть
 *  запустить, а забывают всегда. */
const turn = env.TURN_SECRET
  ? new TurnServer({
      port: env.TURN_PORT,
      realm: env.TURN_REALM,
      secret: env.TURN_SECRET,
      publicIp: env.TURN_HOST,
    })
  : null;

httpServer.listen(env.PORT, () => {
  const isProduction = env.NODE_ENV === "production";

  // Раздачу поднимаем сразу, а не при первом показе: если она
  // не заведётся, узнать об этом лучше здесь, в журнале запуска,
  // чем посреди разговора.
  void раздачаЕсть();

  console.log(`  Режим:   ${env.NODE_ENV}`);
  console.log(`  API:     http://localhost:${env.PORT}`);
  // В продакшене клиент отдаёт этот же процесс, в разработке — Vite.
  console.log(
    `  Клиент:  ${isProduction ? `http://localhost:${env.PORT}` : env.CLIENT_ORIGIN}`,
  );

  if (!turn) {
    console.log(`  Голос:   только напрямую — ретранслятор выключен (нет TURN_SECRET)\n`);
    return;
  }

  turn
    .start()
    .then((port) => {
      setTurnServer(turn);
      console.log(`  Голос:   ретранслятор на UDP ${port}, в домашней сети ${localIPv4()}`);
      // Внешний адрес узнаётся у STUN-сервера и приходит не мгновенно.
      // Печатаем его отдельной строкой, когда он появится: без него
      // непонятно, что вписывать в проброс портов на роутере.
      setTimeout(() => {
        const outside = env.TURN_HOST ?? turn.publicAddress;
        console.log(
          outside
            ? `           снаружи ${outside} — этот адрес и порт ${port} пробрасывайте на роутере\n`
            : `           внешний адрес узнать не удалось — друзья из интернета не достучатся\n`,
        );
      }, 4000).unref?.();
    })
    .catch((error: NodeJS.ErrnoException) => {
      // Мессенджер без ретранслятора работает, поэтому не падаем:
      // разговоры просто останутся только прямыми.
      const why = error.code === "EADDRINUSE" ? `порт ${env.TURN_PORT} занят` : error.message;
      console.error(`  Голос:   ретранслятор не поднялся (${why}) — разговоры только напрямую\n`);
    });
});

/** Корректное завершение: дать текущим запросам договорить,
 *  закрыть сокеты и пул соединений с базой. Без этого pm2 при
 *  перезапуске будет оставлять висящие подключения к Postgres. */
async function shutdown(signal: string) {
  console.log(`\n  ${signal} — останавливаюсь...`);
  io.close();
  httpServer.close();
  await turn?.stop();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
