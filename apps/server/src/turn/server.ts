import dgram from "node:dgram";
import os from "node:os";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  ATTR,
  CLASS,
  METHOD,
  build,
  checkIntegrity,
  decodeXorAddress,
  encodeXorAddress,
  errorCode,
  longTermKey,
  parse,
  uint32,
  type Address,
  type StunMessage,
} from "./stun.js";
import { isFresh, passwordFor } from "./credentials.js";

/**
 * Ретранслятор голоса (TURN).
 *
 * Обычно звук идёт напрямую между собеседниками, мимо сервера. Иногда
 * прямой путь не находится: у одной из сторон домашний роутер выдаёт
 * на каждого собеседника новый порт (симметричный NAT), у другой —
 * провайдер держит всех за одним общим адресом. Тогда разговор
 * не состоится вовсе, сколько ни жди.
 *
 * Ретранслятор — запасной путь: обе стороны отправляют звук ему,
 * а он перекладывает пакеты друг другу. Дороже прямого пути (весь
 * звук идёт через нас), поэтому браузер берёт его последним — только
 * когда прямой не нашёлся.
 *
 * Здесь только то, чем на самом деле пользуется браузер: выдача
 * адреса, разрешения, каналы и перекладывание байтов. Опции вроде
 * резервирования чётных портов не поддержаны сознательно — их никто
 * не запрашивает, а каждая строка в коде, смотрящем в интернет, —
 * это строка, которую надо защищать.
 */

/** Сколько живёт выданный адрес без продления. Браузер продлевает
 *  раз в несколько минут; десять минут — с запасом на паузу в сети. */
const ALLOCATION_LIFETIME = 600;

/** Сколько живёт разрешение говорить с конкретным собеседником.
 *  Пять минут — как велит стандарт. */
const PERMISSION_LIFETIME = 300;

/** Сколько живёт одноразовое число, которым подписан запрос.
 *  Час: дольше — и подсмотренный запрос можно будет повторить. */
const NONCE_LIFETIME_MS = 60 * 60 * 1000;

/** Потолок на число выданных адресов. Без него один клиент, шлющий
 *  Allocate в цикле, съест все порты машины. */
const MAX_ALLOCATIONS = 200;

interface Allocation {
  client: Address;
  socket: dgram.Socket;
  relayPort: number;
  username: string;
  key: Buffer;
  expiresAt: number;
  /** С кем разрешено разговаривать: адрес → до какого времени. */
  permissions: Map<string, number>;
  /** Короткие номера вместо адресов: браузер шлёт основной поток
   *  через них, экономя двадцать четыре байта на каждом пакете. */
  channels: Map<number, Address>;
  byPeer: Map<string, number>;
  /** Ответ на первый Allocate — чтобы на повтор того же запроса
   *  прислать то же самое, а не заводить второй адрес. */
  transaction: Buffer;
}

/** У кого спрашиваем свой внешний адрес. Те же два, что отвечают
 *  из российских сетей, — проверено скриптом check:nat. */
const STUN_SERVERS = [
  { host: "stun.sipnet.ru", port: 3478 },
  { host: "stun.miwifi.com", port: 3478 },
];

/** Как часто перепроверять внешний адрес. Домашний провайдер меняет
 *  его без предупреждения, и зашитый в настройки адрес однажды
 *  перестаёт быть нашим. */
const DISCOVERY_EVERY_MS = 10 * 60 * 1000;

export interface TurnOptions {
  port: number;
  realm: string;
  secret: string;
  /** Каким адресом ретранслятор виден снаружи. Пусто — узнаём сами
   *  и перепроверяем на ходу. */
  publicIp?: string;
}

export class TurnServer {
  private socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  private allocations = new Map<string, Allocation>();
  private nonces = new Map<string, number>();
  private sweeper: ReturnType<typeof setInterval> | null = null;
  private prober: ReturnType<typeof setInterval> | null = null;
  private started = false;

  /** Свой внешний адрес, узнанный у STUN-сервера. */
  private discovered: string | null = null;
  /** Опознавательный знак запроса, на который ждём ответ. */
  private probe: Buffer | null = null;
  /** Каким был адрес в домашней сети в прошлый раз. По его смене
   *  видно, что ноутбук переехал в другую сеть. */
  private lastLocal = localIPv4();

  /** Счётчики — их показывает check:turn и по ним видно, что через
   *  ретранслятор действительно ходит звук, а не только запросы. */
  readonly stats = { allocations: 0, relayed: 0, bytes: 0, rejected: 0 };

