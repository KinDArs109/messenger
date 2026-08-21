import type {
  Consumer,
  Producer,
  Router,
  RtpCapabilities,
  RtpParameters,
  Worker,
  WebRtcTransport,
  DtlsParameters,
} from "mediasoup/types";
import { env } from "../config/env.js";
import { localIPv4 } from "../turn/server.js";

/**
 * Раздача картинки: сервер принимает её один раз и рассылает остальным.
 *
 * До этого разговор шёл «каждый с каждым»: показывающий кодировал свой
 * экран отдельно для каждого собеседника и отправлял столько раз,
 * сколько людей в канале. Вчетвером — трижды. Замер (check-share.cjs)
 * показал, чем это кончается: при нехватке полосы кодировщик роняет
 * и размер, и кадры сразу, и получается мыло, которое ещё и дёргается.
 * Никакими настройками это не лечится — надо перестать отправлять
 * втрое больше, чем нужно.
 *
 * Теперь картинка уходит один раз, а размножает её сервер. Он ничего
 * не пережимает: пакеты приходят и уходят как есть, меняются только
 * ключи шифрования — у каждого получателя они свои. Поэтому на машине
 * с одним ядром это стоит недорого, а вот домашнему каналу становится
 * втрое легче.
 *
 * Звук микрофона по-прежнему идёт напрямую. Он весит копейки, а прямая
 * дорога короче: голос через сервер — это лишние миллисекунды там,
 * где их слышно.
 *
 * Всё это необязательно. Библиотека для раздачи — родная, её собирают
 * под конкретную систему, и на машине разработчика её может не быть
 * вовсе. Тогда сервер честно скажет «раздачи нет», а мессенджер
 * вернётся к старому способу «каждый с каждым» — он никуда не делся.
 */

/** Кодеки, которые сервер согласен раздавать.
 *
 *  H264 первым намеренно: показ экрана мессенджер отдаёт именно им —
 *  его жмёт видеокарта, а VP8 в браузере жмёт процессор и на трёх
 *  соединениях не справляется (см. apps/web/src/lib/codecs.ts). */
const КОДЕКИ = [
  {
    kind: "audio" as const,
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video" as const,
    mimeType: "video/H264",
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      /*
       * Уровень 5.2, а не 3.1 — и это не украшение.
       *
       * Уровень в H264 задаёт потолок: сколько точек в секунду
       * кодировщику разрешено. Привычный 42e01f — это 3.1, а 3.1
       * означает 1080p при тридцати кадрах. Ровно то, на что жалуются,
       * когда показывают игру: картинка вроде большая, а кадров вдвое
       * меньше, чем просили, — и никакой битрейт этого не лечит,
       * потому что упор не в него.
       */
      "profile-level-id": "42e034",
      "level-asymmetry-allowed": 1,
    },
  },
  {
    kind: "video" as const,
    mimeType: "video/VP8",
    clockRate: 90000,
  },
];

/** Что за поток раздаётся. Собеседнику важно не только «видео»,
 *  но и что это: экран, звук этого экрана или камера. */
export type Что = "screen" | "screenAudio" | "video";

interface Поток {
  userId: string;
  что: Что;
  producer: Producer;
}

interface Участник {
  userId: string;
  channelId: string;
  send: WebRtcTransport | null;
  recv: WebRtcTransport | null;
  producers: Map<string, Поток>;
  consumers: Map<string, Consumer>;
}

let worker: Worker | null = null;
let рабочийНеВышел = false;

/** Роутер на канал: раздача идёт внутри одного разговора, и мешать
 *  разные каналы в одном роутере незачем. */
const роутеры = new Map<string, Router>();

/** Кто чем занят. Ключ — сокет: одно устройство, один набор дорог. */
const участники = new Map<string, Участник>();

/** Поднять рабочего. Один на процесс: ядро всё равно одно, а каждый
 *  рабочий — это отдельный процесс со своей памятью. */
