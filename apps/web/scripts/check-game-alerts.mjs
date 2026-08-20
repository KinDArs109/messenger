// Проверка правила «друг запустил игру».
//
//   npm run check:alerts -w @messenger/web
//
// Уведомление, которое приходит не вовремя, выключают вместе со всеми
// остальными — поэтому здесь проверяется не «показалось окошко»,
// а само правило: в каких случаях будить человека, а в каких молчать.
// Правило вынесено в отдельный файл именно ради этого.

import { pathToFileURL } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const source = readFileSync(path.join(here, "../src/lib/gameAlerts.ts"), "utf8");

// Правило написано на TypeScript, а проверка — обычный Node. Переводим
// на месте: тащить ради одного файла сборщик незачем, а проверять
// хочется тот же код, который поедет к людям, а не его копию.
const js = transpileModule(source, {
  compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
}).outputText;

const dir = mkdtempSync(path.join(tmpdir(), "alerts-"));
const file = path.join(dir, "gameAlerts.mjs");
writeFileSync(file, js);
const { shouldAlertGame, rememberGame } = await import(pathToFileURL(file).href);

const результаты = [];
const ok = (пункт, значение, ещё) => {
  результаты.push(Boolean(значение));
  console.log(`${значение ? "  ✔" : "  ✘ ПРОВАЛ"} ${пункт}${ещё ? " " + JSON.stringify(ещё) : ""}`);
};

/** Обычная обстановка: мы играли в Rust, друг его запустил. */
const обычно = {
  userId: "друг",
  meId: "я",
  game: "Rust",
  myGames: ["Rust", "Minecraft"],
  enabled: true,
  inCall: false,
  quiet: false,
  told: false,
};

console.log("\n=== Когда говорить про чужую игру ===");

ok("друг запустил нашу игру — говорим", shouldAlertGame(обычно) === true);

ok(
  "чужую игру, в которую мы не играем, — молчим",
  shouldAlertGame({ ...обычно, game: "Dota 2" }) === false,
);

ok(
  "регистр и пробелы не мешают узнать игру",
  shouldAlertGame({ ...обычно, game: "  rust " }) === true,
);

ok("про себя не рассказываем", shouldAlertGame({ ...обычно, userId: "я" }) === false);

ok("закрыл игру — не новость", shouldAlertGame({ ...обычно, game: null }) === false);

ok(
  "мы уже в разговоре — значит, и так вместе",
  shouldAlertGame({ ...обычно, inCall: true }) === false,
);

ok("«не беспокоить» — молчим", shouldAlertGame({ ...обычно, quiet: true }) === false);

ok("выключено в настройках — молчим", shouldAlertGame({ ...обычно, enabled: false }) === false);

ok(
  "второй раз про ту же игру не повторяемся",
  shouldAlertGame({ ...обычно, told: true }) === false,
);

console.log("\n=== Память о своих играх ===");

ok("новая игра встаёт первой", rememberGame(["Minecraft"], "Rust")[0] === "Rust");

ok(
  "повтор не удваивает список",
  rememberGame(["Rust", "Minecraft"], "Rust").length === 2,
  { стало: rememberGame(["Rust", "Minecraft"], "Rust") },
);

ok(
  "список не растёт бесконечно",
  rememberGame(
    Array.from({ length: 10 }, (_, i) => `Игра ${i}`),
    "Новая",
  ).length === 10,
);

ok("ничего не играем — список не меняется", rememberGame(["Rust"], null).length === 1);

const провалов = результаты.filter((x) => !x).length;
console.log(
  `\n${провалов === 0 ? "Всё сходится" : `Провалов: ${провалов}`} — проверок ${результаты.length}\n`,
);
process.exit(провалов === 0 ? 0 : 1);