  constructor(private options: TurnOptions) {}

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.socket.on("error", (error) => {
        if (!this.started) reject(error);
        else console.error("Ретранслятор:", error);
      });
      this.socket.on("message", (packet, from) => this.onPacket(packet, from));
      this.socket.bind(this.options.port, () => {
        this.started = true;
        this.sweeper = setInterval(() => this.sweep(), 30_000);
        this.sweeper.unref?.();

        // Внешний адрес узнаём с того же самого сокета, на котором
        // работает ретранслятор. Это важно вдвойне: во-первых, узнаём
        // именно его отображение наружу, а не чьё-то ещё; во-вторых,
        // сам запрос открывает роутеру обратный путь к этому порту.
        if (!this.options.publicIp) {
          void this.discover();
          this.prober = setInterval(() => void this.discover(), DISCOVERY_EVERY_MS);
          this.prober.unref?.();
        }

        resolve(this.socket.address().port);
      });
    });
  }

  /** Свой внешний адрес: заданный руками либо узнанный сам.
   *  null — ещё не узнали или узнать не вышло. */
  get publicAddress(): string | null {
    return this.options.publicIp ?? this.discovered;
  }

  async stop(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    if (this.prober) clearInterval(this.prober);
    this.sweeper = null;
    this.prober = null;
    for (const allocation of this.allocations.values()) allocation.socket.close();
    this.allocations.clear();
    await new Promise<void>((done) => this.socket.close(() => done()));
  }

  /* ── Приём ──────────────────────────────────────────────────── */

  private onPacket(packet: Buffer, from: dgram.RemoteInfo): void {
    // Первые два бита делят весь поток надвое: нули — служебное
    // сообщение, единица с нулём — данные по короткому номеру канала.
    // Это единственный способ различить их на одном порту.
    if (packet.length >= 4 && (packet[0]! & 0xc0) === 0x40) {
      this.onChannelData(packet, from);
      return;
    }

    const message = parse(packet);
    if (!message) return;

    // Ответ на наш собственный вопрос «как я выгляжу снаружи».
    if (
      message.class === CLASS.success &&
      message.method === METHOD.binding &&
      this.probe?.equals(message.transaction)
    ) {
      const mapped = message.attributes.get(ATTR.xorMappedAddress);
      const address = mapped ? decodeXorAddress(mapped) : null;
      if (address) this.discovered = address.address;
      this.probe = null;
      return;
    }

    if (message.class !== CLASS.request && message.class !== CLASS.indication) return;

    const client: Address = { address: from.address, port: from.port };

    // Запрос «как я выгляжу снаружи» отвечаем без пароля: он ничего
    // не открывает, а тот же порт служит и обычным STUN-сервером.
    if (message.method === METHOD.binding && message.class === CLASS.request) {
      this.reply(client, message, CLASS.success, [
        [ATTR.xorMappedAddress, encodeXorAddress(client, message.transaction)],
      ]);
      return;
    }

    // Отправку данных подписывать нечем — стандарт разрешает её без
    // подписи. Защита здесь другая: без выданного адреса и без
    // разрешения на собеседника не уйдёт ничего.
    if (message.method === METHOD.send && message.class === CLASS.indication) {
      this.onSend(message, client);
      return;
    }

    if (message.class !== CLASS.request) return;

    const allowed = this.authenticate(message, client);
    if (!allowed) return;

    switch (message.method) {
      case METHOD.allocate:
        this.onAllocate(message, client, allowed.key, allowed.username);
        return;
      case METHOD.refresh:
        this.onRefresh(message, client, allowed.key);
        return;
      case METHOD.createPermission:
        this.onCreatePermission(message, client, allowed.key);
        return;
      case METHOD.channelBind:
        this.onChannelBind(message, client, allowed.key);
        return;
      default:
        this.fail(client, message, 400, "Bad Request", allowed.key);
    }
  }

  /* ── Пароли ─────────────────────────────────────────────────── */

  /**
   * Проверить подпись запроса.
   *
   * Порядок задан стандартом и переставлять его нельзя: на запрос
   * без подписи отвечаем «нужен пароль» и вкладываем одноразовое
   * число, и только следующий запрос, подписанный им, проверяется
   * по-настоящему. Так подсмотренный в сети запрос нельзя повторить
   * второй раз.
   */
  private authenticate(
    message: StunMessage,
    client: Address,
  ): { key: Buffer; username: string } | null {
    const username = message.attributes.get(ATTR.username)?.toString("utf8");
    const nonce = message.attributes.get(ATTR.nonce)?.toString("utf8");
    const realm = message.attributes.get(ATTR.realm)?.toString("utf8");

    if (!username || !nonce || !realm || message.integrityAt < 0) {
      this.challenge(client, message, 401, "Unauthorized");
      return null;
    }

    if (!this.nonceValid(nonce)) {
      this.challenge(client, message, 438, "Stale Nonce");
      return null;
    }

    // Срок годности логина проверяем до подписи: подпись у протухшего
    // логина сойдётся, и без этой проверки выданные вчера данные
    // работали бы вечно.
    if (!isFresh(username)) {
      this.stats.rejected++;
      this.challenge(client, message, 401, "Unauthorized");
      return null;
    }

    const key = longTermKey(username, this.options.realm, passwordFor(this.options.secret, username));
    if (!checkIntegrity(message, key)) {
      this.stats.rejected++;
      this.challenge(client, message, 401, "Unauthorized");
      return null;
    }

    return { key, username };
  }

  /** Одноразовое число: случайная часть и время выдачи, подписанные
   *  секретом. Хранить их списком не нужно — подпись говорит, что
   *  число наше, а время в нём говорит, не пора ли его менять. */
  private makeNonce(): string {
    const body = `${Date.now().toString(36)}.${randomBytes(8).toString("hex")}`;
    const mac = createHmac("sha256", this.options.secret).update(body).digest("hex").slice(0, 16);
    const nonce = `${body}.${mac}`;
    this.nonces.set(nonce, Date.now() + NONCE_LIFETIME_MS);
    return nonce;
  }

  private nonceValid(nonce: string): boolean {
    const parts = nonce.split(".");
    if (parts.length !== 3) return false;
    const [stamp, salt, mac] = parts as [string, string, string];

    const expected = createHmac("sha256", this.options.secret)
      .update(`${stamp}.${salt}`)
      .digest("hex")
      .slice(0, 16);
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

    const issued = parseInt(stamp, 36);
    return Number.isFinite(issued) && Date.now() - issued < NONCE_LIFETIME_MS;
  }

  private challenge(client: Address, message: StunMessage, code: number, reason: string): void {
    this.reply(client, message, CLASS.error, [
      [ATTR.errorCode, errorCode(code, reason)],
      [ATTR.realm, Buffer.from(this.options.realm, "utf8")],
      [ATTR.nonce, Buffer.from(this.makeNonce(), "utf8")],
    ]);
  }

  private fail(
    client: Address,
    message: StunMessage,
    code: number,
    reason: string,
    key?: Buffer,
  ): void {
    this.reply(client, message, CLASS.error, [[ATTR.errorCode, errorCode(code, reason)]], key);
  }

  private reply(
    client: Address,
    message: StunMessage,
    cls: number,
    attributes: [number, Buffer][],
    key?: Buffer,
  ): void {
    const packet = build({
      method: message.method,
      class: cls,
      transaction: message.transaction,
      attributes,
      key,
      fingerprint: true,
    });
    this.socket.send(packet, client.port, client.address);
  }

  /* ── Выдача адреса ──────────────────────────────────────────── */

  private onAllocate(
    message: StunMessage,
    client: Address,
    key: Buffer,
    username: string,
  ): void {
    const existing = this.allocations.get(keyOf(client));
    if (existing) {
      // Повтор того же запроса — обычное дело: ответ мог потеряться.
      // Отвечаем тем же адресом. Другой запрос с того же места —
      // ошибка, второй адрес одному клиенту не положен.
      if (existing.transaction.equals(message.transaction)) {
        this.replyAllocated(client, message, existing, key);
      } else {
        this.fail(client, message, 437, "Allocation Mismatch", key);
      }
      return;
    }

    // Просить умеют только UDP — TCP-ретрансляцией никто не пользуется,
    // а поддерживать её значит открыть ещё одну дверь наружу.
    const transport = message.attributes.get(ATTR.requestedTransport);
    if (!transport || transport.readUInt8(0) !== 17) {
      this.fail(client, message, 442, "Unsupported Transport Protocol", key);
      return;
    }

    if (this.allocations.size >= MAX_ALLOCATIONS) {
      this.fail(client, message, 486, "Allocation Quota Reached", key);
      return;
    }

    const relay = dgram.createSocket({ type: "udp4" });
    relay.on("error", () => this.drop(keyOf(client)));

    relay.bind(0, () => {
      const allocation: Allocation = {
        client,
        socket: relay,
        relayPort: relay.address().port,
        username,
        key,
        expiresAt: Date.now() + ALLOCATION_LIFETIME * 1000,
        permissions: new Map(),
        channels: new Map(),
        byPeer: new Map(),
        transaction: Buffer.from(message.transaction),
      };

      relay.on("message", (data, from) => this.onFromPeer(allocation, data, from));
      this.allocations.set(keyOf(client), allocation);
      this.stats.allocations++;
      this.replyAllocated(client, message, allocation, key);
    });
  }

  private replyAllocated(
    client: Address,
    message: StunMessage,
    allocation: Allocation,
    key: Buffer,
  ): void {
    const relayed: Address = {
      address: this.advertisedIp(client),
      port: allocation.relayPort,
    };
    this.reply(
      client,
      message,
      CLASS.success,
      [
        [ATTR.xorRelayedAddress, encodeXorAddress(relayed, message.transaction)],
        [ATTR.xorMappedAddress, encodeXorAddress(client, message.transaction)],
        [ATTR.lifetime, uint32(ALLOCATION_LIFETIME)],
      ],
      key,
    );
  }

  /**
   * Спросить у STUN-сервера, каким наш порт виден снаружи.
   *
   * Своими силами это не узнать: адрес выдаёт роутер, и сам компьютер
   * его не видит. Ответ приходит на тот же сокет и разбирается
   * в onPacket.
   */
  private async discover(): Promise<void> {
    const transaction = randomBytes(12);
    this.probe = transaction;

    const request = build({
      method: METHOD.binding,
      class: CLASS.request,
      transaction,
      attributes: [],
    });

    for (const server of STUN_SERVERS) {
      this.socket.send(request, server.port, server.host, () => undefined);
      // Отвечает обычно первый же; ждём немного и, если ответ пришёл,
      // второго не тревожим.
      await new Promise((готово) => setTimeout(готово, 1500));
      if (this.probe !== transaction) return;
    }
  }

  /**
   * Каким адресом называть себя собеседнику.
   *
   * Слушаем мы на всех сетевых картах сразу, и «адрес сокета» — это
   * 0.0.0.0, называть себя так нельзя. Выбираем по тому, откуда
   * пришёл клиент:
   *
   * своим из домашней сети — домашний адрес. Назвать им внешний
   * значило бы отправить их наружу и обратно, а такую петлю умеет
   * не всякий роутер, и разговор просто не построился бы у тех, кто
   * сидит в одной квартире;
   *
   * пришедшим из интернета — внешний.
   */
  private advertisedIp(client: Address): string {
    if (client.address === "127.0.0.1") return "127.0.0.1";
    if (isPrivate(client.address)) return localIPv4();
    return this.publicAddress ?? localIPv4();
  }

  private onRefresh(message: StunMessage, client: Address, key: Buffer): void {
    const allocation = this.allocations.get(keyOf(client));
    if (!allocation) {
      this.fail(client, message, 437, "Allocation Mismatch", key);
      return;
    }

    const asked = message.attributes.get(ATTR.lifetime);
    const lifetime = asked ? asked.readUInt32BE(0) : ALLOCATION_LIFETIME;

    if (lifetime === 0) {
      this.drop(keyOf(client));
      this.reply(client, message, CLASS.success, [[ATTR.lifetime, uint32(0)]], key);
      return;
    }

    const granted = Math.min(lifetime, ALLOCATION_LIFETIME);
    allocation.expiresAt = Date.now() + granted * 1000;
    this.reply(client, message, CLASS.success, [[ATTR.lifetime, uint32(granted)]], key);
  }

  /* ── Разрешения и каналы ────────────────────────────────────── */

  private onCreatePermission(message: StunMessage, client: Address, key: Buffer): void {
    const allocation = this.allocations.get(keyOf(client));
    if (!allocation) {
      this.fail(client, message, 437, "Allocation Mismatch", key);
      return;
    }

    // Собеседников в одном запросе может быть несколько.
    let any = false;
    for (const [type, value] of eachAttribute(message)) {
      if (type !== ATTR.xorPeerAddress) continue;
      const peer = decodeXorAddress(value);
      if (!peer) continue;
      allocation.permissions.set(peer.address, Date.now() + PERMISSION_LIFETIME * 1000);
      any = true;
    }

    if (!any) {
      this.fail(client, message, 400, "Bad Request", key);
      return;
    }
    this.reply(client, message, CLASS.success, [], key);
  }

  private onChannelBind(message: StunMessage, client: Address, key: Buffer): void {
    const allocation = this.allocations.get(keyOf(client));
    if (!allocation) {
      this.fail(client, message, 437, "Allocation Mismatch", key);
      return;
    }

    const number = message.attributes.get(ATTR.channelNumber)?.readUInt16BE(0);
    const peerRaw = message.attributes.get(ATTR.xorPeerAddress);
    const peer = peerRaw ? decodeXorAddress(peerRaw) : null;

    // Номера вне отведённого диапазона — либо ошибка клиента, либо
    // попытка подсунуть что-то своё.
    if (!number || number < 0x4000 || number > 0x7ffe || !peer) {
      this.fail(client, message, 400, "Bad Request", key);
      return;
    }

    const already = allocation.channels.get(number);
    if (already && keyOf(already) !== keyOf(peer)) {
      this.fail(client, message, 400, "Bad Request", key);
      return;
    }

    allocation.channels.set(number, peer);
    allocation.byPeer.set(keyOf(peer), number);
    // Привязка канала сама по себе даёт и разрешение говорить.
    allocation.permissions.set(peer.address, Date.now() + PERMISSION_LIFETIME * 1000);
    this.reply(client, message, CLASS.success, [], key);
  }

  /* ── Перекладывание байтов ──────────────────────────────────── */

  private onSend(message: StunMessage, client: Address): void {
    const allocation = this.allocations.get(keyOf(client));
    if (!allocation) return;

    const peerRaw = message.attributes.get(ATTR.xorPeerAddress);
    const data = message.attributes.get(ATTR.data);
    const peer = peerRaw ? decodeXorAddress(peerRaw) : null;
    if (!peer || !data) return;

    if (!this.permitted(allocation, peer.address)) {
      this.stats.rejected++;
      return;
    }

    allocation.socket.send(data, peer.port, peer.address);
    this.count(data.length);
  }

  private onChannelData(packet: Buffer, from: dgram.RemoteInfo): void {
    const allocation = this.allocations.get(`${from.address}:${from.port}`);
    if (!allocation) return;

    const number = packet.readUInt16BE(0);
    const length = packet.readUInt16BE(2);
    if (4 + length > packet.length) return;

    const peer = allocation.channels.get(number);
    if (!peer || !this.permitted(allocation, peer.address)) {
      this.stats.rejected++;
      return;
    }

    allocation.socket.send(packet.subarray(4, 4 + length), peer.port, peer.address);
    this.count(length);
  }

  /** Пришло от собеседника — отдаём клиенту. Через короткий номер,
   *  если он привязан: так на каждом пакете экономится заголовок. */
  private onFromPeer(allocation: Allocation, data: Buffer, from: dgram.RemoteInfo): void {
    if (!this.permitted(allocation, from.address)) {
      this.stats.rejected++;
      return;
    }

    const peer: Address = { address: from.address, port: from.port };
    const number = allocation.byPeer.get(keyOf(peer));

    if (number) {
      const head = Buffer.alloc(4);
      head.writeUInt16BE(number, 0);
      head.writeUInt16BE(data.length, 2);
      // Длина канальных данных выравнивается до четырёх байт —
      // не для UDP, но браузеры к этому привыкли и так надёжнее.
      const padding = Buffer.alloc((4 - (data.length % 4)) % 4);
      this.socket.send(
        Buffer.concat([head, data, padding]),
        allocation.client.port,
        allocation.client.address,
      );
    } else {
      const packet = build({
        method: METHOD.data,
        class: CLASS.indication,
        transaction: randomBytes(12),
        attributes: [
          [ATTR.xorPeerAddress, encodeXorAddress(peer, Buffer.alloc(12))],
          [ATTR.data, data],
        ],
      });
      this.socket.send(packet, allocation.client.port, allocation.client.address);
    }

    this.count(data.length);
  }

  private permitted(allocation: Allocation, address: string): boolean {
    const until = allocation.permissions.get(address);
    return until !== undefined && until > Date.now();
  }

  private count(bytes: number): void {
    this.stats.relayed++;
    this.stats.bytes += bytes;
  }

  /* ── Уборка ─────────────────────────────────────────────────── */

  private drop(id: string): void {
    const allocation = this.allocations.get(id);
    if (!allocation) return;
    allocation.socket.close();
    this.allocations.delete(id);
  }

  private sweep(): void {
    const now = Date.now();

    // Ноутбук переехал в другую сеть — внешний адрес наверняка тоже
    // другой, и ждать очередной плановой проверки нельзя: всё это
    // время ретранслятор называл бы себя адресом, оставшимся на
    // прошлом месте. Смену видно по адресу в домашней сети.
    const local = localIPv4();
    if (local !== this.lastLocal) {
      this.lastLocal = local;
      if (!this.options.publicIp) {
        this.discovered = null;
        void this.discover();
      }
      // Выданные адреса относились к прошлой сети и уже никуда
      // не ведут. Держать их — значит отвечать собеседникам ссылками
      // в пустоту.
      for (const id of [...this.allocations.keys()]) this.drop(id);
    }
    for (const [id, allocation] of this.allocations) {
      if (allocation.expiresAt <= now) {
        this.drop(id);
        continue;
      }
      for (const [address, until] of allocation.permissions) {
        if (until <= now) allocation.permissions.delete(address);
      }
    }
    for (const [nonce, until] of this.nonces) {
      if (until <= now) this.nonces.delete(nonce);
    }
  }
}

