import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { newId } from "./ids.js";

/** Абстракция хранилища.
 *
 *  Сейчас файлы лежат на диске рядом с сервером — при своей машине это
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

/**
 * Картинки пережимаем в WebP.
 *
 * Скриншот 1920×1080 в PNG весит около 640 КБ, он же в WebP на 90% —
 * около 210. Втрое меньше, а разница на глаз не видна: замеряно на
 * картинке с текстом и заливками, то есть на худшем для WebP случае.
 * Через туннель на домашней отдаче это разница между «открылось» и
 * «подождите».
 *
 * Ниже девяноста не опускаемся: на фотографии и восемьдесят
 * незаметны, а вот мелкий текст в скриншоте начинает мылиться,
 * и присланный кусок кода становится нечитаемым.
 *
 * GIF не трогаем: пережав, потеряли бы анимацию.
 */
const WEBP_QUALITY = 90;

/** Ширина превью для ленты. Полную картинку человек посмотрит
 *  по клику, а в ленте она всё равно ужимается стилями — и сейчас
 *  браузер честно качает все мегабайты, чтобы нарисовать её
 *  шириной в палец. */
const THUMB_WIDTH = 600;

const CONVERTIBLE = new Set(["image/png", "image/jpeg", "image/webp"]);

export interface StoredFile {
  key: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  /** Ключ уменьшенной копии. null — превью нет: картинка и так мелкая
   *  либо это не картинка вовсе. */
  thumbKey: string | null;
}

export async function saveFile(buffer: Buffer, mimeType: string): Promise<StoredFile> {
  await mkdir(UPLOADS_DIR, { recursive: true });

  if (CONVERTIBLE.has(mimeType)) {
    const converted = await convertImage(buffer);
    if (converted) return converted;
    // Не вышло — кладём как есть. Не принять картинку из-за неудачного
    // пережатия хуже, чем принять её тяжёлой.
  }

  // Имя генерируем сами. Пользовательское не годится: там бывают
  // и `../`, и двойные расширения, и просто одинаковые названия.
  const key = `${newId()}${extensionFor(mimeType)}`;
  await writeFile(path.join(UPLOADS_DIR, key), buffer);
  return {
    key,
    mimeType,
    size: buffer.length,
    ...(readImageSize(buffer, mimeType) ?? { width: null, height: null }),
    thumbKey: null,
  };
}

async function convertImage(buffer: Buffer): Promise<StoredFile | null> {
  try {
    const id = newId();
    // rotate() без аргументов разворачивает по метке EXIF: снятое
    // боком с телефона иначе так боком и покажется.
    const source = sharp(buffer, { failOn: "none" }).rotate();
    const meta = await source.metadata();

    // Многокадровый WebP — та же анимация, что и GIF.
    if ((meta.pages ?? 1) > 1) return null;

    const full = await source.clone().webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer();
    const key = `${id}.webp`;
    await writeFile(path.join(UPLOADS_DIR, key), full);

    // Превью только если есть что уменьшать.
    let thumbKey: string | null = null;
    if ((meta.width ?? 0) > THUMB_WIDTH) {
      const thumb = await source
        .clone()
        .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY, effort: 4 })
        .toBuffer();
      thumbKey = `${id}.thumb.webp`;
      await writeFile(path.join(UPLOADS_DIR, thumbKey), thumb);
    }

    return {
      key,
      mimeType: "image/webp",
      size: full.length,
      width: meta.width ?? null,
      height: meta.height ?? null,
      thumbKey,
    };
  } catch {
    return null;
  }
}

/** Сторона аватара и значка сервера.
 *
 *  Больше не нужно: самый крупный аватар в интерфейсе — 80 точек,
 *  с запасом на экраны с двойной плотностью это 160. Двести
 *  пятьдесят шесть закрывает и это, и «а вдруг покажем крупнее»,
 *  а весит около десяти килобайт — столько же, сколько одна иконка. */
const AVATAR_SIZE = 256;

/**
 * Аватар: обрезать в квадрат и уменьшить.
 *
 * Обрезаем по центру, а не вписываем с полями: аватар всегда круглый,
 * и вписанная картинка превратилась бы в кружок с полосками по бокам.
 *
 * null — не картинка либо картинка битая.
 */
export async function saveAvatar(buffer: Buffer): Promise<StoredFile | null> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  try {
    const key = `${newId()}.webp`;
    const square = await sharp(buffer, { failOn: "none" })
      .rotate()
      .resize({ width: AVATAR_SIZE, height: AVATAR_SIZE, fit: "cover", position: "centre" })
      .webp({ quality: WEBP_QUALITY, effort: 4 })
      .toBuffer();
    await writeFile(path.join(UPLOADS_DIR, key), square);
    return {
      key,
      mimeType: "image/webp",
      size: square.length,
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      thumbKey: null,
    };
  } catch {
    return null;
  }
}

export async function deleteFile(storageKey: string): Promise<void> {
  await drop(storageKey);
  // Превью лежит рядом и хранится по производному имени, отдельной
  // записи в базе у него нет.
  if (storageKey.endsWith(".webp") && !storageKey.endsWith(".thumb.webp")) {
    await drop(storageKey.replace(/\.webp$/, ".thumb.webp"));
  }
}

/**
 * Удалить один файл.
 *
 * «Файла нет» — не ошибка: превью могло не создаваться вовсе, а запись
 * могли удалить дважды.
 *
 * А вот «файл занят» — ошибка временная, и она бывает по-настоящему.
 * Windows не даёт удалить файл, который кто-то в этот момент читает,
 * а читать его могут: замена аватара и чужой браузер, докачивающий
 * прежний, легко попадают в одну секунду. Поэтому пробуем ещё раз
 * через мгновение вместо того, чтобы бросать файл на диске навсегда.
 *
 * Обо всём, что не разошлось само, говорим в журнал: незаметно
 * не удаляющиеся файлы означают диск, который однажды кончится без
 * единого следа.
 */
async function drop(storageKey: string): Promise<void> {
  const target = path.join(UPLOADS_DIR, storageKey);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await unlink(target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      if (code !== "EBUSY" && code !== "EPERM") {
        console.error(`Не удалось удалить файл ${storageKey}:`, error);
        return;
      }
      if (attempt === 2) {
        console.error(`Файл ${storageKey} занят и не удалился — подметёт уборка`);
        return;
      }
      await new Promise((готово) => setTimeout(готово, 150));
    }
  }
}

export const fileUrl = (storageKey: string): string => `/uploads/${storageKey}`;

/** Адрес превью. Выводится из ключа и ширины, отдельного поля в базе
 *  нет: превью — свойство файла на диске, а не отдельная сущность,
 *  и заводить ради него столбец с миграцией накладно.
 *
 *  Если файла вдруг не окажется (например, он загружен до появления
 *  превью), раздача отдаст оригинал — см. serve.ts. */
export function thumbUrlFor(storageKey: string, width: number | null): string | null {
  const convertible = storageKey.endsWith(".webp") && !storageKey.endsWith(".thumb.webp");
  if (!convertible || (width ?? 0) <= THUMB_WIDTH) return null;
  return `/uploads/${storageKey.replace(/\.webp$/, ".thumb.webp")}`;
}

/** Ключ оригинала по ключу превью. */
export const baseKeyOf = (key: string): string => key.replace(/\.thumb\.webp$/, ".webp");

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
