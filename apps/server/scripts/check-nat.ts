/**
 * Какой у нас NAT.
 *
 *     npm run check:nat
 *
 * От ответа зависит, соединится ли голос напрямую. Проверка простая:
 * спрашиваем у двух разных STUN-серверов, каким наш компьютер виден
 * снаружи, — и делаем это через ОДИН И ТОТ ЖЕ локальный сокет.
 *
 * Если оба назвали один и тот же внешний порт, NAT «конусный»:
 * собеседник, узнав этот адрес, сможет достучаться. Если порты
 * разные — NAT симметричный: он выдаёт новый порт под каждого
 * адресата, узнанный адрес бесполезен, и прямое соединение
 * не построится. Тогда нужен TURN-ретранслятор.
 *
 * Тот же сокет здесь принципиален. Два разных сокета получат разные
 * порты при любом NAT, и проверка покажет симметричный там, где его
 * нет.
 */

import { createSocket } from "node:dgram";

/** Список намеренно длинный и разношёрстный.
 *
 *  Серверы Google из российских сетей не отвечают — проверено, — и
 *  полагаться на них нельзя ни здесь, ни в самом мессенджере. Нам
 *  нужно, чтобы ответили хотя бы двое: по одному ответу тип NAT
 *  не определить. */
const SERVERS = [
  { host: "stun.sipnet.ru", port: 3478 },
  { host: "stun.ekiga.net", port: 3478 },
  { host: "stun.stunprotocol.org", port: 3478 },
  { host: "stun.voipbuster.com", port: 3478 },
  { host: "stun.nextcloud.com", port: 443 },
  { host: "stun.miwifi.com", port: 3478 },
  { host: "stun.qq.com", port: 3478 },
  { host: "stun.l.google.com", port: 19302 },
];

const MAGIC = 0x2112a442;

function bindingRequest(): Buffer {
  const message = Buffer.alloc(20);
  message.writeUInt16BE(0x0001, 0); // Binding Request
  message.writeUInt16BE(0, 2); // длина тела
  message.writeUInt32BE(MAGIC, 4);
  // Идентификатор запроса — случайный, чтобы отличать ответы.
  for (let i = 8; i < 20; i++) message[i] = Math.floor(Math.random() * 256);
  return message;
}

/** Запрос с просьбой ответить с другого адреса. Так проверяется,
 *  пропустит ли роутер пакет от того, кому мы ничего не посылали —
 *  а именно так к нам будут стучаться друзья, если поднять
 *  ретранслятор дома. */
function changeRequest(changeIp: boolean, changePort: boolean): Buffer {
  const body = Buffer.alloc(8);
  body.writeUInt16BE(0x0003, 0); // CHANGE-REQUEST
  body.writeUInt16BE(4, 2);
  body.writeUInt32BE((changeIp ? 0x04 : 0) | (changePort ? 0x02 : 0), 4);

  const message = Buffer.concat([bindingRequest(), body]);
  message.writeUInt16BE(body.length, 2);
  return message;
}

/** Разбор ответа. Нужен единственный атрибут — XOR-MAPPED-ADDRESS:
 *  адрес, каким нас увидел сервер. Он «зашифрован» константой MAGIC,
 *  чтобы домашние роутеры не подменяли его на лету. */
function parseMapped(message: Buffer): { ip: string; port: number } | null {
  return findAttribute(message, 0x0020, true);
}

/** Есть ли у сервера второй адрес. Без него он не сможет ответить
 *  «с другой стороны», и проверку фильтрации делать не на чем. */
function parseOtherAddress(message: Buffer): { ip: string; port: number } | null {
  return findAttribute(message, 0x802c, false);
}

function findAttribute(
  message: Buffer,
  wanted: number,
  xored: boolean,
): { ip: string; port: number } | null {
  let offset = 20;
  while (offset + 4 <= message.length) {
    const type = message.readUInt16BE(offset);
    const length = message.readUInt16BE(offset + 2);
    const value = message.subarray(offset + 4, offset + 4 + length);

    if (type === wanted && value.length >= 8) {
      const mask = xored ? MAGIC : 0;
      const port = value.readUInt16BE(2) ^ (mask >>> 16);
      const ip = [0, 1, 2, 3]
        .map((i) => value[4 + i]! ^ ((mask >>> (24 - 8 * i)) & 0xff))
        .join(".");
      return { ip, port };
    }
    // Атрибуты выровнены по четыре байта.
    offset += 4 + length + ((4 - (length % 4)) % 4);
  }
  return null;
}