async function рабочий(): Promise<Worker | null> {
  if (worker) return worker;
  if (рабочийНеВышел || env.SFU_DISABLED) return null;

  try {
    const mediasoup = await import("mediasoup");
    worker = await mediasoup.createWorker({
      rtcMinPort: env.SFU_MIN_PORT,
      rtcMaxPort: env.SFU_MAX_PORT,
      // Ошибки и предупреждения: остальное на маленькой машине
      // только забивает журнал.
      logLevel: "warn",
    });

    worker.on("died", () => {
      console.error("  Раздача: рабочий умер — разговоры пойдут напрямую");
      worker = null;
      роутеры.clear();
      участники.clear();
    });

    console.log(`  Раздача: готова, порты ${env.SFU_MIN_PORT}–${env.SFU_MAX_PORT}`);
    return worker;
  } catch (беда) {
    // Библиотеки нет или она не собралась под эту систему. Это не
    // поломка: мессенджер умеет и без неё, просто дороже для тех,
    // кто показывает.
    рабочийНеВышел = true;
    console.warn(
      `  Раздача: не поднялась (${беда instanceof Error ? беда.message : "неизвестно"}) — ` +
        "показ пойдёт напрямую, каждому свой поток",
    );
    return null;
  }
}

/** Жива ли раздача прямо сейчас — без попыток её поднять.
 *  Нужно проверке здоровья: она спрашивает часто, и будить ею
 *  рабочего было бы странно. */
export function раздачаЖива(): boolean {
  return worker !== null && !worker.closed;
}

/** Есть ли раздача вообще. Клиент спрашивает это первым делом. */
export async function раздачаЕсть(): Promise<boolean> {
  return (await рабочий()) !== null;
}

async function роутер(channelId: string): Promise<Router | null> {
  const готовый = роутеры.get(channelId);
  if (готовый && !готовый.closed) return готовый;

  const w = await рабочий();
  if (!w) return null;

  const новый = await w.createRouter({ mediaCodecs: КОДЕКИ });
  роутеры.set(channelId, новый);
  return новый;
}

/** Чем сервер умеет раздавать — клиенту это нужно, чтобы понять,
 *  договорятся ли они вообще. */
export async function возможности(channelId: string): Promise<RtpCapabilities | null> {
  const r = await роутер(channelId);
  return r ? r.rtpCapabilities : null;
}

function участник(socketId: string, userId: string, channelId: string): Участник {
  const был = участники.get(socketId);
  if (был && был.channelId === channelId) return был;

  // Перешёл в другой канал — старые дороги ведут не туда.
  if (был) закрыть(socketId);

  const свежий: Участник = {
    userId,
    channelId,
    send: null,
    recv: null,
    producers: new Map(),
    consumers: new Map(),
  };
  участники.set(socketId, свежий);
  return свежий;
}

/**
 * Дорога для одного человека — в одну сторону.
 *
 * Отправка и приём разными дорогами: так требует сама библиотека,
 * и это разумно — они живут разной жизнью. Отправку заводят, когда
 * начинают показывать; приём — когда появился первый показывающий.
 */
export async function дорога(
  socketId: string,
  userId: string,
  channelId: string,
  куда: "send" | "recv",
): Promise<{
  id: string;
  iceParameters: unknown;
  iceCandidates: unknown;
  dtlsParameters: unknown;
} | null> {
  const r = await роутер(channelId);
  if (!r) return null;

  const кто = участник(socketId, userId, channelId);
  const прежняя = кто[куда];
  if (прежняя && !прежняя.closed) {
    return {
      id: прежняя.id,
      iceParameters: прежняя.iceParameters,
      iceCandidates: прежняя.iceCandidates,
      dtlsParameters: прежняя.dtlsParameters,
    };
  }

  /*
   * Каким адресом раздача зовёт к себе.
   *
   * Слушать «все адреса» мало: в приглашении должен стоять адрес,
   * по которому до нас и правда можно достучаться. Без него в
   * приглашение уходит 0.0.0.0 — адрес, которого нет, — и показ
   * молча повисает, потому что соединяться некуда.
   *
   * Снаружи это тот адрес, которым сервер виден из интернета.
   * На своей машине его нет, и тогда зовём по адресу в домашней
   * сети — этого хватает и проверкам, и разработке.
   */
  const снаружи = env.SFU_ANNOUNCED_IP ?? env.TURN_HOST ?? null;
  const адрес = снаружи ? { ip: "0.0.0.0", announcedIp: снаружи } : { ip: localIPv4() };

  const транспорт = await r.createWebRtcTransport({
    listenIps: [адрес],
    enableUdp: true,
    // TCP — запасной путь для тех, у кого UDP режут на работе или
    // в общежитии. Медленнее, но лучше, чем ничего.
    enableTcp: true,
    preferUdp: true,
    // Потолок отдачи с сервера одному человеку. Столько же, сколько
    // мессенджер разрешает себе отправлять, — выше просто некуда.
    initialAvailableOutgoingBitrate: 8_000_000,
  });

  кто[куда] = транспорт;
  return {
    id: транспорт.id,
    iceParameters: транспорт.iceParameters,
    iceCandidates: транспорт.iceCandidates,
    dtlsParameters: транспорт.dtlsParameters,
  };
}

