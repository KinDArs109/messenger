import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Одноразовые коды по RFC 6238 — те самые шесть цифр из Google
 * Authenticator.
 *
 * Своя реализация, а не библиотека: алгоритм — это HMAC-SHA1 от номера
 * тридцатисекундного интервала и взятие шести цифр. Тридцать строк,
 * которые не устаревают, против зависимости, которую придётся
 * обновлять и которой придётся доверять секрет учётной записи.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;

/** Насколько шагов назад и вперёд принимаем код.
 *  Один шаг в каждую сторону — это ±30 секунд запаса на расхождение
 *  часов телефона и сервера и на медленный ввод. Больше делать нельзя:
 *  каждый лишний шаг втрое удлиняет окно жизни украденного кода. */
const WINDOW = 1;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";


/** Секрет в base32 — формата, который понимают приложения-аутентификаторы.
 *  160 бит: столько же, сколько в блоке HMAC-SHA1, брать меньше смысла нет. */
export function generateSecret(): string {
  const bytes = randomBytes(20);
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");

  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function codeForCounter(secret: string, counter: number): string {
  const buffer = Buffer.alloc(8);
  // Счётчик восьмибайтный, big-endian. Пишем как два 32-битных числа:
  // writeBigUInt64BE потребовал бы BigInt на каждую проверку.
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac("sha1", base32Decode(secret)).update(buffer).digest();

  // Динамическое усечение: младшие четыре бита последнего байта
  // указывают, откуда брать четыре байта результата.
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;

  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/** Проверка кода с допуском на расхождение часов.
 *
 *  Сравнение через timingSafeEqual: коды всего из шести цифр, и по
 *  времени ответа обычного сравнения их можно подбирать посимвольно. */
export function verifyCode(secret: string, code: string, at: Date = new Date()): boolean {
  const clean = code.trim();
  if (!/^\d{6}$/.test(clean)) return false;

  const counter = Math.floor(at.getTime() / 1000 / STEP_SECONDS);
  const given = Buffer.from(clean);

  let ok = false;
  for (let shift = -WINDOW; shift <= WINDOW; shift++) {
    const expected = Buffer.from(codeForCounter(secret, counter + shift));
    // Без раннего выхода: цикл всегда проходит все шаги, иначе время
    // ответа подсказывало бы, какой именно шаг совпал.
    if (expected.length === given.length && timingSafeEqual(expected, given)) ok = true;
  }
  return ok;
}

/** Ссылка формата otpauth:// — её кодируют в QR-код.
 *  issuer виден в приложении списком, поэтому там имя сервиса,
 *  а в label — кто именно, иначе несколько учётных записей
 *  сливаются в неразличимые строки. */
export function otpauthUrl(username: string, secret: string, issuer = "Мессенджер"): string {
  const label = encodeURIComponent(`${issuer}:${username}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
