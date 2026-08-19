// Проверка читаемости палитры.
//
//   npm run check:contrast -w @messenger/web
//
// Цвета подбираются на глаз, а «на глаз» на тёмном фоне обманывает
// сильнее всего: тусклая подпись выглядит стильно на большом ярком
// мониторе и пропадает на ноутбуке при солнце. Здесь считается
// настоящий контраст по формуле WCAG и сверяется с порогом.
//
// Порог 4.5 — для обычного текста, 3.0 — для крупного и для границ,
// по которым надо различать элементы, а не читать.

import { readFileSync } from "node:fs";
import path from "node:path";

const tokens = readFileSync(
  path.join(import.meta.dirname, "../src/styles/tokens.css"),
  "utf8",
);

/** Достаём цвета прямо из палитры, а не переписываем сюда: копия
 *  разошлась бы с оригиналом на первой же правке. */
function colour(name: string): string {
  const found = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens);
  if (!found) throw new Error(`нет цвета --color-${name}`);
  return found[1]!;
}

/** Относительная яркость по WCAG. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

let failed = false;
const ok = (s: string) => console.log(`  ✔ ${s}`);
const fail = (s: string) => {
  console.log(`  ✘ ПРОВАЛ: ${s}`);
  failed = true;
};

function проверить(текст: string, фон: string, порог: number, что: string) {
  const value = contrast(colour(текст), colour(фон));
  const строка = `${что}: ${value.toFixed(1)} (надо ${порог})`;
  if (value >= порог) ok(строка);
  else fail(строка);
}

/** Поверхности, на которых вообще бывает текст. */
const SURFACES = ["rail", "panel", "sidebar", "chat", "hover", "raised", "active"];

console.log("\nЧитаемость палитры\n");

console.log("=== Обычный текст на всех поверхностях ===");
for (const surface of SURFACES) проверить("body", surface, 4.5, `body на ${surface}`);

console.log("\n=== Яркий текст (заголовки, имена) ===");
for (const surface of SURFACES) проверить("bright", surface, 4.5, `bright на ${surface}`);

console.log("\n=== Приглушённый текст ===");
// Он тоже читается, а не украшает: этим цветом набраны подписи
// под настройками и время у сообщений.
for (const surface of ["sidebar", "chat", "raised"]) проверить("muted", surface, 4.5, `muted на ${surface}`);

console.log("\n=== Совсем бледный ===");
// Им набрано то, что глазами не читают, а замечают: разделители,
// подсказки. Порог мягче.
for (const surface of ["sidebar", "chat"]) проверить("faint", surface, 3, `faint на ${surface}`);

console.log("\n=== Белым по акценту (кнопки) ===");
{
  const value = (1 + 0.05) / (luminance(colour("accent")) + 0.05);
  const строка = `белый на accent: ${value.toFixed(1)} (надо 4.5)`;
  value >= 4.5 ? ok(строка) : fail(строка);
}
{
  const value = (1 + 0.05) / (luminance(colour("accent-hover")) + 0.05);
  const строка = `белый на accent-hover: ${value.toFixed(1)} (надо 4.5)`;
  value >= 4.5 ? ok(строка) : fail(строка);
}

console.log("\n=== Цветное на основном фоне ===");
for (const name of ["link", "online", "idle", "dnd", "danger", "accent"]) {
  проверить(name, "chat", 3, `${name} на chat`);
}

console.log("\n=== Состояния различимы между собой ===");
// Зелёный, жёлтый и красный должны отличаться не только оттенком:
// каждый двадцатый мужчина не различает красный и зелёный, и если
// они ещё и одной яркости, кружок становится бессмысленным.
for (const [a, b] of [
  ["online", "dnd"],
  ["online", "idle"],
  ["idle", "dnd"],
  ["accent", "idle"],
] as const) {
  const разница = Math.abs(luminance(colour(a)) - luminance(colour(b)));
  const строка = `${a} и ${b} отличаются по яркости на ${(разница * 100).toFixed(0)}%`;
  разница >= 0.04 ? ok(строка) : fail(`${строка} — мало, различать будет нечем`);
}

console.log(failed ? "\nЕсть провалы\n" : "\nВсё сходится\n");
process.exit(failed ? 1 : 0);
