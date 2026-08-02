import { randomBytes } from "node:crypto";

/** Генератор случайных строк по заданному алфавиту.
 *  Отдельный файл, чтобы не тянуть зависимость ради двадцати строк.
 *
 *  Байты отбрасываются, если не попадают в диапазон, кратный длине
 *  алфавита. Простой `% alphabet.length` дал бы небольшой перекос
 *  в сторону первых символов — для кодов приглашений это некритично,
 *  но привычку лучше иметь правильную. */
export function customAlphabet(alphabet: string, size: number) {
  const max = Math.floor(256 / alphabet.length) * alphabet.length;

  return (): string => {
    let result = "";
    while (result.length < size) {
      const bytes = randomBytes(size);
      for (const byte of bytes) {
        if (byte >= max) continue;
        result += alphabet[byte % alphabet.length];
        if (result.length === size) break;
      }
    }
    return result;
  };
}
