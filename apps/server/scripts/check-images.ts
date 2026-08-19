import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { UPLOADS_DIR, baseKeyOf, saveFile, sniffMimeType, thumbUrlFor } from "../src/lib/storage.js";

/**
 * Проверка пережатия картинок.
 *
 * Делает скриншотоподобную картинку — заливки, текст, тонкие линии,
 * то есть худший случай для WebP, — прогоняет её через то же
 * хранилище, что и настоящую загрузку, и печатает, сколько
 * получилось. Заодно проверяет, что анимацию не портим и что чужие
 * форматы проходят нетронутыми.
 *
 *   npm run check:images -w @messenger/server
 */

let failed = false;
const ok = (s: string) => console.log(`  ✔ ${s}`);
const fail = (s: string) => {
  console.log(`  ✘ ПРОВАЛ: ${s}`);
  failed = true;
};
const кб = (n: number) => `${Math.round(n / 1024)} КБ`;

/** Картинка, похожая на скриншот интерфейса. */
async function makeScreenshot(): Promise<Buffer> {
  const текст = Array.from({ length: 30 }, (_, i) =>
    `<text x="40" y="${40 + i * 32}" font-family="sans-serif" font-size="15" fill="#dbdee1">Сообщение ${i}: обычный текст в ленте переписки</text>`,
  ).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
    <rect width="1920" height="1080" fill="#313338"/>
    <rect width="312" height="1080" fill="#2b2d31"/>
    ${текст}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main(): Promise<void> {
  console.log("\nПроверка пережатия картинок\n");
  const созданные: string[] = [];

  const png = await makeScreenshot();
  const тип = sniffMimeType(png);
  if (тип !== "image/png") return fail(`тип определился как ${тип}`);

  const stored = await saveFile(png, тип);
  созданные.push(stored.key);
  if (stored.thumbKey) созданные.push(stored.thumbKey);

  if (stored.mimeType !== "image/webp") {
    fail(`картинка не пережалась: ${stored.mimeType}`);
  } else {
    const во = png.length / stored.size;
    ok(`PNG ${кб(png.length)} → WebP ${кб(stored.size)} — в ${во.toFixed(1)} раза меньше`);
    if (во < 1.5) fail(`выигрыш всего ${во.toFixed(1)}× — не стоит возни`);
  }

  if (stored.width !== 1920 || stored.height !== 1080) {
    fail(`размеры потерялись: ${stored.width}×${stored.height}`);
  } else ok("размеры сохранены — лента не прыгнет при загрузке");

  if (!stored.thumbKey) {
    fail("превью не создано, хотя картинка широкая");
  } else {
    // Читаем файл сами и отдаём буфером: sharp, открыв файл по пути,
    // держит его до сборки мусора, и удалить потом не даёт — Windows
    // на занятом файле возвращает EBUSY.
    const bytes = await readFile(path.join(UPLOADS_DIR, stored.thumbKey));
    const thumb = await sharp(bytes).metadata();
    const size = bytes.length;
    if (thumb.width !== 600) fail(`превью шириной ${thumb.width}, а не 600`);
    else ok(`превью ${thumb.width}×${thumb.height}, ${кб(size)} — в ленту едет оно`);
  }

  const url = thumbUrlFor(stored.key, stored.width);
  if (!url?.endsWith(".thumb.webp")) fail(`адрес превью неверный: ${url}`);
  else if (baseKeyOf(url.replace("/uploads/", "")) !== stored.key) fail("обратный путь к оригиналу не сходится");
  else ok("адрес превью выводится из ключа и приводится обратно");

  // Мелкая картинка: превью ей не нужно.
  const мелкая = await sharp({
    create: { width: 200, height: 150, channels: 3, background: "#5865f2" },
  })
    .png()
    .toBuffer();
  const small = await saveFile(мелкая, "image/png");
  созданные.push(small.key);
  if (small.thumbKey) fail("для мелкой картинки сделано лишнее превью");
  else ok("мелкой картинке превью не делается");

  // Анимация должна остаться анимацией.
  const гиф = await sharp({
    create: { width: 100, height: 100, channels: 4, background: "#000" },
  })
    .gif()
    .toBuffer();
  const gifType = sniffMimeType(гиф);
  const gifStored = await saveFile(гиф, gifType);
  созданные.push(gifStored.key);
  if (gifStored.mimeType !== "image/gif") fail(`GIF пережали в ${gifStored.mimeType} — анимация потеряна`);
  else ok("GIF не трогаем — иначе потеряли бы анимацию");

  // Не картинка проходит как есть.
  const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(2048, 0x20)]);
  const pdfStored = await saveFile(pdf, sniffMimeType(pdf));
  созданные.push(pdfStored.key);
  if (pdfStored.mimeType !== "application/pdf") fail("PDF испортили");
  else ok("не-картинки проходят нетронутыми");

  for (const key of созданные) {
    await rm(path.join(UPLOADS_DIR, key), { force: true });
  }
  console.log(failed ? "\nЕсть провалы\n" : "\nВсё сходится\n");
  process.exitCode = failed ? 1 : 0;
}

void main().catch((error) => {
  console.error("\nПроверка не запустилась:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
