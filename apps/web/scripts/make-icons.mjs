import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Генератор иконок приложения.
 *
 *  Ставить пакет ради двух картинок не хочется, а рисовать их руками
 *  в редакторе — значит потерять возможность поменять цвет одной
 *  строкой. Поэтому PNG собирается здесь: заливка акцентом, белая
 *  скруглённая «реплика» с хвостиком.
 *
 *  Это заглушка. Настоящий знак нарисуете, когда придумаете название.
 *
 *  Запуск: node scripts/make-icons.mjs
 */

const ACCENT = [0x58, 0x65, 0xf2]; // --color-accent
const WHITE = [0xff, 0xff, 0xff];

const OUT = path.join(import.meta.dirname, "..", "public");

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function writePng(file, size, pixel) {
  // Каждая строка PNG начинается с байта фильтра — здесь всегда 0.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // бит на канал
  ihdr[9] = 6; // RGBA
  ihdr[12] = 0;

  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const inRoundedRect = (x, y, left, top, right, bottom, radius) => {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
};

/** Иконка: сплошной акцентный квадрат и белая реплика с хвостиком. */
function icon(x, y, size) {
  const u = size / 100;
  const bubble =
    inRoundedRect(x, y, 22 * u, 26 * u, 78 * u, 62 * u, 10 * u) ||
    // хвостик — треугольник слева снизу
    (x >= 28 * u && x <= 44 * u && y >= 60 * u && y <= 78 * u && y - 60 * u <= (44 * u - x) * 1.2);

  return bubble ? [...WHITE, 255] : [...ACCENT, 255];
}

mkdirSync(OUT, { recursive: true });
for (const size of [192, 512]) {
  writePng(path.join(OUT, `icon-${size}.png`), size, icon);
  console.log(`  icon-${size}.png`);
}
writePng(path.join(OUT, "favicon.png"), 64, icon);
console.log("  favicon.png");
