import { getPreferences } from "./preferences";

/**
 * Короткие сигналы разговора: кто-то зашёл, кто-то вышел, включили
 * или выключили показ экрана.
 *
 * Звуки не файлы, а несколько нот, собранных на месте. Причин две.
 * Первая: файл — это лишние килобайты в каждой загрузке приложения
 * и ещё один путь, который может однажды не найтись. Вторая: сигнал
 * из чистых тонов слышно поверх разговора, не перекрикивая его, —
 * ровно то, что нужно.
 *
 * Свой звуковой движок, а не общий с разговором: сигнал «я вышел»
 * звучит ровно тогда, когда разговор уже свернули, и в общем движке
 * ему играть было бы негде.
 */

export type Sound = "join" | "leave" | "screenOn" | "screenOff" | "ring" | "callout";

/** Нота: когда начать (в секундах от начала), высота и длительность. */
interface Note {
  at: number;
  hz: number;
  ms: number;
}

/**
 * Вверх — появление, вниз — исчезновение. Это единственное, что
 * человек должен различать не задумываясь: зашёл кто-то или вышел,
 * понятно по направлению, а не по тому, запомнил ли он два похожих
 * звука.
 *
 * Ноты взяты из одного аккорда, чтобы два сигнала подряд (вышел один,
 * тут же зашёл другой) не резали слух.
 */
const NOTES: Record<Sound, Note[]> = {
  // до-соль вверх
  join: [
    { at: 0, hz: 523.25, ms: 80 },
    { at: 0.065, hz: 783.99, ms: 150 },
  ],
  // соль-до вниз
  leave: [
    { at: 0, hz: 783.99, ms: 80 },
    { at: 0.065, hz: 523.25, ms: 170 },
  ],
  // три ноты вверх — заметнее, чем вход: показ экрана событие более
  // редкое, и его стоит расслышать.
  screenOn: [
    { at: 0, hz: 659.25, ms: 60 },
    { at: 0.055, hz: 987.77, ms: 60 },
    { at: 0.11, hz: 1318.51, ms: 130 },
  ],
  screenOff: [
    { at: 0, hz: 1318.51, ms: 60 },
    { at: 0.055, hz: 987.77, ms: 60 },
    { at: 0.11, hz: 659.25, ms: 150 },
  ],
  /** Входящий звонок: две ноты подряд, как у телефона. Играется
   *  повторами — сам по себе это один «дзинь», а не мелодия. */
  ring: [
    { at: 0, hz: 659.25, ms: 260 },
    { at: 0.32, hz: 659.25, ms: 260 },
  ],
  /** Гудок звонящему: одна нота ниже и глуше входящей, чтобы два
   *  человека, слушая каждый своё, слышали разное. */
  callout: [{ at: 0, hz: 440, ms: 320 }],
};

/** Звонок звучит, пока не ответят: один «дзинь» раз в полтора
 *  секунды — так звонит телефон, и так это отличается от короткого
 *  сигнала «кто-то зашёл». */
const REPEAT_MS = 1600;

let ringing: ReturnType<typeof setInterval> | null = null;

/** Завести повторяющийся сигнал. Второй вызов ничего не ломает:
 *  звонок один, даже если событие пришло дважды. */
export function startRinging(name: Sound): void {
  if (ringing) return;
  playSound(name);
  ringing = setInterval(() => playSound(name), REPEAT_MS);
}

export function stopRinging(): void {
  if (!ringing) return;
  clearInterval(ringing);
  ringing = null;
}

let context: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  try {
    context ??= new AudioContext();
    // Браузер держит движок остановленным, пока на странице ничего
    // не нажимали. К моменту первого сигнала нажимали уже наверняка,
    // но запрос отправляем на всякий случай — молчание тут выглядело
    // бы поломкой.
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    return null;
  }
}

/** Отправить сигналы в те же наушники, что и разговор. */
async function routeToSpeaker(ctx: AudioContext): Promise<void> {
  const id = getPreferences().speakerId;
  const target = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (typeof target.setSinkId !== "function") return;
  try {
    await target.setSinkId(id || "");
  } catch {
    // Устройство исчезло — остаёмся на системном.
  }
}

export function playSound(name: Sound): void {
  const volume = getPreferences().soundVolume;
  if (volume <= 0) return;

  const ctx = ensureContext();
  if (!ctx) return;
  void routeToSpeaker(ctx);

  const start = ctx.currentTime + 0.01;

  for (const note of NOTES[name]) {
    const at = start + note.at;
    const until = at + note.ms / 1000;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    // Мягкий заход и спад: щелчки на резком включении синусоиды
    // слышны отчётливее самой ноты.
    gain.gain.linearRampToValueAtTime(volume * 0.22, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, until);
    gain.connect(ctx.destination);

    // Основной тон и октава сверху вполовину тише: чистая синусоида
    // сама по себе звучит как будильник, а с октавой — как сигнал.
    for (const [multiplier, share] of [
      [1, 1],
      [2, 0.35],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = note.hz * multiplier;
      const mix = ctx.createGain();
      mix.gain.value = share;
      osc.connect(mix).connect(gain);
      osc.start(at);
      osc.stop(until + 0.02);
    }
  }
}
