import type { Device, Transport, Producer, Consumer } from "mediasoup-client/types";
import { getSocket } from "./socket";

/**
 * Раздача: показ уходит на сервер один раз, а размножает его он.
 *
 * До этого показывающий кодировал свой экран отдельно для каждого
 * собеседника и отправлял столько раз, сколько людей в канале.
 * Вчетвером — трижды: втрое больше работы кодировщику и втрое больше
 * отдачи от домашнего канала. Замер (apps/desktop/scripts/check-share.cjs)
 * показал, чем это кончается: при нехватке кодировщик роняет и размер,
 * и кадры сразу.
 *
 * Здесь — только картинка и звук показа. Голос микрофона по-прежнему
 * ходит напрямую: он весит копейки, а прямая дорога короче.
 *
 * Всё это может не завестись — на сервере может не оказаться раздачи,
 * а у браузера может не найтись общего языка с ней. Тогда мессенджер
 * возвращается к прежнему способу «каждому свой поток»: он никуда
 * не делся, и переключение незаметно для человека.
 */

export type Что = "screen" | "screenAudio" | "video";

/** Как идёт наша отдача. Байты и время — чтобы посчитать скорость:
 *  сама по себе она в статистике не лежит, её считают по разнице. */
export interface Отдача {
  fps: number | null;
  предел: "cpu" | "bandwidth" | null;
  width: number | null;
  height: number | null;
  байт: number | null;
  когда: number;
}

/** Что приехало от собеседника. Дорожки одного показа приезжают
 *  порознь — картинка отдельно, звук отдельно, — и собирает их
 *  в один поток тот, кто выше. */
export interface Гость {
  userId: string;
  что: Что;
  track: MediaStreamTrack;
}

interface Запрос {
  <T>(событие: string, данные?: unknown): Promise<T | null>;
}

/** Разговор с сервером с ограничением по времени: молчащий сервер
 *  не должен подвешивать показ навсегда. */
const спросить: Запрос = async <T,>(событие: string, данные?: unknown) => {
  const socket = getSocket();
  if (!socket?.connected) return null;
  try {
    const канал = socket.timeout(8000) as unknown as {
      emitWithAck: (событие: string, ...данные: unknown[]) => Promise<T>;
    };
    /*
     * Пустой довод — не то же самое, что его отсутствие.
     *
     * Часть запросов данных не несёт вовсе: «умеешь ли раздавать»,
     * «что сейчас идёт». Если отправить им undefined как довод,
     * ответчик на сервере окажется вторым по счёту, а первым —
     * та самая пустота. Сервер честно решит, что отвечать некому,
     * и промолчит; а мессенджер решит, что раздачи нет.
     */
    const ответ = (await (данные === undefined
      ? канал.emitWithAck(событие)
      : канал.emitWithAck(событие, данные))) as T;
    return ответ ?? null;
  } catch {
    return null;
  }
};

export class Раздача {
  private device: Device | null = null;
  private send: Transport | null = null;
  private recv: Transport | null = null;
  private producers = new Map<Что, Producer>();
  private consumers = new Map<string, Consumer>();
  /** Что уже подписано — чтобы не подписаться дважды на один поток. */
  private подписаны = new Set<string>();
  /**
   * Незаконченные приготовления.
   *
   * И знакомство с сервером, и заведение дороги нужны сразу нескольким:
   * показывающему — чтобы отдать, смотрящему — чтобы принять, и оба
   * могут спохватиться одновременно. Без этой памяти получались две
   * половины на одно место: два знакомства (и второе затирало первое,
   * оставляя дорогу от чужого) или две дороги на одну серверную —
   * и картинка приходила пакетов на десять, а потом замолкала.
   */
  private готовность: Promise<boolean> | null = null;
  private дороги = new Map<"send" | "recv", Promise<Transport | null>>();
  private закрыта = false;

  constructor(
    private приехало: (гость: Гость) => void,
    private уехало: (userId: string, что: Что) => void,
  ) {}

  /**
   * Готова ли раздача.
   *
   * Спрашиваем сервер и заодно учим браузер тому, что тот умеет.
   * Ответ «нет» — не поломка: значит, показ пойдёт по-старому.
   */
  async готова(): Promise<boolean> {
    if (this.закрыта) return false;
    if (this.device?.loaded) return true;

    // Спрашивают несколько — знакомимся один раз.
    this.готовность ??= this.познакомиться().finally(() => {
      this.готовность = null;
    });
    return this.готовность;
  }

