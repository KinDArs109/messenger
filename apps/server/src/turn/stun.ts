import { createHash, createHmac } from "node:crypto";

/**
 * Разбор и сборка сообщений STUN — того языка, на котором говорят
 * TURN-сервер и браузер.
 *
 * Формат простой: двадцать байт заголовка и дальше набор полей
 * «тип, длина, значение», каждое выровненное до четырёх байт.
 * Тонкостей ровно три, и все три ниже с объяснениями: как из
 * заголовка достать метод и класс, как считается подпись и почему
 * адреса передаются «вывернутыми».
 *
 * RFC 5389 (STUN) и RFC 8656 (TURN).
 */

/** Метка «это STUN». Отличает наши пакеты от чужих на том же порту. */
export const MAGIC = 0x2112a442;

export const METHOD = {
  binding: 0x001,
  allocate: 0x003,
  refresh: 0x004,
  send: 0x006,
  data: 0x007,
  createPermission: 0x008,
  channelBind: 0x009,
} as const;

export const CLASS = {
  request: 0b00,
  indication: 0b01,
  success: 0b10,
  error: 0b11,
} as const;

export const ATTR = {
  mappedAddress: 0x0001,
  username: 0x0006,
  messageIntegrity: 0x0008,
  errorCode: 0x0009,
  unknownAttributes: 0x000a,
  channelNumber: 0x000c,
  lifetime: 0x000d,
  xorPeerAddress: 0x0012,
  data: 0x0013,
  realm: 0x0014,
  nonce: 0x0015,
  xorRelayedAddress: 0x0016,
  requestedTransport: 0x0019,
  xorMappedAddress: 0x0020,
  software: 0x8022,
  fingerprint: 0x8028,
} as const;

export interface Address {
  address: string;
  port: number;
}

export interface StunMessage {
  method: number;
  class: number;
  transaction: Buffer;
  attributes: Map<number, Buffer>;
  /** Сырые байты — по ним считается подпись, и пересобрать их
   *  один в один нельзя: порядок и набор полей задаёт отправитель. */
  raw: Buffer;
  /** Где в сырых байтах начинается поле с подписью. −1 — подписи нет. */
  integrityAt: number;
}

/** Тип сообщения хитро разрезан на куски, между которыми вставлены
 *  два бита класса. Историческая причина: так первые два бита всего
 *  пакета оказываются нулями, и STUN отличим от других протоколов
 *  на том же порту. */
function encodeType(method: number, cls: number): number {
  return (
    ((method & 0x0f80) << 2) |
    ((method & 0x0070) << 1) |
    (method & 0x000f) |
    ((cls & 0b10) << 7) |
    ((cls & 0b01) << 4)
  );
}

function decodeType(type: number): { method: number; class: number } {
  return {
    method: ((type & 0x3e00) >> 2) | ((type & 0x00e0) >> 1) | (type & 0x000f),
    class: ((type & 0x0100) >> 7) | ((type & 0x0010) >> 4),
  };
}

export function parse(packet: Buffer): StunMessage | null {
  if (packet.length < 20) return null;
  // Первые два бита обязаны быть нулями, а метка — на месте.
  // Иначе это не STUN, а чей-то чужой трафик.
  if ((packet[0]! & 0xc0) !== 0) return null;
  if (packet.readUInt32BE(4) !== MAGIC) return null;

  const length = packet.readUInt16BE(2);
  if (20 + length > packet.length) return null;

  const { method, class: cls } = decodeType(packet.readUInt16BE(0));
  const attributes = new Map<number, Buffer>();
  let integrityAt = -1;

  let at = 20;
  const end = 20 + length;
  while (at + 4 <= end) {
    const type = packet.readUInt16BE(at);
    const size = packet.readUInt16BE(at + 2);
    if (at + 4 + size > end) break;

    // Поля после подписи в неё не входят — запоминаем, где она.
    if (type === ATTR.messageIntegrity && integrityAt < 0) integrityAt = at;
    if (!attributes.has(type)) attributes.set(type, packet.subarray(at + 4, at + 4 + size));

    // Каждое поле выровнено до четырёх байт, добивка в длину не входит.
    at += 4 + size + ((4 - (size % 4)) % 4);
  }

  return { method, class: cls, transaction: packet.subarray(8, 20), attributes, raw: packet, integrityAt };
}

/** Собрать сообщение. Подпись и контрольная сумма дописываются
 *  последними — они считаются по всему, что перед ними. */
