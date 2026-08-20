import { useSyncExternalStore } from "react";

/** Личные настройки внешнего вида.
 *
 *  Живут в localStorage, а не на сервере, и это осознанно: это
 *  свойства устройства, а не учётной записи. На рабочем мониторе
 *  уместна компактная лента, на ноутбуке в дороге — нет, и тащить
 *  такое между устройствами было бы вредно. */
export interface Preferences {
  compact: boolean;
  reducedMotion: boolean;
  alwaysTime: boolean;
  /** Микрофон и динамики. Пустая строка — устройство по умолчанию,
   *  то, что выбрано в Windows. Хранится идентификатор устройства;
   *  он меняется при смене учётной записи Windows, поэтому исчезнувшее
   *  устройство молча заменяется системным. */
  micId: string;
  speakerId: string;
  /** Громкость своего микрофона и общая громкость разговора, 0–2
   *  (то есть до 200%). Единица — как есть. */
  micGain: number;
  outputGain: number;
  /** Подтягивать тихий голос самому — вместо браузерного автоусиления,
   *  которое выключено ради шумодава. Оно тянет вверх и шум в паузах,
   *  наше стоит после чистки и тянуть может только голос. */
  autoGain: boolean;
  /** Обработка микрофона.
   *
   *  Эхоподавление убирает из микрофона то, что играет в динамиках, —
   *  без него собеседник слышит сам себя, стоит сесть без наушников.
   *  Шумоподавление срезает вентилятор, клавиатуру и улицу за окном.
   *
   *  Обе включены по умолчанию и выключаются вручную: обработка
   *  подъедает и тихие звуки тоже, и тому, кто говорит в микрофон
   *  под гитару, она мешает больше, чем помогает. */
  echoCancel: boolean;
  noiseSuppress: boolean;
  /** Свой шумодав вместо браузерного.
   *
   *  Браузерный — одна галочка без настроек: он давит ровный гул
   *  и тянет за собой автоусиление, которое в тишине вытягивает шум
   *  обратно. Свой считает шум по каждой полосе частот отдельно
   *  и убирает его целиком.
   *
   *  "soft" — осторожно, голос точно не тронет. "strong" — вентилятор
   *  и гул уходят почти полностью, но очень тихий шёпот может
   *  подъедаться вместе с ними. */
  denoise: "off" | "soft" | "strong";
  /** Когда показывать окошко со списком говорящих. Только в приложении:
   *  вкладка браузера поверх чужой игры ничего рисовать не может.
   *
   *  "game" — только пока запущено что-то из overlayGames. Поверх
   *  браузера или документа список висит просто так: там и без него
   *  видно, кто говорит, — мессенджер под рукой. */
  overlayMode: "always" | "game" | "never";
  /** Имена исполняемых файлов игр, по которым оболочка понимает,
   *  что идёт игра. Определить это честно нельзя: в игру мы
   *  не встраиваемся, а Windows сама не знает, что считать игрой. */
  overlayGames: string[];
  /** Как игра называется по-человечески: RustClient.exe → Rust.
   *  Берётся из заголовка окна в момент, когда её отмечают в списке.
   *  Друзья видят именно это, а не имя файла. */
  gameNames: Record<string, string>;
  /** Говорить ли, когда друг запустил игру, в которую играем и мы. */
  gameAlerts: boolean;
  /** Во что играли мы сами. Нужно ровно для предыдущей строки:
   *  без этого уведомление приходило бы на любую чужую игру, включая
   *  ту, которую мы никогда не ставили. Заполняется само. */
  myGames: string[];
  /** Где стоит окошко — доля свободного места, 0..1 от левого верхнего
   *  угла. Долей, а не точкой в пикселях: у разных мониторов разное
   *  разрешение, и окошко, поставленное в угол на одном, должно
   *  оказаться в углу и на другом.
   *
   *  Раньше выбирался один из четырёх углов — потому что подвинуть
   *  окошко мышью было нельзя, оно сквозное. Теперь его таскают
   *  в открытом меню оверлея, где мышь ловится. */
  overlayPos: { x: number; y: number };
  /** Размер окошка. На 1080p обычный великоват, на 1440p мелковат. */
  overlayScale: number;
  /** Клавиша, открывающая меню оверлея. Занимается, только пока идёт
   *  разговор: держать её занятой всё время работы приложения — значит
   *  отбирать её у игр без всякой надобности. */
  overlayKey: string;
  /** Громкость каждого собеседника отдельно: кто → 0–2. Только для
   *  себя — остальных это не касается и по сети не уходит. */
  userGain: Record<string, number>;
  /** Кого мы заглушили лично для себя. */
  mutedUsers: string[];
  /** Качество демонстрации экрана.
   *
   *  "source" — как есть, без уменьшения. Остальное — потолок по
   *  высоте кадра: 720 и 1080. Чем меньше, тем меньше работы
   *  кодировщику и тем меньше трафика — в том числе через
   *  ретранслятор, где за него платим мы. */
  screenHeight: 720 | 1080 | 0;
  /** Кадров в секунду у демонстрации. Пятнадцати хватает тексту
   *  и таблицам, шестьдесят нужны игре. */
  screenFps: 15 | 30 | 60;
  /** Громкость сигналов «зашёл», «вышел», «включил показ», 0–1.
   *  Ноль — не звучат вовсе. Отдельно от громкости разговора: сигналы
   *  должны быть слышны поверх голосов, а не тонуть вместе с ними. */
  soundVolume: number;
  /** Рация: "off" — микрофон всегда открыт, "hold" — говорить, пока
   *  клавиша нажата, "toggle" — нажатие переключает. Работает только
   *  в приложении: браузер не видит клавиш вне своего окна. */
  pttMode: "off" | "hold" | "toggle";
  pttKey: string;
}