  private async познакомиться(): Promise<boolean> {
    const возможности = await спросить<Record<string, unknown>>("sfu:capabilities");
    if (!возможности) return false;

    try {
      /*
       * Библиотеку раздачи подгружаем в этот момент, а не при запуске.
       *
       * Она весит четверть мессенджера, а нужна только тем, кто зашёл
       * в разговор. Тому, кто открыл переписку с телефона, платить
       * за неё загрузкой незачем.
       */
      const { Device } = await import("mediasoup-client");
      const device = new Device();
      await device.load({ routerRtpCapabilities: возможности as never });
      this.device = device;
      return true;
    } catch {
      // Браузер не нашёл общего языка с сервером — редкость, но
      // возможная. Показ пойдёт напрямую.
      return false;
    }
  }

  /** Дорога до сервера. Заводится лениво: показывают не всегда,
   *  а смотрят и того реже. */
  private async дорога(куда: "send" | "recv"): Promise<Transport | null> {
    const была = куда === "send" ? this.send : this.recv;
    if (была && !была.closed) return была;

    // Спохватиться могут двое сразу — заводим одну.
    const идёт = this.дороги.get(куда);
    if (идёт) return идёт;

    const работа = this.завестиДорогу(куда).finally(() => this.дороги.delete(куда));
    this.дороги.set(куда, работа);
    return работа;
  }

  private async завестиДорогу(куда: "send" | "recv"): Promise<Transport | null> {
    if (!(await this.готова()) || !this.device) return null;

    const данные = await спросить<{
      id: string;
      iceParameters: unknown;
      iceCandidates: unknown;
      dtlsParameters: unknown;
    }>("sfu:transport", { куда });
    if (!данные) return null;

    const транспорт =
      куда === "send"
        ? this.device.createSendTransport(данные as never)
        : this.device.createRecvTransport(данные as never);

    // Рукопожатие. Библиотека зовёт это сама, когда дорога впервые
    // понадобилась, — нам остаётся передать её половину ключей серверу.
    транспорт.on("connect", ({ dtlsParameters }, готово, беда) => {
      void спросить<boolean>("sfu:connect", {
        transportId: транспорт.id,
        dtlsParameters,
      }).then((вышло) => (вышло ? готово() : беда(new Error("Сервер не принял ключи"))));
    });

    if (куда === "send") {
      транспорт.on("produce", ({ kind, rtpParameters, appData }, готово, беда) => {
        void спросить<string>("sfu:produce", {
          transportId: транспорт.id,
          kind,
          rtpParameters,
          что: (appData as { что?: Что }).что,
        }).then((id) => (id ? готово({ id }) : беда(new Error("Сервер не принял поток"))));
      });
    }

    if (куда === "send") this.send = транспорт;
    else this.recv = транспорт;
    return транспорт;
  }