export function build(options: {
  method: number;
  class: number;
  transaction: Buffer;
  attributes: [number, Buffer][];
  /** Ключ для подписи. Без него подписи не будет. */
  key?: Buffer;
  fingerprint?: boolean;
}): Buffer {
  const parts: Buffer[] = [];
  for (const [type, value] of options.attributes) {
    const padding = (4 - (value.length % 4)) % 4;
    const head = Buffer.alloc(4);
    head.writeUInt16BE(type, 0);
    head.writeUInt16BE(value.length, 2);
    parts.push(head, value, Buffer.alloc(padding));
  }

  const body = Buffer.concat(parts);
  const header = Buffer.alloc(20);
  header.writeUInt16BE(encodeType(options.method, options.class), 0);
  header.writeUInt32BE(MAGIC, 4);
  options.transaction.copy(header, 8);

  let message = Buffer.concat([header, body]);

  if (options.key) {
    // Длину в заголовке заранее выставляем так, будто подпись уже
    // на месте: иначе принимающая сторона посчитает другую сумму.
    message.writeUInt16BE(body.length + 24, 2);
    const mac = createHmac("sha1", options.key).update(message).digest();
    const head = Buffer.alloc(4);
    head.writeUInt16BE(ATTR.messageIntegrity, 0);
    head.writeUInt16BE(20, 2);
    message = Buffer.concat([message, head, mac]);
  }

  if (options.fingerprint) {
    message.writeUInt16BE(message.length - 20 + 8, 2);
    const sum = (crc32(message) ^ 0x5354554e) >>> 0;
    const tail = Buffer.alloc(8);
    tail.writeUInt16BE(ATTR.fingerprint, 0);
    tail.writeUInt16BE(4, 2);
    tail.writeUInt32BE(sum, 4);
    message = Buffer.concat([message, tail]);
  }

  message.writeUInt16BE(message.length - 20, 2);
  return message;
}

/**
 * Проверить подпись сообщения.
 *
 * Считается она не по всему пакету, а по его началу до самого поля
 * с подписью, причём длина в заголовке на это время подменяется —
 * будто подпись последняя. Пакет с полями после подписи (браузер
 * дописывает контрольную сумму) иначе не сойдётся никогда.
 */
export function checkIntegrity(message: StunMessage, key: Buffer): boolean {
  if (message.integrityAt < 0) return false;
  const mac = message.attributes.get(ATTR.messageIntegrity);
  if (!mac || mac.length !== 20) return false;

  const upto = Buffer.from(message.raw.subarray(0, message.integrityAt));
  const header = Buffer.from(message.raw.subarray(0, 20));
  header.writeUInt16BE(message.integrityAt - 20 + 24, 2);
  header.copy(upto, 0, 0, 20);

  const expected = createHmac("sha1", key).update(upto).digest();
  return expected.equals(mac);
}

/** Ключ долгосрочных учётных данных. Пароль в открытом виде по сети
 *  не ходит — обе стороны считают из него одно и то же число. */
export function longTermKey(username: string, realm: string, password: string): Buffer {
  return createHash("md5").update(`${username}:${realm}:${password}`).digest();
}

/** Адреса передаются «вывернутыми» по метке протокола. Причина
 *  бытовая: домашние роутеры любят подменять в проходящих пакетах
 *  всё, что похоже на адрес, и выворачивание прячет его от них. */
export function encodeXorAddress(address: Address, transaction: Buffer): Buffer {
  const parts = address.address.split(".").map(Number);
  const out = Buffer.alloc(8);
  out.writeUInt8(0, 0);
  out.writeUInt8(1, 1); // IPv4
  out.writeUInt16BE(address.port ^ (MAGIC >>> 16), 2);
  const raw = Buffer.from(parts);
  const magic = Buffer.alloc(4);
  magic.writeUInt32BE(MAGIC, 0);
  for (let i = 0; i < 4; i++) out.writeUInt8(raw[i]! ^ magic[i]!, 4 + i);
  void transaction;
  return out;
}

export function decodeXorAddress(value: Buffer): Address | null {
  if (value.length < 8 || value.readUInt8(1) !== 1) return null;
  const port = value.readUInt16BE(2) ^ (MAGIC >>> 16);
  const magic = Buffer.alloc(4);
  magic.writeUInt32BE(MAGIC, 0);
  const octets: number[] = [];
  for (let i = 0; i < 4; i++) octets.push(value.readUInt8(4 + i) ^ magic[i]!);
  return { address: octets.join("."), port };
}

export function errorCode(code: number, reason: string): Buffer {
  const text = Buffer.from(reason, "utf8");
  const out = Buffer.alloc(4 + text.length);
  out.writeUInt8(Math.floor(code / 100), 2);
  out.writeUInt8(code % 100, 3);
  text.copy(out, 4);
  return out;
}

export function uint32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value >>> 0, 0);
  return out;
}

/** CRC-32 для контрольной суммы. Своя, а не из библиотеки: одна
 *  таблица и восемь строк — не повод тянуть зависимость. */
const TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    table[i] = value;
  }
  return table;
})();

export function crc32(buffer: Buffer): number {
  let value = 0xffffffff;
  for (const byte of buffer) value = (value >>> 8) ^ TABLE[(value ^ byte) & 0xff]!;
  return (value ^ 0xffffffff) >>> 0;
}
