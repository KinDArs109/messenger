import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { newId } from "./ids.js";

/** Абстракция хранилища.
 *
 *  Сейчас файлы лежат на диске рядом с сервером — на ноуте это
 *  единственный бесплатный вариант. Когда появится S3, меняется
 *  только этот файл: во всём остальном коде фигурирует storageKey,
 *  а не путь. */

export const UPLOADS_DIR = path.join(import.meta.dirname, "../../uploads");

/** Разрешённые к показу прямо в ленте типы. Всё остальное отдаётся
 *  только как загрузка: браузер не должен исполнять в нашем домене
 *  файл, который прислал пользователь. */
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export const isInlineType = (mimeType: string): boolean => INLINE_TYPES.has(mimeType);

/** Тип определяем по содержимому, а не по расширению и не по тому,
 *  что заявил браузер: и то, и другое подделывается тривиально. */
export function sniffMimeType(buffer: Buffer): string {
  const b = (i: number) => buffer[i];

  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return "image/png";
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46) return "image/gif";
  if (
    b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 &&
    b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50
  ) {
    return "image/webp";
  }
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46) return "application/pdf";
  if (b(0) === 0x50 && b(1) === 0x4b && (b(2) === 0x03 || b(2) === 0x05)) return "application/zip";

  return "application/octet-stream";
}

/** Размеры картинки нужны, чтобы зарезервировать под неё место
 *  в ленте до загрузки — иначе при подгрузке сообщения прыгают. */
export function readImageSize(
  buffer: Buffer,
  mimeType: string,
): { width: number; height: number } | null {
  try {
    if (mimeType === "image/png") {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mimeType === "image/gif") {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (mimeType === "image/jpeg") {
      let offset = 2;
      while (offset < buffer.length - 9) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1]!;
        const length = buffer.readUInt16BE(offset + 2);
        // SOF0..SOF3 и SOF5..SOF15 — кадры с размерами.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
  } catch {
    // Битый или обрезанный файл — размеры просто неизвестны.
  }
  return null;
}

export async function saveFile(buffer: Buffer, mimeType: string): Promise<string> {
  await mkdir(UPLOADS_DIR, { recursive: true });

  // Имя генерируем сами. Пользовательское не годится: там бывают
  // и `../`, и двойные расширения, и просто одинаковые названия.
  const key = `${newId()}${extensionFor(mimeType)}`;
  await writeFile(path.join(UPLOADS_DIR, key), buffer);
  return key;
}

export async function deleteFile(storageKey: string): Promise<void> {
  await unlink(path.join(UPLOADS_DIR, storageKey)).catch(() => undefined);
}

export const fileUrl = (storageKey: string): string => `/uploads/${storageKey}`;

function extensionFor(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "application/zip": ".zip",
  };
  return map[mimeType] ?? ".bin";
}
