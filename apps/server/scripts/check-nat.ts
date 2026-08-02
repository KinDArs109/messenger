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

/** Разбор ответа. Нужен единственный атрибут — XOR-MAPPED-ADDRESS:
 *  адрес, каким нас увидел сервер. Он «зашифрован» константой MAGIC,
 *  чтобы домашние роутеры не подменяли его на лету. */
function parseMapped(message: Buffer): { ip: string; port: number } | null {
  let offset = 20;
  while (offset + 4 <= message.length) {
    const type = message.readUInt16BE(offset);
    const length = message.readUInt16BE(offset + 2);
    const value = message.subarray(offset + 4, offset + 4 + length);

    if (type === 0x0020 && value.length >= 8) {
      const port = value.readUInt16BE(2) ^ (MAGIC >>> 16);
      const ip = [0, 1, 2, 3]
        .map((i) => value[4 + i]! ^ ((MAGIC >>> (24 - 8 * i)) & 0xff))
        .join(".");
      return { ip, port };
    }
    // Атрибуты выровнены по четыре байта.
    offset += 4 + length + ((4 - (length % 4)) % 4);
  }
  return null;
}

async function main(): Promise<void> {
  const socket = createSocket("udp4");
  await new Promise<void>((resolve) => socket.bind(0, resolve));
  console.log(`Локальный порт: ${socket.address().port}\n`);

  const results: { server: string; ip: string; port: number }[] = [];

  for (const { host, port } of SERVERS) {
    const answer = await new Promise<{ ip: string; port: number } | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 4000);
      const onMessage = (message: Buffer) => {
        clearTimeout(timer);
        socket.off("message", onMessage);
        resolve(parseMapped(message));
      };
      socket.on("message", onMessage);
      socket.send(bindingRequest(), port, host, (error) => {
        if (error) {
          clearTimeout(timer);
          resolve(null);
        }
      });
    });

    if (answer) {
      console.log(`${host.padEnd(22)} видит нас как ${answer.ip}:${answer.port}`);
      results.push({ server: host, ...answer });
    } else {
      console.log(`${host.padEnd(22)} не ответил`);
    }
  }

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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
