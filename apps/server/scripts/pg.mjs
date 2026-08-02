import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** Управление локальным PostgreSQL.
 *
 *  База развёрнута из архива, без установщика и без прав
 *  администратора, поэтому службы Windows у неё нет — её надо
 *  поднимать самому. Отсюда эти команды.
 *
 *      npm run db:up      поднять
 *      npm run db:down    остановить
 *      npm run db:status  проверить
 *
 *  Путь можно переопределить переменной PGSQL_HOME.
 */
const HOME = process.env.PGSQL_HOME ?? path.join("C:", "Users", "Admin", "pgsql");
const PG_CTL = path.join(HOME, "bin", "pg_ctl.exe");
const DATA = path.join(HOME, "data");
const LOG = path.join(HOME, "server.log");

const action = process.argv[2] ?? "status";

if (!existsSync(PG_CTL)) {
  console.error(`
  PostgreSQL не найден: ${PG_CTL}

  Ожидается распакованный архив бинарников. Если он лежит в другом
  месте, укажите путь:  PGSQL_HOME=D:\\pgsql npm run db:up
`);
  process.exit(1);
}

const args = {
  up: ["-D", DATA, "-l", LOG, "-w", "start"],
  down: ["-D", DATA, "-m", "fast", "stop"],
  status: ["-D", DATA, "status"],
}[action];

if (!args) {
  console.error(`Неизвестное действие: ${action}. Ожидается up, down или status.`);
  process.exit(1);
}

const result = spawnSync(PG_CTL, args, { stdio: "inherit" });

// pg_ctl status возвращает 3, когда сервер просто не запущен —
// это не ошибка выполнения, а ответ на вопрос.
if (action === "status" && result.status === 3) {
  console.log("  База остановлена. Поднять:  npm run db:up");
  process.exit(0);
}

process.exit(result.status ?? 1);
