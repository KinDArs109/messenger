import { createServer } from "node:http";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { createRealtime } from "./realtime/index.js";
import { setRealtime } from "./realtime/emitter.js";
import { prisma } from "./db/client.js";
import { TurnServer, localIPv4, setTurnServer } from "./turn/server.js";
import { раздачаЕсть } from "./realtime/sfu.js";
import { UPLOADS_DIR } from "./lib/paths.js";

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
  // Где лежат файлы — вслух. Уехавший путь иначе замечают только
  // по пропавшим аватаркам, и не в тот же день.
  console.log(`  Файлы:   ${UPLOADS_DIR}`);
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
  // Сколько бы ни длилось прощание, дольше пяти секунд оно не идёт:
  // перезапуск — это оборванные разговоры, и растягивать его нельзя.
  setTimeout(() => process.exit(0), 5000).unref();
  io.close();
  httpServer.close();
  await turn?.stop();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

/*
 * Страховка от необработанных ошибок.
 *
 * Узел по умолчанию убивает процесс за любое необработанное обещание.
 * Для мессенджера, в котором четверо сидят в разговоре, это скверный
 * размен: одна забытая проверка где-нибудь в отправке уведомления
 * обрывает всем голос. Систему это, конечно, поднимет через три
 * секунды — но разговор уже разорван.
 *
 * Поэтому разделяем. Необработанное обещание — записываем и живём
 * дальше: почти всегда это частный случай, а не сломанный процесс.
 * А вот необработанное исключение оставляет процесс в неизвестном
 * состоянии — тут честнее уйти и дать себя перезапустить, но сначала
 * записать, из-за чего.
 */
process.on("unhandledRejection", (беда) => {
  console.error(
    "  Необработанное обещание:",
    беда instanceof Error ? (беда.stack ?? беда.message) : беда,
  );
});

process.on("uncaughtException", (беда) => {
  console.error("  Необработанное исключение:", беда.stack ?? беда.message);
  // Даём журналу записаться и уходим: систему перезапустит нас сама.
  setTimeout(() => process.exit(1), 200).unref();
});
