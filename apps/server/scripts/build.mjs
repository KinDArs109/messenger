// Собрать сервер в один файл.
//
//   npm run build -w @messenger/server
//
// Раньше боевой сервер запускался через tsx — то есть переваривал
// весь свой TypeScript заново при каждом старте. Это работало, но
// стоило трёх секунд простоя на каждый перезапуск (а перезапуск —
// это оборванные разговоры) и лишних десятков мегабайт памяти
// на машине, где её всего гигабайт.
//
// Здесь всё то же самое делается один раз, заранее: esbuild склеивает
// исходники и общий пакет в один файл, который node читает без
// посредников. Библиотеки из node_modules остаются снаружи — их
// незачем копировать в сборку, а prisma без своего родного файла
// и не заработала бы.

import { build } from "esbuild";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

const корень = path.join(import.meta.dirname, "..");
const пакет = JSON.parse(readFileSync(path.join(корень, "package.json"), "utf8"));

/*
 * Снаружи оставляем всё, что стоит в зависимостях, — кроме своего же
 * общего пакета: он живёт исходниками и в node_modules не собран.
 * Его как раз и надо вобрать внутрь.
 */
const снаружи = [
  ...Object.keys(пакет.dependencies ?? {}),
  ...Object.keys(пакет.optionalDependencies ?? {}),
].filter((имя) => !имя.startsWith("@messenger/"));

rmSync(path.join(корень, "dist"), { recursive: true, force: true });

const итог = await build({
  entryPoints: [path.join(корень, "src", "index.ts")],
  outfile: path.join(корень, "dist", "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Карта исходников — чтобы в журнале падений стояли настоящие имена
  // файлов и строки, а не одна длинная склеенная простыня.
  sourcemap: true,
  external: снаружи,
  logLevel: "warning",
  metafile: true,
});

const размер = Object.values(итог.metafile.outputs)[0]?.bytes ?? 0;
console.log(`  Сервер собран: dist/index.js, ${Math.round(размер / 1024)} КБ`);
