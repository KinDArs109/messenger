import type { VoiceSignal } from "@messenger/shared";
import { api } from "./api";
import { getSocket } from "./socket";

/**
 * Голосовая связь.
 *
 * Схема — «каждый с каждым»: на N человек у каждого N−1 соединений.
 * Для компании друзей это правильный выбор — звук идёт напрямую,
 * задержка минимальная, а ноутбук с сервером в разговоре вообще
 * не участвует. Свести всё в один поток мог бы SFU-сервер, но его
 * надо где-то держать, а держать негде.
 *
 * За кадром остаётся честное ограничение: оба собеседника сидят
 * за NAT провайдера, и прямой путь находится не всегда. STUN-сервер
 * помогает его нащупать; когда не помогает, нужен TURN-ретранслятор,
 * которого у нас пока нет.
 */

/** Список серверов приходит с нашего сервера, а не зашит здесь:
 *  появится TURN-ретранслятор — его добавят строкой в .env, и это
 *  не потребует ни пересборки клиента, ни обновления .exe у друзей.
 *
 *  Запасной список на случай, если запрос не прошёл: без ICE-серверов
 *  соединение не построится вообще, а с ними — хотя бы в простых
 *  сетях. */
const FALLBACK: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.sipnet.ru:3478" },
];

let iceServers: RTCIceServer[] | null = null;

async function loadIceServers(): Promise<RTCIceServer[]> {
  if (iceServers) return iceServers;
  try {
    const r = await api.get<{ iceServers: RTCIceServer[] }>("/voice/ice");
    iceServers = r.iceServers.length > 0 ? r.iceServers : FALLBACK;
  } catch {
    iceServers = FALLBACK;
  }
  return iceServers;
}

export interface VoiceEvents {
  onPeerState: (userId: string, state: RTCPeerConnectionState) => void;
  onSpeaking: (userId: string, level: number) => void;
}

interface Peer {
  connection: RTCPeerConnection;
  audio: HTMLAudioElement;
  /** «Вежливая» сторона уступает при встречном предложении.
   *  Без этого правила два одновременных offer'а глушат друг друга,
   *  и соединение не устанавливается вовсе. Вежливость определяем
   *  сравнением идентификаторов — она нужна ровно у одного из двух. */
  polite: boolean;
  makingOffer: boolean;
}

class VoiceSession {
  private peers = new Map<string, Peer>();
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private meters = new Map<string, () => void>();
  private ice: RTCIceServer[] = FALLBACK;

  constructor(
    readonly channelId: string,
    readonly meId: string,
    private events: VoiceEvents,
  ) {}

  async start(): Promise<void> {
    this.ice = await loadIceServers();

    // Эхоподавление и шумодав включаем сразу: без них разговор
    // вдвоём в одной комнате превращается в свист.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.context = new AudioContext();
    this.watchLevel(this.meId, this.stream);
  }

  private peer(userId: string): Peer {
    const existing = this.peers.get(userId);
    if (existing) return existing;

    const connection = new RTCPeerConnection({ iceServers: this.ice });
    const audio = new Audio();
    audio.autoplay = true;

    const peer: Peer = {
      connection,
      audio,
      polite: this.meId < userId,
      makingOffer: false,
    };
    this.peers.set(userId, peer);

    for (const track of this.stream?.getTracks() ?? []) {
      connection.addTrack(track, this.stream!);
    }

    connection.ontrack = (event) => {
      const [remote] = event.streams;
      if (!remote) return;
      audio.srcObject = remote;
      void audio.play().catch(() => undefined);
      this.watchLevel(userId, remote);
    };

    connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.send(userId, {
        type: "candidate",
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
      });
    };

    connection.onconnectionstatechange = () => {
      this.events.onPeerState(userId, connection.connectionState);
      // Разорванное соединение пробуем поднять заново: сеть моргает,
      // и без этого разговор пришлось бы начинать сначала.
      if (connection.connectionState === "failed") connection.restartIce();
    };

    connection.onnegotiationneeded = () => {
      void (async () => {
        try {
          peer.makingOffer = true;
          await connection.setLocalDescription();
          const sdp = connection.localDescription?.sdp;
          if (sdp) this.send(userId, { type: "offer", sdp });
        } finally {
          peer.makingOffer = false;
        }
      })();
    };

    return peer;
  }

  /** Кто-то вошёл в канал. Предложение делает тот, кто был раньше:
   *  иначе оба бросаются соединяться одновременно. */
  connectTo(userId: string, initiate: boolean): void {
    const peer = this.peer(userId);
    if (!initiate) return;
    void (async () => {
      await peer.connection.setLocalDescription();
      const sdp = peer.connection.localDescription?.sdp;
      if (sdp) this.send(userId, { type: "offer", sdp });
    })();
  }

  async accept(from: string, signal: VoiceSignal): Promise<void> {
    const peer = this.peer(from);
    const pc = peer.connection;

    if (signal.type === "candidate") {
      try {
        await pc.addIceCandidate({
          candidate: signal.candidate,
          sdpMid: signal.sdpMid,
          sdpMLineIndex: signal.sdpMLineIndex,
        });
      } catch {
        // Кандидат, пришедший до описания сессии, отбрасывается —
        // это нормально, придёт следующий.
      }
      return;
    }

    const collision =
      signal.type === "offer" && (peer.makingOffer || pc.signalingState !== "stable");

    // Невежливая сторона при столкновении игнорирует чужое
    // предложение и настаивает на своём. Вежливая — уступает.
    if (collision && !peer.polite) return;

    await pc.setRemoteDescription({ type: signal.type, sdp: signal.sdp });

    if (signal.type === "offer") {
      await pc.setLocalDescription();
      const sdp = pc.localDescription?.sdp;
      if (sdp) this.send(from, { type: "answer", sdp });
    }
  }

  disconnect(userId: string): void {
    const peer = this.peers.get(userId);
    if (!peer) return;
    peer.connection.close();
    peer.audio.srcObject = null;
    this.peers.delete(userId);
    this.meters.get(userId)?.();
    this.meters.delete(userId);
  }

  setMuted(muted: boolean): void {
    for (const track of this.stream?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
  }

  stop(): void {
    for (const userId of [...this.peers.keys()]) this.disconnect(userId);
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    void this.context?.close();
    this.context = null;
    this.meters.clear();
  }

  /** Индикатор «говорит». Считаем громкость на месте, а не гоняем
   *  её по сети: это чисто локальная величина, и сорок сообщений
   *  в секунду ради зелёного кружка — плохая цена. */
  private watchLevel(userId: string, stream: MediaStream): void {
    if (!this.context) return;
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 512;
    this.context.createMediaStreamSource(stream).connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    let running = true;

    const tick = () => {
      if (!running) return;
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (const value of data) sum += value;
      this.events.onSpeaking(userId, sum / data.length / 255);
      setTimeout(tick, 150);
    };
    tick();

    this.meters.set(userId, () => {
      running = false;
    });
  }

  private send(to: string, signal: VoiceSignal): void {
    getSocket()?.emit("voice:signal", { to, signal });
  }
}

let session: VoiceSession | null = null;

export function currentSession(): VoiceSession | null {
  return session;
}

export async function startVoice(
  channelId: string,
  meId: string,
  events: VoiceEvents,
): Promise<VoiceSession> {
  stopVoice();
  const next = new VoiceSession(channelId, meId, events);
  await next.start();
  session = next;
  return next;
}

export function stopVoice(): void {
  session?.stop();
  session = null;
}