/** Запущенный ретранслятор. Нужен обработчику /voice/ice: он решает,
 *  какой адрес выдать клиенту, и для этого должен знать внешний —
 *  тот, который ретранслятор узнал сам. */
let running: TurnServer | null = null;
export const setTurnServer = (server: TurnServer | null): void => {
  running = server;
};
export const turnServer = (): TurnServer | null => running;

const keyOf = (address: Address): string => `${address.address}:${address.port}`;

/** Домашний ли это адрес. Три диапазона отведены под частные сети,
 *  и обитателя любого из них надо вести коротким путём, а не наружу.
 *
 *  Приставку ::ffff: снимаем обязательно: Express отдаёт локальный
 *  адрес именно в таком виде, и без этого свой же компьютер считался
 *  бы гостем из интернета — с петлёй через роутер, которую не всякий
 *  роутер умеет. */
export function isPrivate(address: string): boolean {
  const plain = address.replace(/^::ffff:/i, "");
  if (plain === "::1") return true;
  if (plain.startsWith("10.") || plain.startsWith("192.168.")) return true;
  if (plain.startsWith("127.")) return true;
  const parts = plain.split(".");
  const second = Number(parts[1]);
  return parts[0] === "172" && second >= 16 && second <= 31;
}

/** Перебрать все поля сообщения, включая повторяющиеся. Обычная
 *  карта хранит по одному на тип, а собеседников в разрешении
 *  бывает несколько. */