const DEFAULTS: Preferences = {
  compact: false,
  reducedMotion: false,
  alwaysTime: false,
  micId: "",
  speakerId: "",
  micGain: 1,
  outputGain: 1,
  autoGain: true,
  echoCancel: true,
  noiseSuppress: true,
  // Сильное — по умолчанию. Замер на сигнале «речь плюс ровный шум»:
  // шума убирается 24 дБ, голоса теряется 0,2 дБ, считается это
  // в полтора процента ядра. Браузерный при этом выключается: две
  // чистки подряд глушат согласные.
  denoise: "strong",
  overlayMode: "always",
  overlayGames: [],
  gameNames: {},
  gameAlerts: true,
  myGames: [],
  overlayPos: { x: 0, y: 0 },
  overlayScale: 1,
  // Shift+F1 — не занята почти нигде и не спорит с рацией на F8–F11.
  overlayKey: "Shift+F1",
  userGain: {},
  mutedUsers: [],
  // По умолчанию 720p и 30 кадров, а не «как есть».
  //
  // Раньше экран брался в родном разрешении, и это дорого обходилось
  // тем, у кого захват идёт по медленному пути: подтормаживает вся
  // система, видно даже по указателю мыши. Замерено на машине с i7
  // и RTX 4060 — то есть дело не в слабом железе.
  //
  // Семьсот двадцать при тридцати кадрах — это вчетверо меньше работы,
  // чем 1080p, и на глаз разница в игре почти незаметна. Кому нужно
  // чётче, поднимет сам; но по умолчанию приложение не должно душить
  // компьютер того, кто ничего не настраивал.
  screenHeight: 720,
  screenFps: 30,
  soundVolume: 0.6,
  pttMode: "off",
  // F9 — не занята в большинстве игр и не мешает печатать.
  pttKey: "F9",
};

const KEY = "messenger:prefs";

/** Громкость держим в пределах 0–200%: выше начинается не «громче»,
 *  а хрип, а в хранилище может лежать что угодно из прошлой версии. */
/**
 * Потолки громкости.
 *
 * Двести процентов оказалось мало: у одного друга гарнитура шепчет,
 * и на пределе он всё равно был тише остальных. Теперь общий предел
 * втрое, а личный — впятеро: именно личным и вытягивают того самого
 * тихого, не делая громче всех остальных.
 *
 * Такие числа безопасны только вместе с ограничителем в цепочке —
 * без него это был бы способ получить треск вместо голоса.
 */
export const MAX_GAIN = 3;
export const MAX_USER_GAIN = 5;

function clampGain(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 1;
  return Math.min(MAX_GAIN, Math.max(0, n));
}

/** Личная громкость собеседника — её потолок выше общего. */
function clampUserGain(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 1;
  return Math.min(MAX_USER_GAIN, Math.max(0, n));
}

/** Громкость сигналов — 0–100%: усиливать их сверх ста незачем,
 *  это не голос собеседника, а служебный писк. */
function clampVolume(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULTS.soundVolume;
  return Math.min(1, Math.max(0, value));
}

/** Значение из заранее известного набора. В хранилище может лежать
 *  что угодно из прошлой версии или чужой вкладки, а подставить
 *  «1440» туда, где мы ждём 720, — это молча сломанный захват. */
function oneOf<T extends number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Значение из заранее известного набора строк. В хранилище может
 *  лежать что угодно из прошлой версии или чужой вкладки. */
function oneOfString<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Углы, из которых оверлей выбирали раньше. Нужны ровно затем, чтобы
 *  у тех, кто уже что-то выбрал, окошко после обновления осталось
 *  на своём месте, а не прыгнуло в левый верх. */