/** Рукопожатие: клиент прислал свою половину ключей. */
export async function соединить(
  socketId: string,
  transportId: string,
  dtlsParameters: DtlsParameters,
): Promise<boolean> {
  const кто = участники.get(socketId);
  if (!кто) return false;

  for (const дорога of [кто.send, кто.recv]) {
    if (дорога && дорога.id === transportId) {
      await дорога.connect({ dtlsParameters });
      return true;
    }
  }
  return false;
}

/** Человек начал что-то показывать. */
export async function отдаёт(
  socketId: string,
  transportId: string,
  kind: "audio" | "video",
  rtpParameters: RtpParameters,
  что: Что,
): Promise<string | null> {
  const кто = участники.get(socketId);
  if (!кто?.send || кто.send.id !== transportId) return null;

  const producer = await кто.send.produce({ kind, rtpParameters, appData: { что } });
  кто.producers.set(producer.id, { userId: кто.userId, что, producer });

  producer.on("transportclose", () => {
    кто.producers.delete(producer.id);
  });

  return producer.id;
}

/** Что сейчас раздаётся в канале — кроме своего. */
export function чтоИдёт(
  socketId: string,
  channelId: string,
): { producerId: string; userId: string; что: Что }[] {
  const список: { producerId: string; userId: string; что: Что }[] = [];
  for (const [id, кто] of участники) {
    if (id === socketId || кто.channelId !== channelId) continue;
    for (const [producerId, поток] of кто.producers) {
      if (!поток.producer.closed) {
        список.push({ producerId, userId: поток.userId, что: поток.что });
      }
    }
  }
  return список;
}

/** Подписать человека на чужой поток. */
export async function принимает(
  socketId: string,
  producerId: string,
  rtpCapabilities: RtpCapabilities,
): Promise<{
  id: string;
  producerId: string;
  kind: "audio" | "video";
  rtpParameters: RtpParameters;
  userId: string;
  что: Что;
} | null> {
  const кто = участники.get(socketId);
  const r = кто ? роутеры.get(кто.channelId) : null;
  if (!кто?.recv || !r) return null;

  const чей = [...участники.values()].find((у) => у.producers.has(producerId));
  const поток = чей?.producers.get(producerId);
  if (!поток || поток.producer.closed) return null;

  if (!r.canConsume({ producerId, rtpCapabilities })) return null;

  const consumer = await кто.recv.consume({
    producerId,
    rtpCapabilities,
    // Включаем не сразу: сначала клиент должен привязать дорожку
    // к своему проигрывателю, иначе первые кадры уходят в пустоту.
    paused: true,
  });

  кто.consumers.set(consumer.id, consumer);
  consumer.on("transportclose", () => кто.consumers.delete(consumer.id));
  consumer.on("producerclose", () => кто.consumers.delete(consumer.id));

  return {
    id: consumer.id,
    producerId,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
    userId: поток.userId,
    что: поток.что,
  };
}

/** Клиент готов — можно пускать. */
export async function пустить(socketId: string, consumerId: string): Promise<boolean> {
  const consumer = участники.get(socketId)?.consumers.get(consumerId);
  if (!consumer) return false;
  await consumer.resume();
  return true;
}

/** Показ кончился. */
export function перестал(socketId: string, что: Что): string[] {
  const кто = участники.get(socketId);
  if (!кто) return [];

  const закрытые: string[] = [];
  for (const [id, поток] of кто.producers) {
    if (поток.что !== что) continue;
    поток.producer.close();
    кто.producers.delete(id);
    закрытые.push(id);
  }
  return закрытые;
}

/** Человек ушёл из разговора или закрыл окно. */
export function закрыть(socketId: string): string[] {
  const кто = участники.get(socketId);
  if (!кто) return [];

  const producerIds = [...кто.producers.keys()];
  кто.send?.close();
  кто.recv?.close();
  участники.delete(socketId);

  // Опустевший роутер закрываем: он держит порты и память, а разговор
  // может не повториться до вечера.
  const остались = [...участники.values()].some((у) => у.channelId === кто.channelId);
  if (!остались) {
    роутеры.get(кто.channelId)?.close();
    роутеры.delete(кто.channelId);
  }

  return producerIds;
}