function* eachAttribute(message: StunMessage): Generator<[number, Buffer]> {
  const length = message.raw.readUInt16BE(2);
  let at = 20;
  const end = 20 + length;
  while (at + 4 <= end) {
    const type = message.raw.readUInt16BE(at);
    const size = message.raw.readUInt16BE(at + 2);
    if (at + 4 + size > end) return;
    yield [type, message.raw.subarray(at + 4, at + 4 + size)];
    at += 4 + size + ((4 - (size % 4)) % 4);
  }
}

/**
 * Свой адрес в домашней сети — им ретранслятор называет себя, когда
 * внешний адрес не задан.
 *
 * Просто «первая невнутренняя сетевая карта» здесь не годится: на
 * живой машине их несколько, и первой оказывается виртуальная —
 * туннель VPN, мост Docker, адаптер виртуалки. Замерено на этом же
 * ноутбуке: первой шла карта happ-tun с адресом 172.18.0.1, и
 * ретранслятор называл себя им — адресом, которого в домашней сети
 * не существует.
 *
 * Спрашивать систему «каким адресом ты пошла бы наружу» тоже нельзя:
 * при включённом VPN она честно отвечает адресом туннеля, а нам нужен
 * не путь в интернет, а адрес, по которому до нас достучатся.
 */
export function localIPv4(): string {
  const virtual = /vethernet|wsl|docker|virtualbox|vmware|hyper-v|loopback|tap|tun|vpn/i;
  const candidates: string[] = [];

  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family !== "IPv4" || item.internal) continue;
      if (virtual.test(name)) continue;
      candidates.push(item.address);
    }
  }

  // Обычные домашние сети — 192.168.x и 10.x. Диапазон 172.16–172.31
  // формально тоже частный, но именно в нём живут мосты Docker
  // и туннели VPN, поэтому он идёт последним.
  const home = candidates.find((a) => a.startsWith("192.168.") || a.startsWith("10."));
  return home ?? candidates[0] ?? "127.0.0.1";
}