const CORNERS: Record<string, { x: number; y: number }> = {
  "top-left": { x: 0, y: 0 },
  "top-right": { x: 1, y: 0 },
  "bottom-left": { x: 0, y: 1 },
  "bottom-right": { x: 1, y: 1 },
};

function readPos(parsed: Record<string, unknown>): { x: number; y: number } {
  const pos = parsed.overlayPos;
  if (pos && typeof pos === "object") {
    const { x, y } = pos as { x?: unknown; y?: unknown };
    if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) {
      return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
    }
  }
  return CORNERS[String(parsed.overlayCorner)] ?? DEFAULTS.overlayPos;
}

function read(): Preferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    // Ключи сверяем с умолчаниями, а не берём как есть: в хранилище
    // может лежать что угодно из прошлой версии или чужой вкладки.
    const parsed = JSON.parse(raw) as Partial<Preferences> & Record<string, unknown>;
    return {
      compact: parsed.compact ?? DEFAULTS.compact,
      reducedMotion: parsed.reducedMotion ?? DEFAULTS.reducedMotion,
      alwaysTime: parsed.alwaysTime ?? DEFAULTS.alwaysTime,
      micId: parsed.micId ?? DEFAULTS.micId,
      speakerId: parsed.speakerId ?? DEFAULTS.speakerId,
      micGain: clampGain(parsed.micGain),
      outputGain: clampGain(parsed.outputGain),
      autoGain: parsed.autoGain ?? DEFAULTS.autoGain,
      echoCancel: parsed.echoCancel ?? DEFAULTS.echoCancel,
      noiseSuppress: parsed.noiseSuppress ?? DEFAULTS.noiseSuppress,
      denoise: oneOfString(parsed.denoise, ["off", "soft", "strong"] as const, DEFAULTS.denoise),
      // Раньше это был переключатель «да/нет». У тех, кто его выключил,
      // выключенным и остаётся — просто теперь это один из трёх ответов.
      overlayMode: oneOfString(
        parsed.overlayMode ?? (parsed.overlay === false ? "never" : undefined),
        ["always", "game", "never"] as const,
        DEFAULTS.overlayMode,
      ),
      overlayGames: Array.isArray(parsed.overlayGames)
        ? parsed.overlayGames.filter((name): name is string => typeof name === "string")
        : DEFAULTS.overlayGames,
      gameAlerts: parsed.gameAlerts ?? DEFAULTS.gameAlerts,
      myGames: Array.isArray(parsed.myGames)
        ? parsed.myGames.filter((n: unknown) => typeof n === "string").slice(0, 10)
        : [],
      gameNames:
        typeof parsed.gameNames === "object" && parsed.gameNames
          ? (parsed.gameNames as Record<string, string>)
          : {},
      overlayPos: readPos(parsed),
      overlayScale: oneOf(parsed.overlayScale, [0.8, 1, 1.25], DEFAULTS.overlayScale),
      overlayKey: parsed.overlayKey ?? DEFAULTS.overlayKey,
      // Значения чужие: они пришли из хранилища браузера, которое
      // правится руками. Проверяем каждое — одно битое число здесь
      // означает разговор на полной громкости без предупреждения.
      userGain: Object.fromEntries(
        Object.entries(
          typeof parsed.userGain === "object" && parsed.userGain ? parsed.userGain : {},
        ).map(([id, value]) => [id, clampUserGain(value)]),
      ),
      mutedUsers: Array.isArray(parsed.mutedUsers) ? parsed.mutedUsers : [],
      screenHeight: oneOf(parsed.screenHeight, [720, 1080, 0], DEFAULTS.screenHeight),
      screenFps: oneOf(parsed.screenFps, [15, 30, 60], DEFAULTS.screenFps),
      soundVolume: clampVolume(parsed.soundVolume),
      pttMode: parsed.pttMode ?? DEFAULTS.pttMode,
      pttKey: parsed.pttKey ?? DEFAULTS.pttKey,
    };
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Класс на <html> — чтобы стили могли реагировать без пробрасывания
 *  настройки через десяток компонентов. */
export function applyPreferences(prefs: Preferences = current): void {
  const root = document.documentElement;
  root.classList.toggle("prefs-compact", prefs.compact);
  root.classList.toggle("prefs-still", prefs.reducedMotion);
  root.classList.toggle("prefs-always-time", prefs.alwaysTime);
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  current = { ...current, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Приватный режим может запретить запись. Настройка всё равно
    // применится к текущей сессии — это лучше, чем упасть.
  }
  applyPreferences();
  emit();
}

/** Настройки вне React: голосовой слой к хукам доступа не имеет,
 *  а выбранный микрофон ему нужен. */
export function getPreferences(): Preferences {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreferences(): {
  prefs: Preferences;
  setPref: typeof setPreference;
} {
  const prefs = useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULTS,
  );
  return { prefs, setPref: setPreference };
}
