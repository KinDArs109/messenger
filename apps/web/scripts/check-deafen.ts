// Проверка правила «звук и микрофон».
//
//   npm run check:deafen -w @messenger/web
//
// Правило простое на словах и легко ломается на деле: выключая звук,
// гасим и микрофон, а включая — возвращаем, но только если гасили его
// мы. Ошибка тут не видна ни глазом, ни в вёрстке — человек просто
// говорит в пустоту, и узнаёт об этом от собеседников.

import { micOnDeafenChange } from "../src/features/voice/deafen.js";

let failed = false;
const ok = (s: string) => console.log(`  ✔ ${s}`);
const fail = (s: string) => {
  console.log(`  ✘ ПРОВАЛ: ${s}`);
  failed = true;
};

/** Один шаг: каким становится звук и что было с микрофоном. */
function step(
  name: string,
  input: { deafened: boolean; muted: boolean; byDeafen: boolean },
  expected: { muted: boolean; byDeafen: boolean } | null,
) {
  const got = micOnDeafenChange(input.deafened, input.muted, input.byDeafen);
  const same =
    expected === null
      ? got === null
      : got !== null && got.muted === expected.muted && got.mutedByDeafen === expected.byDeafen;

  const show = (v: typeof expected) =>
    v === null ? "не трогать" : `микрофон ${v.muted ? "выключен" : "включён"}, наш: ${v.byDeafen}`;

  if (same) ok(`${name} → ${show(expected)}`);
  else fail(`${name} → ожидалось «${show(expected)}», получено «${show(got && { muted: got.muted, byDeafen: got.mutedByDeafen })}»`);
}

console.log("\nПравило «выключил звук — выключился микрофон»\n");

console.log("=== Выключаем звук ===");
step(
  "микрофон был открыт",
  { deafened: true, muted: false, byDeafen: false },
  { muted: true, byDeafen: true },
);
step(
  "микрофон человек выключил сам заранее",
  { deafened: true, muted: true, byDeafen: false },
  null,
);

console.log("\n=== Включаем звук обратно ===");
step(
  "микрофон выключили мы вместе со звуком",
  { deafened: false, muted: true, byDeafen: true },
  { muted: false, byDeafen: false },
);
step(
  "микрофон человек выключил сам — оставляем как есть",
  { deafened: false, muted: true, byDeafen: false },
  null,
);
step(
  "микрофон и так открыт (включили под глушилкой)",
  { deafened: false, muted: false, byDeafen: false },
  null,
);

// Полный круг: то, ради чего всё и затевалось. Человек ничего
// не трогал, кроме кнопки звука, — и после двух нажатий должен
// оказаться ровно там, откуда начал.
console.log("\n=== Туда и обратно ===");
{
  let muted = false;
  let byDeafen = false;

  const off = micOnDeafenChange(true, muted, byDeafen);
  if (off) ({ muted, mutedByDeafen: byDeafen } = off);

  const on = micOnDeafenChange(false, muted, byDeafen);
  if (on) ({ muted, mutedByDeafen: byDeafen } = on);

  if (!muted && !byDeafen) ok("выключил звук и включил обратно — микрофон снова работает");
  else fail(`после круга микрофон ${muted ? "остался выключенным" : "в непонятном состоянии"}`);
}

{
  let muted = true; // человек выключил микрофон сам
  let byDeafen = false;

  const off = micOnDeafenChange(true, muted, byDeafen);
  if (off) ({ muted, mutedByDeafen: byDeafen } = off);

  const on = micOnDeafenChange(false, muted, byDeafen);
  if (on) ({ muted, mutedByDeafen: byDeafen } = on);

  if (muted) ok("свой выключенный микрофон никто за человека не включил");
  else fail("микрофон включился сам, хотя человек выключал его вручную");
}

console.log(failed ? "\nЕсть провалы\n" : "\nВсё сходится\n");
process.exit(failed ? 1 : 0);