  /**
   * Отдать свою дорожку.
   *
   * Возвращает, вышло ли: не вышло — зовущий отправит её по-старому,
   * каждому собеседнику отдельно.
   */
  async отдать(track: MediaStreamTrack, что: Что, потолок: number): Promise<boolean> {
    const дорога = await this.дорога("send");
    if (!дорога) return false;

    try {
      const producer = await дорога.produce({
        track,
        appData: { что },
        /*
         * Дорожку раздача не трогает.
         *
         * По умолчанию она считает дорожку своей и останавливает её,
         * закрывая поток. А дорожка не её: захват завёл разговор, он же
         * и закрывает — иначе один закрытый поток гасит камеру, которая
         * в этот момент уходит совсем другим путём. Снаружи это
         * выглядит как «показ замер через секунду».
         */
        stopTracks: false,
        ...(track.kind === "video"
          ? {
              encodings: [{ maxBitrate: потолок }],
              // Экрану важна плавность: по дёргающейся картинке следить
              // за чужой игрой невозможно.
              codecOptions: { videoGoogleStartBitrate: Math.round(потолок / 2000) },
            }
          : {}),
      });

      this.producers.get(что)?.close();
      this.producers.set(что, producer);
      producer.on("transportclose", () => this.producers.delete(что));

      /*
       * Чем жертвовать, когда тесно, — решаем мы, а не браузер.
       *
       * Браузер, предоставленный сам себе, для показа экрана бережёт
       * чёткость и роняет кадры: он считает, что показывают текст.
       * Для игры это ровно наоборот. Размером при нехватке жертвует
       * мессенджер — сам, ступенями и не вслепую (см. lib/adapt.ts), —
       * а кодировщику остаётся держать частоту.
       */
      if (track.kind === "video") {
        try {
          const параметры = producer.rtpSender?.getParameters();
          if (параметры) {
            параметры.degradationPreference = "maintain-framerate";
            await producer.rtpSender?.setParameters(параметры);
          }
        } catch {
          // Не приняли — не беда: это подсказка, а не условие.
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /** Поменять потолок на лету — когда показ сам опустился ступенью
   *  ниже ради кадров. */
  async потолок(что: Что, битов: number): Promise<void> {
    const producer = this.producers.get(что);
    if (!producer || producer.closed) return;
    try {
      const параметры = producer.rtpSender?.getParameters();
      if (!параметры?.encodings?.length) return;
      for (const encoding of параметры.encodings) encoding.maxBitrate = битов;
      await producer.rtpSender?.setParameters(параметры);
    } catch {
      // Не дали — не беда: потолок не главное из того, что здесь есть.
    }
  }

  /**
   * Как идёт наша отдача: кадры и во что упёрлось.
   *
   * Спрашиваем у той же дорожки, что и раньше у прямых соединений, —
   * только теперь она одна на всех, а не по одной на собеседника.
   * Это и есть та самая экономия, ради которой всё делалось: считать
   * стало нечего, потому что поток один.
   */
  async какИдёт(что: Что): Promise<Отдача | null> {
    const producer = this.producers.get(что);
    if (!producer || producer.closed) return null;

    try {
      const записи = await producer.getStats();
      const итог: Отдача = {
        fps: null,
        предел: null,
        width: null,
        height: null,
        байт: null,
        когда: performance.now(),
      };

      записи.forEach((запись: Record<string, unknown>) => {
        if (запись.type !== "outbound-rtp" || запись.kind !== "video") return;
        if (typeof запись.framesPerSecond === "number") итог.fps = запись.framesPerSecond;
        if (typeof запись.frameWidth === "number") итог.width = запись.frameWidth;
        if (typeof запись.frameHeight === "number") итог.height = запись.frameHeight;
        if (typeof запись.bytesSent === "number") итог.байт = запись.bytesSent;
        const почему = запись.qualityLimitationReason;
        if (почему === "cpu" || почему === "bandwidth") итог.предел = почему;
      });

      return итог;
    } catch {
      return null;
    }
  }

  /** Прекратить раздавать своё. */
  прекратить(что: Что): void {
    const producer = this.producers.get(что);
    if (!producer) return;
    producer.close();
    this.producers.delete(что);
    getSocket()?.emit("sfu:stop", { что });
  }

  /** Подписаться на чужой поток. */
  async принять(producerId: string): Promise<void> {
    if (this.закрыта || this.подписаны.has(producerId)) return;
    this.подписаны.add(producerId);

    const дорога = await this.дорога("recv");
    if (!дорога || !this.device) {
      this.подписаны.delete(producerId);
      return;
    }

    const данные = await спросить<{
      id: string;
      producerId: string;
      kind: "audio" | "video";
      rtpParameters: unknown;
      userId: string;
      что: Что;
    }>("sfu:consume", {
      producerId,
      rtpCapabilities: this.device.rtpCapabilities,
    });

    if (!данные) {
      this.подписаны.delete(producerId);
      return;
    }

    try {
      const consumer = await дорога.consume({
        id: данные.id,
        producerId: данные.producerId,
        kind: данные.kind,
        rtpParameters: данные.rtpParameters as never,
        /*
         * Что это за поток — запоминаем прямо на подписке.
         *
         * Когда он кончится, сервер назовёт только его номер, а нам
         * нужно знать, что именно убирать: картинку показа, его звук
         * или камеру. Без этого всякий конец считался концом показа
         * целиком — и умолкнувший звук уносил с собой картинку.
         */
        appData: { что: данные.что },
      });

      this.consumers.set(producerId, consumer);
      consumer.on("transportclose", () => this.consumers.delete(producerId));

      this.приехало({ userId: данные.userId, что: данные.что, track: consumer.track });

      // Пускать кадры просим только теперь: до этого дорожка ещё
      // не привязана к проигрывателю, и первые кадры ушли бы впустую.
      await спросить<boolean>("sfu:resume", { consumerId: consumer.id });
    } catch {
      this.подписаны.delete(producerId);
    }
  }

  /** Чужой поток кончился. */
  убрать(producerId: string, userId: string): void {
    const consumer = this.consumers.get(producerId);
    if (!consumer) return;

    const что = (consumer.appData as { что?: Что }).что;
    consumer.close();
    this.consumers.delete(producerId);
    this.подписаны.delete(producerId);
    this.уехало(userId, что ?? "screen");
  }

  /** Спросить, что уже раздаётся, и подписаться на всё сразу.
   *  Нужно тому, кто вошёл в разговор позже показывающего. */
  async догнать(): Promise<void> {
    const идёт = await спросить<{ producerId: string; userId: string; что: Что }[]>("sfu:running");
    for (const поток of идёт ?? []) await this.принять(поток.producerId);
  }

  /** Разговор кончился. */
  закрыть(): void {
    this.закрыта = true;
    this.готовность = null;
    this.дороги.clear();
    for (const producer of this.producers.values()) producer.close();
    for (const consumer of this.consumers.values()) consumer.close();
    this.producers.clear();
    this.consumers.clear();
    this.подписаны.clear();
    this.send?.close();
    this.recv?.close();
    this.send = null;
    this.recv = null;
    this.device = null;
  }
}