/** Отправить запрос и подождать ответ на тот же сокет. */
function ask(
  socket: ReturnType<typeof createSocket>,
  packet: Buffer,
  host: string,
  port: number,
  timeoutMs = 4000,
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      resolve(null);
    }, timeoutMs);
    const onMessage = (message: Buffer) => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
    socket.send(packet, port, host, (error) => {
      if (!error) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(null);
    });
  });
}

async function main(): Promise<void> {
  const socket = createSocket("udp4");
  await new Promise<void>((resolve) => socket.bind(0, resolve));
  console.log(`Локальный порт: ${socket.address().port}\n`);

  const results: { server: string; ip: string; port: number }[] = [];
  /** Сервер, у которого есть второй адрес, — на нём проверим,
   *  пропускает ли роутер незваных. */
  let twoSided: { host: string; port: number } | null = null;

  for (const { host, port } of SERVERS) {
    const message = await ask(socket, bindingRequest(), host, port);
    const answer = message ? parseMapped(message) : null;

    if (answer) {
      console.log(`${host.padEnd(22)} видит нас как ${answer.ip}:${answer.port}`);
      results.push({ server: host, ...answer });
      if (!twoSided && message && parseOtherAddress(message)) twoSided = { host, port };
    } else {
      console.log(`${host.padEnd(22)} не ответил`);
    }
  }

  await filtering(socket, twoSided);
  socket.close();
  console.log();

  if (results.length < 2) {
    console.log("Ответили меньше двух серверов — вывод сделать нельзя.");
    console.log("Возможно, UDP наружу закрыт: тогда голос не заработает вовсе.");
    return;
  }

  const ports = new Set(results.map((r) => r.port));
  const ips = new Set(results.map((r) => r.ip));

  if (ips.size > 1) {
    console.log("Внешний адрес меняется между серверами — редкий случай,");
    console.log("похоже на несколько каналов наружу. Голос будет нестабилен.");
    return;
  }

  if (ports.size === 1) {
    console.log("NAT конусный: внешний порт один и тот же.");
    console.log("Прямое соединение с собеседником должно строиться.");
  } else {
    console.log("NAT СИММЕТРИЧНЫЙ: на каждого собеседника выдаётся свой порт.");
    console.log("Прямое соединение не построится — нужен TURN-ретранслятор.");
    console.log("Текст, файлы и звонки через ретранслятор при этом работают.");
  }
}

/**
 * Пропустит ли роутер того, кому мы ничего не посылали.
 *
 * Это отдельный вопрос от типа NAT, и для ретранслятора он главный:
 * друг из интернета шлёт нам пакет первым, не дожидаясь приглашения.
 * Просим STUN-сервер ответить с другого своего адреса — если ответ
 * дошёл, значит роутер пускает незваных и ретранслятор заработает
 * без настройки роутера. Не дошёл — порт придётся пробрасывать
 * руками.
 */
async function filtering(
  socket: ReturnType<typeof createSocket>,
  server: { host: string; port: number } | null,
): Promise<void> {
  console.log();
  if (!server) {
    console.log("Пропускает ли роутер незваных — проверить не на чем:");
    console.log("ни один из ответивших серверов не имеет второго адреса.");
    return;
  }

  const fromElsewhere = await ask(socket, changeRequest(true, true), server.host, server.port, 5000);
  if (fromElsewhere) {
    console.log("Роутер пропускает пакеты от кого угодно.");
    console.log("Ретранслятор дома заработает и без настройки роутера.");
    return;
  }

  const otherPort = await ask(socket, changeRequest(false, true), server.host, server.port, 5000);
  console.log(
    otherPort
      ? "Роутер пропускает только с знакомого адреса, но с любого порта."
      : "Роутер пропускает только тех, кому мы писали сами.",
  );
  console.log("Значит, порт ретранслятора нужно пробросить на роутере вручную.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
