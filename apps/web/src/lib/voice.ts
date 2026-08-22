import type { VoiceSignal } from "@messenger/shared";
import { api } from "./api";
import { isApp } from "./desktop";
import { guardScreenAudio, type EchoGuard } from "./echo";
import { завестиЗвукПоказа, type ЗвукПоказа } from "./screenSound";
import { getPreferences } from "./preferences";
import { просимH264 } from "./codecs";
import { Раздача, type Что } from "./sfu";
import { высотаСтупени, решить, НАЧАЛО, type Положение } from "./adapt";
import { SpeechGate, rmsOf } from "./speaking";
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
  // Те же и в том же порядке, что отдаёт сервер: серверы Google
  // из российских сетей молчат, и ставить их первыми — терять
  // секунды на ожидание.
  { urls: ["stun:stun.sipnet.ru:3478", "stun:stun.miwifi.com:3478"] },
];

let iceServers: RTCIceServer[] | null = null;
let iceLoadedAt = 0;

/** Насколько долго держим полученный список.
 *
 *  Раньше он запрашивался один раз за всё время работы. С появлением
 *  ретранслятора так нельзя: пароль к нему временный и через сутки
 *  перестаёт действовать, а приложение на компьютере живёт неделями.
 *  Час — это заведомо меньше срока годности и заведомо больше, чем
 *  промежуток между входами в разговор. */
const ICE_TTL_MS = 60 * 60 * 1000;

async function loadIceServers(): Promise<RTCIceServer[]> {
  if (iceServers && Date.now() - iceLoadedAt < ICE_TTL_MS) return iceServers;
  try {
    const r = await api.get<{ iceServers: RTCIceServer[] }>("/voice/ice");
    iceServers = r.iceServers.length > 0 ? r.iceServers : FALLBACK;
    iceLoadedAt = Date.now();
  } catch {
    // Запасной список не запоминаем как свежий: сеть могла моргнуть,
    // и следующая попытка должна снова сходить за настоящим.
    return iceServers ?? FALLBACK;
  }
  return iceServers;
}

export interface VoiceEvents {
  onPeerState: (userId: string, state: RTCPeerConnectionState) => void;
  /** Человек начал или перестал говорить. Не уровень, а решение:
   *  его принимает звуковой слой, у которого есть история замеров. */
  onSpeaking: (userId: string, speaking: boolean) => void;
  /** Задержка. toServer — до собеседника мерить не по чему (мы одни
   *  в канале), и показано время до нашего сервера. viaRelay — дорога
   *  легла через наш ретранслятор, а не напрямую. */
  onQuality: (rttMs: number | null, toServer: boolean, viaRelay: boolean) => void;
  /** Чужой экран появился или пропал. null — показ прекращён. */
  onScreen: (userId: string, stream: MediaStream | null) => void;
  /** Есть ли в чужом показе звук. Отдельным событием, потому что
   *  звуковая дорожка приезжает не вместе с картинкой, а позже,
   *  и своему потоку браузер о ней не сообщает. */
  onScreenSound: (userId: string, есть: boolean) => void;
  onVideo: (userId: string, stream: MediaStream | null) => void;
  /** Своя демонстрация не тянет: кодировщик режет картинку.
   *
   *  Причину сообщает сам браузер: "cpu" — не хватает процессора,
   *  "bandwidth" — не хватает канала. null — всё в порядке.
   *
   *  Нужно, чтобы человек не гадал, почему у друга дёргается: раньше
   *  об этом можно было узнать только по жалобе собеседника. */
  /**
   * Как идёт наш показ — числами, а не на глаз.
   *
   * «Плохое качество» — жалоба, по которой нельзя ничего починить:
   * плохо бывает от размера, от кадров, от полосы и от того, что
   * картинка вообще пошла не той дорогой. Поэтому мессенджер говорит
   * прямо, что именно у него сейчас происходит, — и человеку, и тому,
   * кто будет это чинить.
   */
  onScreenStats: (как: ПоказИдёт | null) => void;
  /** Мессенджер сам опустил показ, чтобы удержать кадры: высота, до
   *  которой опустил, или null — если показ идёт как выбрано. */
  onScreenScaled: (height: number | null) => void;
}

/**
 * Кадры и разрешение демонстрации задаются в настройках — см.
 * screenFps и screenHeight. Без явного потолка браузер выдаёт всё,
 * что может, и на отдаче четверым собеседникам картинка начинает
 * запаздывать.
 *
 * maintain-framerate говорит кодировщику, что при нехватке канала
 * жертвовать надо чёткостью, а не плавностью: замыленный, но живой
 * экран читается, дёргающийся — нет.
 */

/**
 * Сколько битов в секунду отдавать под экран.
 *
 * Не одно число на все случаи: 720p при пятнадцати кадрах и 1080p
 * при шестидесяти отличаются по объёму работы вшестеро, и общий
 * потолок либо душит первое, либо не сдерживает второе.
 *
 * Считаем от площади кадра и частоты. Коэффициент подобран так,
 * чтобы привычные 1080p при тридцати кадрах давали прежние два
 * с половиной мегабита — на них всё было настроено и проверено.
 */
/**
 * Сколько битов в секунду отдавать под экран — на одного собеседника.
 *
 * Число подобрано замером, а не на глаз: apps/desktop/scripts/check-share.cjs
 * гоняет ту же картинку в три соединения сразу и показывает, что
 * кодировщик делает с кадром при разной полосе. Оказалось, что скупость
 * здесь выходит боком: при полутора мегабитах кодировщик не «слегка
 * мылит», а режет 1080p до 640×360 — то самое «плохое качество», на
 * которое жалуются. При пяти он держит родной размер и ни во что
 * не упирается.
 *
 * Коэффициент считан от этого замера: 1080p при тридцати кадрах — пять
 * мегабит. Отсюда 720p30 — два с половиной, 720p60 — четыре с половиной,
 * 1080p15 — два с половиной.
 */
function screenBitrate(peers = 1, сейчас: number | null = null): number {
  const { screenHeight, screenFps } = getPreferences();
  // Считаем по тому, что отдаём на самом деле: мессенджер мог сам
  // опуститься ступенью ниже, чтобы удержать кадры. Ноль в настройках
  // означает «как есть» — тогда по самому частому экрану.
  const height = сейчас ?? (screenHeight > 0 ? screenHeight : 1080);
  const pixels = height * (height * (16 / 9));
  const base = 5_000_000 / (1080 * 1920 * 30);

  /*
   * Потолок на всю отдачу, а не на каждого.
   *
   * В сети «каждый с каждым» картинка уходит столько раз, сколько
   * собеседников: вчетвером — трижды. Восемь мегабит на каждого
   * означали бы двадцать четыре с одного домашнего канала, а столько
   * вверх не отдаёт почти никто. Браузер, конечно, сам опустится
   * до того, что проходит, — но опускается он через несколько секунд
   * рваной картинки, и лучше в них не входить вовсе.
   */
  const своё = Math.min(8_000_000, Math.round(pixels * screenFps * base));
  const общий = Math.round(15_000_000 / Math.max(1, peers));
  // Полтора мегабита — нижняя граница, ниже которой смысла в показе
  // уже нет: там не «хуже видно», там не видно.
  return Math.max(1_500_000, Math.min(своё, общий));
}


/** Камера скромнее экрана намеренно. Соединений «каждый с каждым»
 *  столько же, сколько собеседников, и своё лицо уходит в сеть
 *  столько же раз. Двадцать четыре кадра для лица достаточно —
 *  это не игра, а битрейт вдвое меньше экранного оставляет запас
 *  на сам экран, когда идут оба. */
const VIDEO_FPS = 24;

/** Сколько ждём раздачу, прежде чем пойти прежним путём.
 *
 *  Десять секунд — это долго для взгляда и мало для сети: рукопожатие
 *  с сервером обычно занимает доли секунды, а если не заняло, значит
 *  дороги нет и ждать больше нечего. */
const SFU_ЖДЁМ = 10_000;
const VIDEO_BITRATE = 1_200_000;

/** Просьба не брать в захват собственный вывод страницы. Появилась
 *  в браузерах недавно и в типах ещё не описана, поэтому объявляем
 *  сами — иначе её пришлось бы протаскивать приведением типа, а это
 *  скрыло бы и настоящие ошибки в соседних полях. */
interface ScreenAudioConstraints extends MediaTrackConstraints {
  restrictOwnAudio?: boolean;
}

/** Что именно человек показывает. Два вида идут одновременно
 *  и независимо: экран — в общее большое поле, камера — в его плитку. */
export type ShareKind = "screen" | "video";

interface Share {
  stream: MediaStream | null;
  /** Что каждому собеседнику отправлено — чтобы было что убрать,
   *  когда показ прекратится. */
  senders: Map<string, RTCRtpSender[]>;
  /** Объявлен ли поток остальным. Пока нет — дорожки не отправляем:
   *  кадры, обогнавшие объявление, принимающей стороне некуда деть. */
  published: boolean;
  /** Гаситель своего звука и исходный захват, который он заменил.
   *  Исходную дорожку держим отдельно: в потоке её уже нет, а
   *  остановить при выключении показа надо — иначе система так и
   *  будет считать, что мы слушаем её вывод. */
  guard: EchoGuard | null;
  raw: MediaStreamTrack | null;
}

const emptyShare = (): Share => ({
  stream: null,
  senders: new Map(),
  published: false,
  guard: null,
  raw: null,
});

const KINDS: readonly ShareKind[] = ["screen", "video"];

/**
 * Можно ли здесь захватить экран.
 *
 * На телефоне — нельзя. getDisplayMedia нет ни в Chrome на Android,
 * ни в Safari на iPhone, и это ограничение самих телефонов: доступ
 * к содержимому чужих приложений браузеру там не дают в принципе.
 * Проверять наличие метода бесполезно — он объявлен и там, но всегда
 * отказывает, причём после того, как человек уже нажал кнопку.
 * Поэтому спрашиваем про устройство ввода: там, где показывают
 * пальцем, показать экран нельзя, и предлагать надо камеру.
 */
/** Есть ли что переворачивать: передняя и задняя камеры.
 *
 *  Спрашивать браузер точным числом камер бесполезно — до выдачи
 *  доступа он не показывает ни их количество, ни названия, и это
 *  правильно: иначе список устройств стал бы отпечатком браузера.
 *  Признак устройства ввода отвечает на тот же вопрос честнее:
 *  вторая камера есть у телефонов, а у ноутбуков её не бывает. */
export function hasTwoCameras(): boolean {
  return matchMedia("(pointer: coarse)").matches && !isApp();
}

export function canShareScreen(): boolean {
  if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") return false;
  // В приложении окно выбора рисует сама оболочка, и захват работает
  // всегда — даже на ноутбуке с сенсорным экраном, который иначе
  // отвечал бы «здесь показывают пальцем» и лишался бы показа экрана.
  if (isApp()) return true;
  return !matchMedia("(pointer: coarse)").matches;
}

const selectedSpeaker = (): string => getPreferences().speakerId;

/**
 * Каким просим микрофон.
 *
 * Эхоподавление и шумодав по умолчанию включены: без них разговор
 * вдвоём в одной комнате превращается в свист, а вентилятор слышен
 * громче голоса. Но это обработка, и она подъедает тихое вместе
 * с лишним — поэтому выключаются.
 *
 * Автоусиление не спрашиваем отдельно: оно живёт в паре с шумодавом
 * (это части одной цепочки в браузере), и выключать его отдельной
 * галочкой значит завести настройку, разницу от которой не слышно.
 *
 * Устройство — ideal, а не exact: с exact пропавшая гарнитура
 * означала бы отказ входить в разговор вообще.
 */
function micConstraints(): MediaTrackConstraints {
  const { echoCancel, noiseSuppress, denoise, micId } = getPreferences();
  // Свой шумодав работает вместо браузерного, а не поверх: две чистки
  // подряд глушат согласные, а автоусиление браузера вдобавок
  // вытягивает шум в паузах до уровня голоса — ровно то, из-за чего
  // и кажется, что шумодава нет.
  const own = denoise !== "off";
  return {
    echoCancellation: echoCancel,
    noiseSuppression: own ? false : noiseSuppress,
    autoGainControl: own ? false : noiseSuppress,
    ...(micId ? { deviceId: { ideal: micId } } : {}),
  };
}

/**
 * Ограничитель — страховка от хрипа.
 *
 * Он ничего не делает, пока звук в пределах нормы, и резко придавливает
 * то, что вылезло за потолок. Нужен там, где мы усиливаем: усиление
 * без ограничителя честно доводит громкие слоги до предела цифры,
 * а предел цифры звучит как треск, и человек решает, что «сломался
 * микрофон».
 *
 * Порог −6 дБ и отношение 20:1 — это уже почти стена. Быстрая атака
 * (3 мс), чтобы не пропустить щелчок, и небыстрый отпуск (250 мс),
 * чтобы громкость не «дышала» между словами.
 */
function makeLimiter(context: AudioContext): DynamicsCompressorNode {
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  return limiter;
}

/** Динамики выбираются на самом элементе, а не при захвате: браузер
 *  умеет направить звук в конкретное устройство только так.
 *
 *  setSinkId есть не везде — в Firefox его нет вовсе. Там звук идёт
 *  в системное устройство по умолчанию, и это не повод ничего
 *  не воспроизводить. */
async function routeToSpeaker(audio: HTMLAudioElement): Promise<void> {
  const id = selectedSpeaker();
  if (!id) return;
  const element = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  if (typeof element.setSinkId !== "function") return;
  try {
    await element.setSinkId(id);
  } catch {
    // Устройство исчезло — остаёмся на системном.
  }
}

/**
 * Громкость собеседников — целиком на нашей стороне.
 *
 * Ползунок у одного человека не должен слышать никто другой: это его
 * наушники и его сосед, орущий в микрофон. Поэтому по сети не уходит
 * ничего — весь звук просто проходит через усилитель перед выходом.
 *
 * Путей два, и второй нужен по-настоящему. Основной — WebAudio: он
 * даёт и приглушить, и усилить до 200%, чего <audio> не умеет
 * (у него громкость только до единицы). Запасной — обычный элемент:
 * в браузерах, где у AudioContext нет выбора устройства вывода,
 * WebAudio отправил бы звук мимо выбранных наушников, и это хуже,
 * чем отсутствие усиления сверх ста процентов.
 */
interface Volume {
  /** Личный усилитель собеседника. */
  gain: GainNode;
  /** Источник из его потока. Держим ссылку, чтобы отсоединить. */
  source: MediaStreamAudioSourceNode;
}

/** Что показать человеку о его же показе. */
export interface ПоказИдёт {
  width: number | null;
  height: number | null;
  fps: number | null;
  /** Мегабит в секунду — то, что и правда уходит. */
  мбит: number | null;
  предел: "cpu" | "bandwidth" | null;
  /** Через сервер (раздача) или напрямую каждому. */
  черезСервер: boolean;
  /** Сколько собеседников получают картинку. */
  зрителей: number;
  /**
   * Гаситель собственного звука: на сколько децибел он убирает из
   * показа то, что мы сами играем в динамики.
   *
   * null — гасителя нет вовсе (не собрался или в захвате нет звука),
   * и тогда собеседник слышит в нашем показе сам себя. Знать об этом
   * должен показывающий: у него это лечится наушниками за секунду,
   * а собеседник может только терпеть.
   */
  эхо: number | null;
  /** Уходит ли с показом звук вообще. Показывая окно, звук отдать
   *  нельзя — система такого не умеет, — и человек об этом обычно
   *  узнаёт от собеседников. Лучше сказать сразу. */
  соЗвуком: boolean;
}

interface Peer {
  connection: RTCPeerConnection;
  audio: HTMLAudioElement;
  volume: Volume | null;
  /** Звук его показа. */
  screen: ЗвукПоказа | null;
  /** Каким потоком приходит его голос. Держим выбор: у показа звуковая
   *  дорожка приезжает отдельно от картинки и может обогнать объявление —
   *  и тогда поток показа неотличим от микрофонного. Приняв такой за
   *  микрофон, мы включали его дважды: через усилитель и через звук
   *  показа, с расхождением в доли секунды. Это слышно как эхо. */
  micStreamId: string | null;
  /** «Вежливая» сторона уступает при встречном предложении.
   *  Без этого правила два одновременных offer'а глушат друг друга,
   *  и соединение не устанавливается вовсе. Вежливость определяем
   *  сравнением идентификаторов — она нужна ровно у одного из двух. */
  polite: boolean;
  makingOffer: boolean;
  /** Сколько раз пробовали поднять оборвавшееся соединение. */
  restarts: number;
}

/**
 * Сколько раз пытаться пересобрать соединение, прежде чем признать,
 * что дороги нет.
 *
 * Раньше попытки не считались вовсе, и на паре, где прямой путь
 * не находится в принципе, получалась карусель: соединение падает,
 * мы его перезапускаем, оно падает снова. В журнале сервера это
 * выглядело как бесконечная череда предложений и ответов и как
 * десятки лишних адресов — по семьдесят с лишним на сторону вместо
 * обычных пяти. Толку ноль, а браузер и сеть заняты постоянно.
 *
 * Три попытки закрывают настоящие обрывы: моргнул wifi, сменилась
 * сеть. Если и после них не вышло — дело не в помехе, и дёргать
 * дальше бессмысленно.
 */
const MAX_ICE_RESTARTS = 3;

class VoiceSession {
  private peers = new Map<string, Peer>();
  /** Что уходит собеседникам: выход усилителя, а при его отсутствии —
   *  сам микрофон. */
  private stream: MediaStream | null = null;
  /** Настоящий микрофон. Держим отдельно: остановить надо именно его,
   *  выход усилителя железо не отпускает. */
  private mic: MediaStream | null = null;
  private micGain: GainNode | null = null;
  /** Вход усилителя. Держим ссылку, чтобы отцепить старый микрофон
   *  при смене устройства. */
  private micSource: MediaStreamAudioSourceNode | null = null;
  /** Свой шумодав. Загрузился ли он вообще — отдельно от того, стоит ли
   *  он сейчас в цепочке: настройку можно выключить и включить, а файл
   *  грузится один раз. */
  private denoise: AudioWorkletNode | null = null;
  private denoiseReady = false;
  private context: AudioContext | null = null;
  private meters = new Map<string, () => void>();
  private ice: RTCIceServer[] = FALLBACK;
  private qualityTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Раздача: показ уходит на сервер один раз, а размножает его он.
   *
   * Может не завестись — тогда остаётся прежний способ «каждому свой
   * поток», и это решается для каждого показа отдельно, в момент
   * включения.
   */
  private sfu: Раздача | null = null;
  /** Что от кого приехало через раздачу. Дорожки одного показа
   *  приезжают порознь, поэтому держим поток и добавляем в него. */
  private раздачей = new Map<string, { screen: MediaStream; video: MediaStream }>();
  /** И то же самое, но пришедшее напрямую: показывать наверх надо
   *  одно из двух, а решает это одно место — см. показать(). */
  private напрямую = new Map<string, { screen: MediaStream | null; video: MediaStream | null }>();
  /** Что из своего ушло через раздачу: по этому и решаем, слать ли
   *  его ещё и напрямую. */
  private черезРаздачу = new Set<ShareKind>();

  /* Насколько мы сами опустили показ ради кадров — см. lib/adapt.ts —
   * и какую высоту отдаём захвату сейчас. */
  private screenAdapt: Положение = НАЧАЛО;
  private screenNow: number | null = null;

  /** Свои показы: экран и камера. Раздельно, потому что идут вместе:
   *  показывать что-то на экране, оставаясь при этом в кадре, —
   *  обычное дело, а с одним потоком второе вытесняло бы первое. */
  private shares: Record<ShareKind, Share> = { screen: emptyShare(), video: emptyShare() };
  /** Кто каким потоком что показывает. Приходит сообщением с сервера
   *  и может опередить сами дорожки или отстать от них. */
  private announced = new Map<string, { screen: string | null; video: string | null }>();
  /** Всё, что пришло от собеседников, до разбора. Разбираем при каждом
   *  новом событии — так порядок «сначала дорожки, потом объявление»
   *  и обратный дают один и тот же результат. */
  private incoming = new Map<string, Map<string, MediaStream>>();

  /** Общий усилитель: через него проходит всё, что мы слышим.
   *  Личные громкости включены до него, поэтому общая работает
   *  поверх них, а не вместо. */
  private master: GainNode | null = null;
  /** Можно ли вести звук через WebAudio. Нельзя, если браузер не умеет
   *  направлять его в выбранные наушники — тогда усиление сверх 100%
   *  обменивалось бы на игнорирование выбора устройства. */
  private webAudioOutput = false;
  /** Последний узел перед динамиками: опора гасителя эха. */
  private вДинамики: AudioNode | null = null;
  /**
   * Чей показ мы согласились смотреть.
   *
   * Звук показа идёт только оттуда. Картинку чужого экрана мессенджер
   * и раньше не разворачивал без спроса, а звук при этом начинал
   * играть сам, стоило зайти в канал: человек ещё ничего не нажал,
   * а у него уже играет чужая игра. Одно и то же согласие должно
   * решать оба вопроса.
   */
  private смотрим: string | null = null;
  private deafened = false;

  constructor(
    readonly channelId: string,
    readonly meId: string,
    private events: VoiceEvents,
  ) {}

  async start(): Promise<void> {
    this.ice = await loadIceServers();

    // Раздачу поднимаем в фоне: разговор не должен ждать её, а если
    // она не заведётся — показ пойдёт прежним способом.
    void this.поднятьРаздачу().catch(() => undefined);

    this.mic = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
    this.context = new AudioContext();

    // Свой шумодав живёт отдельным файлом и загружается до того, как
    // собирается цепочка: подключить его на ходу нельзя, а собирается
    // она один раз.
    await this.loadDenoise();

    // Микрофон уходит собеседникам через усилитель — иначе тихую
    // гарнитуру нечем поднять. Но если что-то в этой цепочке не
    // соберётся, отправляем дорожку напрямую: остаться без голоса
    // из-за регулятора громкости — плохой размен.
    this.stream = this.buildMicChain() ?? this.mic;

    // Выбор наушников у AudioContext появился недавно и есть не везде.
    // Где его нет — ведём звук по старому пути, через сами элементы:
    // услышать собеседника не в тех наушниках хуже, чем не суметь
    // сделать его громче ста процентов.
    const ctx = this.context as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    this.webAudioOutput = typeof ctx.setSinkId === "function";

    if (this.webAudioOutput) {
      this.master = this.context.createGain();
      this.master.gain.value = this.deafened ? 0 : getPreferences().outputGain;
      // Между общей громкостью и динамиками — ограничитель. Он нужен
      // именно теперь, когда громкость поднимается выше ста процентов:
      // сумма нескольких говорящих разом легко уходит за потолок,
      // и без ограничителя это слышно как треск в наушниках.
      /*
       * Последний узел перед динамиками запоминаем, и это важно
       * для гасителя эха: опорным сигналом должно быть ровно то,
       * что услышали динамики. Между общей громкостью и выходом
       * стоит ограничитель, а он меняет звук неравномерно — тише
       * на громком, никак на тихом. Вычитать сигнал до него значит
       * вычитать не то, что вернулось в захват.
       */
      const вДинамики = makeLimiter(this.context);
      this.master.connect(вДинамики).connect(this.context.destination);
      this.вДинамики = вДинамики;
      await this.routeContextToSpeaker();
    }

    this.watchLevel(this.meId, this.stream);
    this.qualityTimer = setInterval(() => void this.measure(), 2000);
  }

  /**
   * Подготовить свой шумодав.
   *
   * Отдельным файлом, потому что он выполняется не здесь, а в звуковом
   * потоке — там нет ни страницы, ни наших модулей. Не загрузился
   * (старый браузер, файл не отдался) — молча остаёмся без него:
   * разговор без шумодава лучше, чем отсутствие разговора.
   */
  private async loadDenoise(): Promise<void> {
    if (!this.context || getPreferences().denoise === "off") return;
    try {
      await this.context.audioWorklet.addModule("/denoise-worklet.js");
      this.denoiseReady = true;
    } catch {
      this.denoiseReady = false;
    }
  }

  /** Микрофон → шумодав → усилитель → поток для собеседников.
   *  null, если собрать не удалось: тогда шлём дорожку напрямую. */
  private buildMicChain(): MediaStream | null {
    if (!this.context || !this.mic) return null;
    try {
      const source = this.context.createMediaStreamSource(this.mic);
      const gain = this.context.createGain();
      gain.gain.value = getPreferences().micGain;
      const destination = this.context.createMediaStreamDestination();

      // Шумодав между микрофоном и усилителем: чистим то, что пришло,
      // и только потом делаем громче. В обратном порядке усилитель
      // поднимал бы вместе с голосом и шум.
      //
      // Усилитель голоса живёт внутри самого шумодава, а не отдельным
      // узлом: тянуть надо речь и только речь, а отличить её от паузы
      // умеет ровно он — дно шума он и так считает. Пробовали сжатием
      // (DynamicsCompressor): оно подняло голос на 22 дБ и ровно на
      // столько же — фон в паузах. Это не усилитель голоса, это
      // громкость.
      //
      // В конце ограничитель. Он не делает громче, он не даёт хрипеть:
      // без него поднятый голос на громких слогах упирается в потолок
      // и превращается в треск, а слышно его при этом не лучше.
      const denoise = this.makeDenoise();
      const limiter = makeLimiter(this.context);

      let chain: AudioNode = source;
      if (denoise) chain = chain.connect(denoise);
      chain.connect(gain).connect(limiter).connect(destination);

      this.micGain = gain;
      this.micSource = source;
      return destination.stream;
    } catch {
      this.micGain = null;
      this.micSource = null;
      this.denoise = null;
      return null;
    }
  }

  /** Включить или выключить усилитель голоса, не разрывая разговор.
   *  Он внутри шумодава, поэтому это просто сообщение туда: узел
   *  остаётся на месте, меняется только его поведение. */
  syncAutoGain(): void {
    this.denoise?.port.postMessage({
      strength: getPreferences().denoise,
      amplify: getPreferences().autoGain,
    });
  }

  /**
   * Привести шумодав в соответствие с настройкой, не разрывая разговор.
   *
   * Меняют её именно посреди разговора: пока не слышно, что мешает,
   * никто в настройки не пойдёт. Поэтому включение и выключение должны
   * работать на живой цепочке, а не «со следующего раза».
   */
  private async syncDenoise(): Promise<void> {
    if (!this.context || !this.micGain) return;

    if (getPreferences().denoise === "off") {
      this.denoise?.disconnect();
      this.denoise = null;
      return;
    }

    if (this.denoise) {
      this.applyDenoise();
      return;
    }

    if (!this.denoiseReady) await this.loadDenoise();
    this.makeDenoise()?.connect(this.micGain);
  }

  /** Узел шумодава — или null, если он не нужен или не загрузился. */
  private makeDenoise(): AudioWorkletNode | null {
    const strength = getPreferences().denoise;
    if (!this.context || !this.denoiseReady || strength === "off") return null;
    try {
      const node = new AudioWorkletNode(this.context, "denoise", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        // amplify — усилитель голоса: тянуть ли тихую речь к обычной
        // громкости. Живёт внутри шумодава, потому что тянуть надо
        // именно речь, а речь от паузы отличает он.
        processorOptions: { strength, amplify: getPreferences().autoGain },
      });
      this.denoise = node;
      return node;
    } catch {
      this.denoise = null;
      return null;
    }
  }

  /** Перезапросить микрофон, не выходя из разговора.
   *
   *  Так меняется и само устройство, и обработка: эхоподавление
   *  с шумодавом задаются в момент запроса и на живой дорожке уже
   *  не переключаются — браузер собирает цепочку один раз.
   *
   *  Собеседникам при этом не приходит вообще ничего: они получают
   *  дорожку с выхода усилителя, а она не меняется — меняется только
   *  то, что в усилитель входит. Переподключаться и пересогласовывать
   *  соединение не нужно, значит и провала в звуке нет.
   *
   *  Где усилителя нет (запасной путь) — подменяем саму дорожку через
   *  replaceTrack: это тоже без пересогласования, но уже средствами
   *  WebRTC. */
  async setMicrophone(): Promise<void> {
    if (!this.stream) return;

    const fresh = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });

    // Молчали до смены — молчим и после. Иначе выбор устройства
    // неожиданно включал бы микрофон посреди разговора.
    const muted = this.mic?.getAudioTracks().every((track) => !track.enabled) ?? false;
    for (const track of fresh.getAudioTracks()) track.enabled = !muted;

    const old = this.mic;
    this.mic = fresh;

    if (this.micGain && this.context) {
      this.micSource?.disconnect();
      this.micSource = this.context.createMediaStreamSource(fresh);
      // Шумодав могли включить или выключить прямо сейчас — этой же
      // кнопкой. Приводим цепочку в соответствие до того, как подключим
      // к ней новый микрофон.
      await this.syncDenoise();
      if (this.denoise) this.micSource.connect(this.denoise);
      else this.micSource.connect(this.micGain);
    } else {
      // Без усилителя дорожку надо подменить у каждого собеседника.
      const track = fresh.getAudioTracks()[0] ?? null;
      for (const peer of this.peers.values()) {
        for (const sender of peer.connection.getSenders()) {
          if (sender.track?.kind === "audio") await sender.replaceTrack(track);
        }
      }
      this.stream = fresh;
      this.watchLevel(this.meId, fresh);
    }

    // Старое устройство отпускаем последним: до этого момента оно
    // ещё может понадобиться, если новое не откроется.
    for (const track of old?.getTracks() ?? []) track.stop();
  }

  /** Есть ли чем регулировать свой микрофон. Где цепочка не собралась,
   *  ползунок показывать нечестно. */
  get micGainAvailable(): boolean {
    return this.micGain !== null;
  }

  applyMicGain(): void {
    if (this.micGain) this.micGain.gain.value = getPreferences().micGain;
  }

  /**
   * Сменить силу шумодава посреди разговора.
   *
   * Мягче или сильнее — простым сообщением внутрь: пересобирать
   * цепочку ради одного числа значит на мгновение оборвать себе
   * микрофон. А вот включение и выключение целиком меняет саму
   * цепочку — это делает setMicrophone, который перезапрашивает
   * устройство и собирает всё заново.
   */
  applyDenoise(): void {
    const strength = getPreferences().denoise;
    if (this.denoise && strength !== "off") {
      this.denoise.port.postMessage({ strength });
    }
  }

  /** Стоит ли шумодав в цепочке прямо сейчас. Настройка может быть
   *  включена, а узел не собраться — обещать в интерфейсе то, чего нет,
   *  нельзя. */
  get denoiseActive(): boolean {
    return this.denoise !== null;
  }

  private async routeContextToSpeaker(): Promise<void> {
    const id = selectedSpeaker();
    const ctx = this.context as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!ctx?.setSinkId) return;
    try {
      await ctx.setSinkId(id || "");
    } catch {
      // Устройство исчезло — остаёмся на системном.
    }
  }

  /* ── Громкость ──────────────────────────────────────────────── */

  /** Итоговая громкость собеседника: заглушённый молчит, остальное —
   *  как выставил человек. */
  private gainFor(userId: string): number {
    const prefs = getPreferences();
    if (prefs.mutedUsers.includes(userId)) return 0;
    return prefs.userGain[userId] ?? 1;
  }

  /**
   * Громкость чужого показа — своя, отдельно от голоса.
   *
   * Голос и игра приходят от одного человека, но слушают их
   * по-разному: голос надо слышать всегда, а игру — ровно настолько,
   * чтобы понимать, что происходит на экране. Раньше ползунок был
   * один на оба, и когда у показывающего ревела игра, выбор был
   * скверный: терпеть или заглушить человека вместе с ним.
   *
   * Заглушённый молчит целиком: «заглушить» должно означать тишину,
   * а не тишину наполовину.
   */
  private screenGainFor(userId: string): number {
    const prefs = getPreferences();
    if (prefs.mutedUsers.includes(userId)) return 0;
    return prefs.screenGain[userId] ?? 1;
  }

  /** Применить настройки громкости ко всему, что сейчас звучит.
   *  Вызывается на каждое движение любого ползунка. */
  applyVolumes(): void {
    const prefs = getPreferences();
    if (this.master) this.master.gain.value = this.deafened ? 0 : prefs.outputGain;

    for (const [userId, peer] of this.peers) {
      const personal = this.gainFor(userId);
      if (peer.volume) {
        peer.volume.gain.gain.value = personal;
      } else {
        // Запасной путь: у элемента громкость только до единицы,
        // поэтому усиление сверх ста процентов здесь недоступно.
        peer.audio.volume = Math.min(1, personal * prefs.outputGain);
        peer.audio.muted = this.deafened;
      }
      // У показа свой ползунок: игра ревёт, а голос из-за неё не слышно —
      // это две разные беды, и лечатся они порознь. Кнопка «заглушить»
      // по-прежнему гасит человека целиком, вместе с его игрой.
      peer.screen?.apply(this.screenGainFor(userId), prefs.outputGain, this.deafened);
    }
  }

  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    this.applyVolumes();
  }

  /** Смена наушников на ходу — без выхода из разговора. */
  async setSpeaker(): Promise<void> {
    if (this.webAudioOutput) return this.routeContextToSpeaker();
    for (const peer of this.peers.values()) {
      await routeToSpeaker(peer.audio);
      await peer.screen?.reroute();
    }
  }

  /** Задержка до собеседников.
   *
   *  Берём не «время до сервера» — сервер в разговоре не участвует
   *  вообще, звук идёт напрямую, и его пинг ничего не говорит о том,
   *  как слышно. Берём то, что WebRTC уже измерил сам на выбранной
   *  паре адресов: это честное время туда-обратно до собеседника.
   *
   *  Из нескольких соединений показываем худшее: если из четверых
   *  один слышен с задержкой, разговор испорчен у всех, и зелёный
   *  значок в этот момент врёт. */
  private async measure(): Promise<void> {
    const rtts: number[] = [];
    /** Хоть одна дорога легла через ретранслятор. Показываем это
     *  человеку: «через сервер» — обещание, и оно должно быть
     *  проверяемым, а не написанным в настройках. */
    let черезРетранслятор = false;

    for (const peer of this.peers.values()) {
      // Оборвавшиеся не считаем: у них остаётся последнее удачное
      // значение, и по нему связь выглядит прекрасной ровно тогда,
      // когда её нет.
      const state = peer.connection.connectionState;
      if (state !== "connected") continue;

      const stats = await peer.connection.getStats();
      let selected: RTCStats | undefined;
      for (const report of stats.values()) {
        // nominated + succeeded — та самая пара адресов, по которой
        // реально идёт звук; остальные кандидаты давно отброшены.
        if (report.type === "candidate-pair" && report.nominated && report.state === "succeeded") {
          selected = report;
        }
      }

      const pair = selected as
        | { currentRoundTripTime?: number; localCandidateId?: string }
        | undefined;

      const rtt = pair?.currentRoundTripTime;
      if (typeof rtt === "number") rtts.push(rtt * 1000);

      // Тип берём у своего кандидата выбранной пары: relay означает,
      // что наружу мы вышли через ретранслятор.
      if (pair?.localCandidateId) {
        const local = stats.get(pair.localCandidateId) as { candidateType?: string } | undefined;
        if (local?.candidateType === "relay") черезРетранслятор = true;
      }
    }

    await this.checkScreen();

    if (rtts.length > 0) {
      this.events.onQuality(Math.max(...rtts), false, черезРетранслятор);
      return;
    }

    // Собеседников нет — мерить дорогу до них не по чему. Показываем
    // время до нашего сервера: это не задержка разговора, но это
    // честный признак того, что связь жива, и человеку понятнее,
    // чем пустое место.
    // Одни в канале: соединений нет, и говорить «через ретранслятор»
    // не о чем — ретранслировать пока нечего.
    this.events.onQuality(await this.serverRtt(), true, false);
  }

  /**
   * Справляется ли наш компьютер с демонстрацией.
   *
   * Спрашиваем не у себя, а у кодировщика: он сам сообщает, что
   * режет картинку и почему. Это единственный честный признак —
   * по загрузке процессора судить нельзя, там своя жизнь.
   *
   * Берём худшее из соединений: если хоть одному собеседнику
   * достаётся урезанная картинка, показывать «всё хорошо» нечестно.
   */
  private async checkScreen(): Promise<void> {
    if (!this.shares.screen.stream) {
      this.events.onScreenStats(null);
      // Показ кончился — и наши ступени вместе с ним. Иначе полоса
      // «опустил показ до 720p» висела бы над пустым местом.
      if (this.screenAdapt.шаг !== 0 || this.screenNow !== null) {
        this.screenAdapt = НАЧАЛО;
        this.screenNow = null;
        this.events.onScreenScaled(null);
      }
      this.прежняяОтдача = null;
      return;
    }

    const как = this.черезРаздачу.has("screen")
      ? await this.черезРаздачуИдёт()
      : await this.напрямуюИдёт();

    this.events.onScreenStats(как);
    await this.adaptScreen(как?.fps ?? null, как?.предел ?? null);
  }

  /**
   * Насколько гаситель убирает из показа наш собственный звук.
   *
   * null означает «гасителя нет»: либо в захвате не было звука вовсе,
   * либо собрать его не удалось. Это не мелочь — без него собеседник
   * слышит в нашем показе сам себя, и знать об этом должны мы, а не он.
   */
  /** Есть ли в нашем показе звук. Показывают окно — звука нет,
     *  и гасителю в этом случае просто нечего делать. */
  private звукОтдаём(): boolean {
    return (this.shares.screen.stream?.getAudioTracks().length ?? 0) > 0;
  }

  private эхоГасится(): number | null {
    const отчёт = this.shares.screen.guard?.report();
    if (!отчёт) return null;
    return Math.round(отчёт.gain);
  }

  /** Прошлый замер отдачи — по нему считаем скорость: сама по себе
   *  она в статистике не лежит. */
  private прежняяОтдача: { байт: number; когда: number } | null = null;

  /** Скорость по разнице с прошлым замером. */
  private скорость(байт: number | null, когда: number): number | null {
    if (байт === null) return null;
    const прежде = this.прежняяОтдача;
    this.прежняяОтдача = { байт, когда };
    if (!прежде || когда <= прежде.когда) return null;
    const секунд = (когда - прежде.когда) / 1000;
    return ((байт - прежде.байт) * 8) / секунд / 1e6;
  }

  /**
   * Через раздачу поток один — у него и спрашиваем.
   *
   * Раньше приходилось брать худшее из соединений: их было столько же,
   * сколько собеседников. Теперь соединение одно, и «худший из»
   * превратилось в «единственный».
   */
  private async черезРаздачуИдёт(): Promise<ПоказИдёт | null> {
    const как = await this.sfu?.какИдёт("screen");
    if (!как) return null;

    return {
      width: как.width,
      height: как.height,
      fps: как.fps === null ? null : Math.round(как.fps),
      мбит: this.скорость(как.байт, как.когда),
      предел: как.предел,
      черезСервер: true,
      зрителей: this.peers.size,
      эхо: this.эхоГасится(),
      соЗвуком: this.звукОтдаём(),
    };
  }

  /** Прежний путь: у каждого собеседника своя картинка, и берём
   *  худшее — если хоть одному достаётся урезанная, показывать
   *  «всё хорошо» нечестно. */
  private async напрямуюИдёт(): Promise<ПоказИдёт | null> {
    let reason: "cpu" | "bandwidth" | null = null;
    let fps: number | null = null;
    let лучший: number | null = null;
    let width: number | null = null;
    let height: number | null = null;
    let байт = 0;
    let было = false;

    for (const peer of this.peers.values()) {
      if (peer.connection.connectionState !== "connected") continue;

      for (const report of (await peer.connection.getStats()).values()) {
        if (report.type !== "outbound-rtp") continue;
        const outbound = report as RTCOutboundRtpStreamStats & {
          qualityLimitationReason?: string;
          framesPerSecond?: number;
          frameWidth?: number;
          frameHeight?: number;
        };
        if (outbound.kind !== "video") continue;
        было = true;

        if (typeof outbound.framesPerSecond === "number") {
          fps = fps === null ? outbound.framesPerSecond : Math.min(fps, outbound.framesPerSecond);
          лучший =
            лучший === null ? outbound.framesPerSecond : Math.max(лучший, outbound.framesPerSecond);
        }
        if (typeof outbound.frameWidth === "number") width = outbound.frameWidth;
        if (typeof outbound.frameHeight === "number") height = outbound.frameHeight;
        байт += outbound.bytesSent ?? 0;

        const why = outbound.qualityLimitationReason;
        if (why === "cpu" || why === "bandwidth") reason = why;
      }
    }

    if (!было) return null;

    /*
     * Опускаться решаем по лучшему из собеседников, а не по худшему.
     *
     * Картинку кодируем каждому свою, а захват один на всех: опустив
     * его, мы опустим показ сразу всем. Если тяжело одному — это его
     * канал, и браузер урежет ему картинку сам, не трогая остальных.
     */
    return {
      width,
      height,
      fps: лучший === null ? null : Math.round(лучший),
      мбит: this.скорость(байт, performance.now()),
      предел: reason,
      черезСервер: false,
      эхо: this.эхоГасится(),
      соЗвуком: this.звукОтдаём(),
      зрителей: this.peers.size,
    };
  }

  /**
   * Держать кадры, жертвуя размером.
   *
   * Кодировщик, когда ему тесно, режет и размер, и кадры сразу — и
   * получается худшее из двух: мыло, которое ещё и дёргается. Здесь
   * мы отбираем у него этот выбор: отдаём картинку поменьше, чтобы
   * на кадры хватило.
   *
   * Размер меняем у самого захвата: передоговариваться с собеседниками
   * для этого не надо, картинка просто становится меньше на лету.
   *
   * Возвращаемся наверх медленно и только когда всё спокойно — иначе
   * показ прыгал бы туда-сюда на каждой просадке.
   */
  private async adaptScreen(
    fps: number | null,
    предел: "cpu" | "bandwidth" | null,
  ): Promise<void> {
    const track = this.shares.screen.stream?.getVideoTracks()[0];
    if (!track || track.readyState !== "live") return;

    const было = this.screenAdapt;
    this.screenAdapt = решить(было, { fps, предел }, getPreferences().screenFps);
    if (this.screenAdapt.шаг !== было.шаг) await this.applyScreenStep(track);
  }

  /** Отдать захвату новый потолок по высоте и пересчитать полосу. */
  private async applyScreenStep(track: MediaStreamTrack): Promise<void> {
    const { screenFps, screenHeight } = getPreferences();
    // «Как есть» — считаем от того, что отдаёт сам экран.
    const база = screenHeight > 0 ? screenHeight : (track.getSettings().height ?? 1080);
    const высота = высотаСтупени(база, this.screenAdapt.шаг);

    try {
      await track.applyConstraints({
        height: { max: высота },
        frameRate: { ideal: screenFps, max: screenFps },
      });
    } catch {
      // Захват не дал уменьшить — не считаем сделанным то, чего
      // не вышло.
      this.screenAdapt = { ...this.screenAdapt, шаг: Math.max(0, this.screenAdapt.шаг - 1) };
      return;
    }

    this.screenNow = высота;
    // Полосу пересчитываем под новый размер: считать её по выбранной
    // в настройках высоте — значит обещать кодировщику мегабиты
    // на картинку, которой уже нет.
    await this.relimitScreen();
    this.events.onScreenScaled(this.screenAdapt.шаг === 0 ? null : высота);
  }

  /** Пересчитать потолок битрейта у всех, кому идёт показ. */
  private async relimitScreen(): Promise<void> {
    if (this.черезРаздачу.has("screen")) {
      await this.sfu?.потолок("screen", screenBitrate(1, this.screenNow));
      return;
    }

    for (const senders of this.shares.screen.senders.values()) {
      for (const sender of senders) {
        if (sender.track?.kind === "video") await this.limitVideo(sender, "screen");
      }
    }
  }

  private serverRtt(): Promise<number | null> {
    const socket = getSocket();
    if (!socket?.connected) return Promise.resolve(null);

    return new Promise((resolve) => {
      const started = performance.now();
      let answered = false;
      // Молчащий сервер не должен подвешивать замер навсегда.
      const timer = setTimeout(() => {
        if (!answered) resolve(null);
      }, 3000);

      socket.emit("net:ping", () => {
        answered = true;
        clearTimeout(timer);
        resolve(performance.now() - started);
      });
    });
  }

  /**
   * Разговор идёт через наш ретранслятор, а не напрямую.
   *
   * "relay" запрещает прямые адреса вовсе. Собеседники перестают
   * видеть адреса друг друга: при прямом соединении каждый в разговоре
   * узнаёт IP каждого — иначе связаться напрямую нельзя в принципе.
   *
   * Крюк почти ничего не стоит: замерено 24–30 мс через ретранслятор
   * против примерно того же напрямую. Настройкой это было ровно один
   * раз и убрано — выбирать не из чего, когда один ответ разумный,
   * а второй просто хуже.
   *
   * Чего это не делает — не снимает нагрузку с того, кто показывает
   * экран. Картинку по-прежнему снимает и сжимает его компьютер,
   * и отправляет столько же раз, сколько собеседников; ретранслятор
   * пересылает готовое, а не размножает.
   *
   * Проверка на наличие ретранслятора в списке обязательна. Без неё
   * запрет прямых путей означал бы, что соединяться не через что:
   * сервер не отдал ретранслятор (не настроен, не отвечает, пароль
   * протух) — и разговор не состоялся бы молча. Лучше связаться
   * напрямую, чем не связаться никак.
   */
  private transportPolicy(): RTCIceTransportPolicy {
    const есть = this.ice.some((server) =>
      [server.urls].flat().some((url) => url.startsWith("turn:") || url.startsWith("turns:")),
    );
    return есть ? "relay" : "all";
  }

  private peer(userId: string): Peer {
    const existing = this.peers.get(userId);
    if (existing) return existing;

    const connection = new RTCPeerConnection({
      iceServers: this.ice,
      iceTransportPolicy: this.transportPolicy(),
    });
    const audio = new Audio();
    audio.autoplay = true;
    void routeToSpeaker(audio);

    const peer: Peer = {
      connection,
      audio,
      volume: null,
      screen: null,
      micStreamId: null,
      polite: this.meId < userId,
      makingOffer: false,
      restarts: 0,
    };
    this.peers.set(userId, peer);

    for (const track of this.stream?.getTracks() ?? []) {
      connection.addTrack(track, this.stream!);
    }
    // Показ уже идёт, а человек только вошёл — картинка ему тоже нужна,
    // иначе он будет ждать, пока показывающий выключит и включит.
    // Только объявленное: иначе кадры обгонят объявление.
    for (const kind of KINDS) {
      const share = this.shares[kind];
      // Через раздачу опоздавший подпишется сам — сервер позовёт.
      if (share.stream && share.published && !this.черезРаздачу.has(kind)) {
        this.sendShareTo(userId, peer, kind);
      }
    }

    connection.ontrack = (event) => {
      const [remote] = event.streams;
      if (!remote) return;
      const seen = this.incoming.get(userId) ?? new Map<string, MediaStream>();
      seen.set(remote.id, remote);
      this.incoming.set(userId, seen);
      this.sortIncoming(userId);
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
      const state = connection.connectionState;
      this.events.onPeerState(userId, state);

      // Получилось — забываем прошлые неудачи: следующий обрыв будет
      // уже другой историей и заслуживает своих трёх попыток.
      if (state === "connected") {
        peer.restarts = 0;
        return;
      }

      if (state !== "failed") return;

      // Разорванное соединение пробуем поднять заново: сеть моргает,
      // и без этого разговор пришлось бы начинать сначала. Но не
      // бесконечно — см. MAX_ICE_RESTARTS.
      if (peer.restarts >= MAX_ICE_RESTARTS) {
        console.error(
          `Не удалось соединиться с ${userId}: прямого пути нет, ` +
            `а ретранслятор недоступен. Перестаю пробовать.`,
        );
        return;
      }

      peer.restarts += 1;
      connection.restartIce();
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

  /** Разложить пришедшие от собеседника потоки: что микрофон, а что
   *  экран. Решает не наличие видеодорожки, а совпадение с тем, что
   *  человек объявил: дорожки одного потока приходят порознь, и поток
   *  успевает побывать «без видео» ровно перед тем, как стать экраном.
   *
   *  Вызывается и на новую дорожку, и на новое объявление — потому
   *  что порядок этих двух событий не гарантирован ничем. */
  private sortIncoming(userId: string): void {
    const seen = this.incoming.get(userId);
    if (!seen) return;

    const peer = this.peers.get(userId);
    const said = this.announced.get(userId);
    let screen: MediaStream | null = null;
    let video: MediaStream | null = null;

    for (const [id, stream] of seen) {
      if (said && id === said.screen) {
        screen = stream;
        // Объявление разъяснило то, что мы приняли за микрофон.
        // Выбор снимаем, иначе настоящий голос так и остался бы
        // отвергнутым как «не тот поток».
        if (peer?.micStreamId === id) peer.micStreamId = null;
        continue;
      }
      if (said && id === said.video) {
        video = stream;
        if (peer?.micStreamId === id) peer.micStreamId = null;
        continue;
      }
      // Микрофон. Видео здесь взяться не может, а если вдруг взялось —
      // значит объявление ещё не дошло, и трогать поток рано.
      if (stream.getVideoTracks().length > 0) continue;
      // Голос уже опознан — второй звуковой поток без объявления это
      // не он, а обогнавший объявление показ.
      if (peer?.micStreamId && peer.micStreamId !== id) continue;
      if (peer && peer.audio.srcObject !== stream) {
        peer.micStreamId = id;
        peer.audio.srcObject = stream;
        // Элемент нужен даже на пути через WebAudio: без привязки
        // к нему браузер не начинает отдавать данные удалённого
        // потока, и усилитель получает тишину. Поэтому элемент
        // остаётся, но замолкает — звук идёт через усилитель.
        peer.audio.muted = this.webAudioOutput;
        void peer.audio.play().catch(() => undefined);
        this.attachVolume(userId, peer, stream);
        this.watchLevel(userId, stream);
      }
    }

    this.напрямую.set(userId, { screen, video });
    this.показать(userId);
  }

  /**
   * Отдать наверх то, что сейчас видно от человека.
   *
   * Дорог у картинки две: через раздачу и напрямую. Первая лучше —
   * ради неё всё и делалось, — но она может не завестись, и тогда
   * работает вторая. Решать, что показывать, должно одно место,
   * иначе два пути начнут спорить и картинка замигает.
   */
  private показать(userId: string): void {
    const через = this.раздачей.get(userId);
    const мимо = this.напрямую.get(userId);

    const есть = (поток: MediaStream | undefined) =>
      поток && поток.getTracks().length > 0 ? поток : null;

    const screen = есть(через?.screen) ?? мимо?.screen ?? null;
    const video = есть(через?.video) ?? мимо?.video ?? null;

    // Звук показа ведём сами, а не элементом в разметке: он не должен
    // ни зависеть от того, какой канал сейчас открыт, ни звучать мимо
    // общей громкости и гасителя эха.
    const peer = this.peers.get(userId);
    if (peer) this.pipeScreen(userId, peer, screen);

    // Есть ли в показе звук — вопрос отдельный от того, есть ли
    // показ: дорожка приезжает позже картинки, а разметке надо знать,
    // рисовать ли ползунок громкости. Своему потоку браузер о новых
    // дорожках не сообщает, поэтому говорим сами.
    const звук = Boolean(screen && screen.getAudioTracks().length > 0);

    const before = this.shown.get(userId);
    if (before?.screen !== screen) this.events.onScreen(userId, screen);
    if (before?.video !== video) this.events.onVideo(userId, video);
    if (before?.звук !== звук) this.events.onScreenSound(userId, звук);
    this.shown.set(userId, { screen, video, звук });
  }

  /* ── Раздача ──────────────────────────────────────────────────
   *
   * Сервер зовёт подписаться на чужой поток, мы подписываемся и
   * складываем приехавшие дорожки по людям. Дальше — тот же путь,
   * что и у пришедшего напрямую. */

  /** Приехала чужая дорожка. */
  private принял(userId: string, что: Что, track: MediaStreamTrack): void {
    const было = this.раздачей.get(userId) ?? {
      screen: new MediaStream(),
      video: new MediaStream(),
    };
    this.раздачей.set(userId, было);

    // Звук показа кладём в тот же поток, что и картинку: дальше он
    // уходит в pipeScreen, а тому нужен один поток на показ.
    const куда = что === "video" ? было.video : было.screen;
    for (const прежняя of куда.getTracks()) {
      if (прежняя.kind === track.kind) куда.removeTrack(прежняя);
    }
    куда.addTrack(track);
    this.показать(userId);
  }

  /** Чужой поток кончился. */
  private убрал(userId: string, что: Что): void {
    const было = this.раздачей.get(userId);
    if (!было) return;

    if (что === "video") {
      for (const track of было.video.getTracks()) было.video.removeTrack(track);
    } else if (что === "screenAudio") {
      for (const track of было.screen.getAudioTracks()) было.screen.removeTrack(track);
    } else {
      for (const track of было.screen.getTracks()) было.screen.removeTrack(track);
    }

    this.показать(userId);
  }

  /** Завести раздачу и подписаться на то, что уже идёт. */
  private async поднятьРаздачу(): Promise<void> {
    const socket = getSocket();
    if (!socket) return;

    this.sfu = new Раздача(
      ({ userId, что, track }) => this.принял(userId, что, track),
      (userId, что) => this.убрал(userId, что),
    );

    socket.on("sfu:producer", this.наПоток);
    socket.on("sfu:producer-gone", this.наКонец);
  }

  /**
   * Подхватить показы, которые идут в канале с нашего прихода.
   *
   * Отдельным шагом, и это важно. Разговор заводится раньше, чем
   * сервер узнаёт, что мы в канале: сначала поднимается своя половина,
   * и только потом уходит «я вошёл». Спросив «что сейчас идёт»
   * до этого, мы получаем честное «ничего» — и человек, вошедший
   * к уже показывающему другу, видит пустоту до тех пор, пока тот
   * не выключит показ и не включит заново.
   *
   * Поэтому спрашиваем после того, как сервер подтвердил вход.
   */
  async подхватить(): Promise<void> {
    if (!this.sfu) return;
    if (await this.sfu.готова()) await this.sfu.догнать();
  }

  private наПоток = ({ producerId }: { producerId: string }) => {
    void this.sfu?.принять(producerId);
  };

  private наКонец = ({ producerId, userId }: { producerId: string; userId: string }) => {
    this.sfu?.убрать(producerId, userId);
  };

  /** Что от кого сейчас отдано наверх — чтобы не дёргать интерфейс
   *  одним и тем же потоком по нескольку раз. */
  private shown = new Map<
    string,
    { screen: MediaStream | null; video: MediaStream | null; звук: boolean }
  >();

  /** Завести собеседнику личный усилитель. */
  private attachVolume(userId: string, peer: Peer, stream: MediaStream): void {
    if (!this.context || !this.master || !this.webAudioOutput) {
      // Запасной путь — громкость прямо на элементе.
      this.applyVolumes();
      return;
    }

    peer.volume?.source.disconnect();
    const source = this.context.createMediaStreamSource(stream);
    const gain = this.context.createGain();
    gain.gain.value = this.gainFor(userId);
    source.connect(gain).connect(this.master);
    peer.volume = { gain, source };
  }

  /**
   * Пустить звук чужого показа через общий усилитель.
   *
   * Тем же путём, что и голос, и по той же причине: всё, что мы
   * слышим, должно быть в опорном сигнале гасителя эха. Иначе чужая
   * игра выходит в динамики, возвращается в наш захват экрана и
   * уезжает обратно тому, кто её показывает, — он слышит себя же
   * с задержкой в полсекунды.
   *
   * Заодно звук показа наконец подчиняется общей громкости, кнопке
   * «отключить звук» и выбору наушников — раньше он шёл мимо всего
   * этого.
   */
  private pipeScreen(userId: string, peer: Peer, stream: MediaStream | null): void {
    // Не смотрим — не звучит. Показ идёт, дорожка приезжает, а в
    // наушники не попадает ничего, пока человек не нажмёт «Смотреть».
    if (!stream || this.смотрим !== userId) {
      peer.screen?.stop();
      peer.screen = null;
      return;
    }

    /*
     * Тот же поток — но, возможно, уже со звуком.
     *
     * Звуковая дорожка показа приезжает отдельно от картинки и почти
     * всегда позже: показывающий отдаёт сперва экран, потом звук.
     * Поток при этом остаётся тем же самым — в него просто добавилась
     * дорожка, — и уйти отсюда молча значит оставить звук навсегда
     * ни к чему не подключённым. Ровно на это и жаловались: картинка
     * идёт, а звука нет.
     */
    if (peer.screen?.stream === stream) {
      peer.screen.проверить();
      return;
    }

    peer.screen?.stop();
    peer.screen = завестиЗвукПоказа(stream, {
      context: this.context,
      master: this.master,
      черезУсилитель: this.webAudioOutput,
      громкость: () => this.screenGainFor(userId),
      вНаушники: routeToSpeaker,
    });

    this.applyVolumes();
  }

  /**
   * Начали или перестали смотреть чужой показ.
   *
   * Зовётся из интерфейса, кнопкой «Смотреть» и её обратной стороной.
   * Здесь только звук: картинку показывает разметка, и ей это
   * согласие известно и без нас.
   */
  смотреть(userId: string | null): void {
    if (this.смотрим === userId) return;
    this.смотрим = userId;
    // Пересобираем у всех: у прежнего звук надо снять, у нового —
    // завести, и оба случая делаются одним и тем же путём.
    for (const кто of this.peers.keys()) this.показать(кто);
  }

  /** Собеседник начал или прекратил что-то показывать.
   *
   *  Меняем только названный вид: экран и камера включаются
   *  и выключаются независимо, и объявление про один не должно
   *  стирать то, что мы знаем про другой. */
  announce(userId: string, kind: ShareKind, streamId: string | null): void {
    const said = this.announced.get(userId) ?? { screen: null, video: null };
    this.announced.set(userId, { ...said, [kind]: streamId });
    this.sortIncoming(userId);
  }

  /** Есть ли уже живое соединение с этим человеком.
   *
   *  Нужно после обрыва связи с сервером: заявляться в канал заново
   *  приходится, а вот пересоздавать соединения — нет. Они идут мимо
   *  сервера и его падение переживают, а лишнее предложение посреди
   *  разговора роняет звук на пару секунд. */
  isConnectedTo(userId: string): boolean {
    const state = this.peers.get(userId)?.connection.connectionState;
    return state === "connected" || state === "connecting" || state === "new";
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

    // Ответ на предложение, которого больше нет.
    //
    // Так бывает при том же столкновении: мы отправили предложение,
    // тут же пришло встречное, мы как вежливая сторона от своего
    // отказались — а ответ на него всё равно доехал, дорога-то уже
    // была в пути. Применить его нельзя: соединение с тех пор
    // договорилось о другом, и браузер отвечает на это ошибкой,
    // которая роняет всю цепочку. Поймано живьём при включении показа
    // экрана: показ не начинался вовсе, а кнопка молча оставалась
    // выключенной.
    if (signal.type === "answer" && pc.signalingState !== "have-local-offer") return;

    try {
      await pc.setRemoteDescription({ type: signal.type, sdp: signal.sdp });

      if (signal.type === "offer") {
        await pc.setLocalDescription();
        const sdp = pc.localDescription?.sdp;
        if (sdp) this.send(from, { type: "answer", sdp });
      }
    } catch (error) {
      // Дальше молчим, но не делаем вид, что ничего не было: следующее
      // предложение поправит состояние, а запись в консоли останется
      // единственным следом, если не поправит.
      console.warn(`Служебное сообщение от ${from} не подошло:`, error);
    }
  }

  disconnect(userId: string): void {
    const peer = this.peers.get(userId);
    if (!peer) return;
    peer.connection.close();
    peer.volume?.source.disconnect();
    peer.volume?.gain.disconnect();
    peer.screen?.stop();
    peer.audio.srcObject = null;
    this.peers.delete(userId);
    this.meters.get(userId)?.();
    this.meters.delete(userId);
    for (const kind of KINDS) this.shares[kind].senders.delete(userId);
    this.incoming.delete(userId);
    this.announced.delete(userId);
    // Убрать чужую картинку с глаз, если человек ушёл прямо во время
    // показа: иначе на его месте остаётся застывший кадр.
    const last = this.shown.get(userId);
    if (last?.screen) this.events.onScreen(userId, null);
    if (last?.video) this.events.onVideo(userId, null);
    if (last?.звук) this.events.onScreenSound(userId, false);
    this.shown.delete(userId);
  }

  /* ── Показ: экран и камера ──────────────────────────────────── */

  /** Идентификатор своего потока — его объявляют остальным через
   *  сервер, чтобы они узнали пришедшие дорожки. */
  streamIdOf(kind: ShareKind): string | null {
    return this.shares[kind].stream?.id ?? null;
  }

  /** Свой поток — чтобы показать его себе же. Не видеть, что именно
   *  ты показываешь, неудобно: не поймёшь, что свернул не то окно
   *  и что в кадре не то. */
  ownStream(kind: ShareKind): MediaStream | null {
    return this.shares[kind].stream;
  }

  isSharing(kind: ShareKind): boolean {
    return this.shares[kind].stream !== null;
  }

  /** Какой камерой снимаем: передней или задней. Хранится, чтобы
   *  кнопка переворота знала, куда переключать. На компьютере камера
   *  одна, и переворачивать нечего. */
  private facing: "user" | "environment" = "user";

  /** Спросить, что показывать. Возвращает идентификатор потока —
   *  или null, если человек закрыл окно выбора.
   *
   *  Дорожки собеседникам ещё не уходят: сначала идентификатор надо
   *  объявить через сервер. Сообщение и видео идут разными путями,
   *  и если кадры обгонят объявление, принимающей стороне будет
   *  некуда их деть. Отправка — отдельным шагом, publish.
   *
   *  Окно выбора рисует сам браузер, а в оболочке — Electron
   *  (см. main.cjs). Отказ выбирать — это не ошибка. */
  async startScreen(): Promise<string | null> {
    const share = this.shares.screen;
    if (share.stream) return share.stream.id;

    // Звук с экрана — по возможности. Где его нет, поток придёт без
    // звуковой дорожки, и это не повод отменять показ.
    //
    /*
     * Просим заодно не брать в захват наш собственный вывод: это из-за
     * него собеседник слышит сам себя. Замерено, что в оболочке просьба
     * принимается и не выполняется, поэтому ниже мы всё равно гасим
     * свой звук сами — но там, где она работает, гасителю просто нечего
     * будет делать.
     *
     * И отдельно — просьба ничего с этим звуком не делать. По умолчанию
     * браузер обходится с захватом системы как с микрофоном: включает
     * подавление эха, шумодав и автоусиление, сводит в один канал.
     * Замерено на этой машине: echoCancellation, noiseSuppression,
     * autoGainControl — все три включены, channelCount 1. Для голоса
     * это правильно, для игры — порча: шумодав ест ровный гул и хвосты,
     * автоусиление качает громкость вслед за выстрелами, а стерео
     * схлопывается в моно.
     *
     * Гасителю эха от этого, вопреки ожиданию, почти всё равно:
     * замерено (check:echo), что медленное автоусиление отнимает у него
     * пару децибел — фильтр за ним успевает. Так что выключаем ради
     * самого звука, а не ради гасителя.
     */
    const audio: ScreenAudioConstraints = {
      restrictOwnAudio: true,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
    };

    // Качество берём из настроек: игре нужна плавность, тексту —
    // чёткость, а через ретранслятор за каждый лишний мегабит платим
    // мы. Потолок по высоте, а не по ширине: у экранов бывает любое
    // соотношение сторон, а высота задаёт объём работы честнее.
    const { screenHeight, screenFps } = getPreferences();
    const video: MediaTrackConstraints = {
      frameRate: { ideal: screenFps, max: screenFps },
      ...(screenHeight > 0 ? { height: { max: screenHeight } } : {}),
    };

    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video, audio });
    } catch (беда) {
      /*
       * Отказ отказу рознь.
       *
       * Человек закрыл окно выбора — это решение, и спрашивать снова
       * значит открыть окно во второй раз подряд. А вот «не умею
       * столько условий сразу» — повод повторить попроще: остаться
       * без показа из-за просьбы про стерео было бы обидно.
       */
      const имя = (беда as { name?: string } | null)?.name ?? "";
      if (имя === "NotAllowedError" || имя === "AbortError") return null;
      try {
        display = await navigator.mediaDevices.getDisplayMedia({ video, audio: true });
      } catch {
        return null;
      }
    }

    /*
     * Подсказка кодировщику, что это за картинка.
     *
     * Без неё браузер считает показ экрана текстом и бережёт чёткость
     * ценой кадров — для игры это ровно наоборот. Тексту и таблицам
     * (пятнадцать кадров) оставляем чёткость, всему остальному —
     * плавность.
     */
    for (const track of display.getVideoTracks()) {
      track.contentHint = screenFps >= 30 ? "motion" : "text";
    }

    // Новый показ — новые обстоятельства: прошлые ступени вниз
    // к нему отношения не имеют.
    this.screenAdapt = НАЧАЛО;
    this.screenNow = null;
    this.events.onScreenScaled(null);

    this.adopt("screen", display);
    await this.guardScreen(display);
    return display.id;
  }

  /** Убрать из звука демонстрации то, что мы сами играем в динамики.
   *
   *  Захват берёт весь вывод системы, а там играют голоса собеседников —
   *  и каждый из них слышит в нашей демонстрации сам себя с задержкой.
   *  Подменяем дорожку на очищенную прямо внутри потока: имя потока
   *  при этом не меняется, а по нему собеседники и узнают экран. */
  private async guardScreen(display: MediaStream): Promise<void> {
    const raw = display.getAudioTracks()[0];
    // Звука в захвате нет (показывают окно, а не экран) либо весь наш
    // вывод идёт мимо усилителя — гасить не из чего и нечем.
    if (!raw || !this.context || !this.master) return;

    const guard = await guardScreenAudio(this.context, this.вДинамики ?? this.master, raw);
    if (!guard) return;

    display.removeTrack(raw);
    display.addTrack(guard.track);
    this.shares.screen.guard = guard;
    this.shares.screen.raw = raw;
  }

  /**
   * Включить камеру.
   *
   * Отдельно от экрана: с камерой сидят весь разговор, а экран
   * показывают минуту и выключают. Одно другому не мешает — можно
   * показывать таблицу, оставаясь в кадре.
   *
   * На телефоне это ещё и единственный способ что-то показать:
   * getDisplayMedia там нет ни в Chrome на Android, ни в Safari
   * на iPhone, и это запрет самих телефонов, а не наш.
   */
  async startVideo(facing = this.facing): Promise<string | null> {
    const share = this.shares.video;
    if (share.stream) return share.stream.id;

    const capture = await this.openCamera(facing);
    if (!capture) return null;

    this.facing = facing;
    this.adopt("video", capture);
    return capture.id;
  }

  /** Запросить камеру у браузера. Отказ — это не ошибка, а решение
   *  человека, и говорить о нём не надо. */
  private async openCamera(facing: "user" | "environment"): Promise<MediaStream | null> {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: {
          // ideal, а не exact: на компьютере камера одна, и требование
          // «передняя» там просто не выполнится — вместе со всем
          // запросом. ideal телефон выполнит, а компьютер пропустит.
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: VIDEO_FPS, max: VIDEO_FPS },
        },
        // Звук уже идёт с микрофона. Второй дорожкой он пришёл бы
        // собеседнику дважды, с расхождением по времени.
        audio: false,
      });
    } catch {
      return null;
    }
  }

  /** Взять поток под свой присмотр. */
  private adopt(kind: ShareKind, stream: MediaStream): void {
    this.shares[kind].stream = stream;
    // Кнопку «прекратить показ» рисует сам браузер, и нажимают её
    // чаще, чем нашу. Камеру так же отбирает другое приложение.
    // Без этого мы бы считали, что показ идёт, а собеседники
    // смотрели бы в застывший кадр.
    for (const track of stream.getVideoTracks()) {
      track.addEventListener("ended", () => void this.stopShare(kind));
    }
  }

  /** Отдать поток собеседникам. Вызывается после того, как его имя
   *  объявлено остальным. */
  publish(kind: ShareKind): void {
    const share = this.shares[kind];
    if (!share.stream || share.published) return;
    share.published = true;
    void this.отдатьПоказ(kind);
  }

  /**
   * Куда отправить свой показ: через раздачу или каждому отдельно.
   *
   * Сначала пробуем раздачу — ради неё всё и затевалось: картинка
   * кодируется и уходит один раз вместо трёх. Не вышло — отправляем
   * по-старому, каждому собеседнику свой поток. Человек разницы
   * не замечает, кроме той, ради которой это делалось.
   */
  private async отдатьПоказ(kind: ShareKind): Promise<void> {
    const share = this.shares[kind];
    if (!share.stream) return;

    const video = share.stream.getVideoTracks()[0];
    if (video && this.sfu && (await this.sfu.готова())) {
      const что: Что = kind === "screen" ? "screen" : "video";
      // Через раздачу отдаём один раз, поэтому и делить полосу
      // между собеседниками больше не нужно.
      const потолок = kind === "screen" ? screenBitrate(1, this.screenNow) : VIDEO_BITRATE;

      /*
       * Со сроком. «Не завелось» бывает двух видов: честный отказ
       * и молчание — когда дорога до сервера согласована, а соединиться
       * по ней не выходит. Второе опаснее: без срока показ повисал бы
       * навсегда, и человек видел бы включённую кнопку и чёрный
       * прямоугольник у собеседников.
       */
      const вышло = await Promise.race([
        this.sfu.отдать(video, что, потолок),
        new Promise<boolean>((готово) => setTimeout(() => готово(false), SFU_ЖДЁМ)),
      ]);

      if (вышло) {
        this.черезРаздачу.add(kind);

        // Звук показа уходит той же дорогой: он часть показа, и делить
        // их по разным путям значило бы получить рассинхрон.
        const audio = kind === "screen" ? share.stream.getAudioTracks()[0] : undefined;
        if (audio) await this.sfu.отдать(audio, "screenAudio", 0);
        return;
      }
    }

    for (const [userId, peer] of this.peers) this.sendShareTo(userId, peer, kind);
  }

  private sendShareTo(userId: string, peer: Peer, kind: ShareKind): void {
    const share = this.shares[kind];
    if (!share.stream) return;
    const senders: RTCRtpSender[] = [];

    for (const track of share.stream.getTracks()) {
      const sender = peer.connection.addTrack(track, share.stream);
      senders.push(sender);
      if (track.kind === "video") {
        // Порядок важен: список кодеков переставляем до того, как
        // соединение начнёт договариваться, иначе просьба опоздает.
        if (kind === "screen") просимH264(peer.connection, sender);
        void this.limitVideo(sender, kind);
      }
    }

    share.senders.set(userId, senders);
  }

  /** Потолок по кадрам и по битрейту.
   *
   *  Ограничение на захвате браузер соблюдает не всегда, а здесь
   *  оно попадает прямо в кодировщик. Битрейт нужен по той же
   *  причине: соединений «каждый с каждым» столько же, сколько
   *  собеседников, и без потолка исходящий канал делится между
   *  ними до полной неразборчивости. */
  private async limitVideo(sender: RTCRtpSender, kind: ShareKind): Promise<void> {
    const screen = kind === "screen";
    const { screenFps } = getPreferences();
    try {
      const parameters = sender.getParameters();
      // Экрану важна плавность: по дёргающейся демонстрации следить
      // за чужими действиями невозможно. Лицу важнее чёткость —
      // подвисший на четверть секунды кадр разговору не мешает,
      // а мыло вместо лица мешает.
      parameters.degradationPreference = screen ? "maintain-framerate" : "maintain-resolution";
      parameters.encodings = (parameters.encodings?.length ? parameters.encodings : [{}]).map(
        (encoding) => ({
          ...encoding,
          maxFramerate: screen ? screenFps : VIDEO_FPS,
          maxBitrate: screen ? screenBitrate(this.peers.size, this.screenNow) : VIDEO_BITRATE,
        }),
      );
      await sender.setParameters(parameters);
    } catch {
      // Старый браузер не принял настройки — показ всё равно пойдёт,
      // просто без потолка.
    }
  }

  async stopShare(kind: ShareKind): Promise<void> {
    const share = this.shares[kind];
    if (!share.stream) return;

    if (this.черезРаздачу.has(kind)) {
      this.sfu?.прекратить(kind === "screen" ? "screen" : "video");
      if (kind === "screen") this.sfu?.прекратить("screenAudio");
      this.черезРаздачу.delete(kind);
    }

    for (const [userId, senders] of share.senders) {
      const peer = this.peers.get(userId);
      for (const sender of senders) {
        try {
          peer?.connection.removeTrack(sender);
        } catch {
          // Соединение уже закрыто — убирать нечего.
        }
      }
    }
    share.senders.clear();
    share.published = false;

    for (const track of share.stream.getTracks()) track.stop();
    // Гаситель и подменённый им исходный захват — отдельно: в потоке
    // исходной дорожки уже нет, а держать её открытой после показа
    // значит держать открытым и захват системного звука.
    share.guard?.stop();
    share.raw?.stop();
    share.guard = null;
    share.raw = null;
    share.stream = null;
  }

  /** Передняя камера ↔ задняя.
   *
   *  Через replaceTrack, а не перезапуском: соединение и имя потока
   *  остаются прежними, пересогласовывать нечего, и у собеседника
   *  картинка просто меняется без чёрной паузы. */
  async flipCamera(): Promise<void> {
    const share = this.shares.video;
    if (!share.stream) return;

    const next = this.facing === "user" ? "environment" : "user";
    const fresh = await this.openCamera(next);
    const track = fresh?.getVideoTracks()[0];
    if (!track) return;

    for (const senders of share.senders.values()) {
      for (const sender of senders) {
        if (sender.track?.kind !== "video") continue;
        try {
          await sender.replaceTrack(track);
        } catch {
          // Соединение закрылось на полпути — остальным всё равно меняем.
        }
      }
    }

    // Свой поток тот же самый объект: меняем дорожки внутри него,
    // и своё изображение переворачивается вместе с чужим.
    for (const old of share.stream.getVideoTracks()) {
      share.stream.removeTrack(old);
      old.stop();
    }
    share.stream.addTrack(track);
    track.addEventListener("ended", () => void this.stopShare("video"));
    this.facing = next;
  }


  setMuted(muted: boolean): void {
    // Глушим сам микрофон, а не выход усилителя: так в цепочку
    // не попадает ничего, и индикатор «говорит» тоже замолкает.
    for (const track of this.mic?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
  }

  stop(): void {
    if (this.qualityTimer) clearInterval(this.qualityTimer);
    this.qualityTimer = null;

    const socket = getSocket();
    socket?.off("sfu:producer", this.наПоток);
    socket?.off("sfu:producer-gone", this.наКонец);
    this.sfu?.закрыть();
    this.sfu = null;
    this.раздачей.clear();
    this.напрямую.clear();
    this.черезРаздачу.clear();
    for (const kind of KINDS) void this.stopShare(kind);
    for (const userId of [...this.peers.keys()]) this.disconnect(userId);
    for (const track of this.mic?.getTracks() ?? []) track.stop();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.mic = null;
    this.stream = null;
    this.micSource?.disconnect();
    this.micSource = null;
    this.denoise?.disconnect();
    this.denoise = null;
    this.micGain?.disconnect();
    this.micGain = null;
    this.master?.disconnect();
    this.master = null;
    void this.context?.close();
    this.context = null;
    this.meters.clear();
  }

  /** Индикатор «говорит». Считаем громкость на месте, а не гоняем
   *  её по сети: это чисто локальная величина, и сорок сообщений
   *  в секунду ради зелёного кружка — плохая цена. */
  private watchLevel(userId: string, stream: MediaStream): void {
    if (!this.context) return;
    // Прежний счётчик останавливаем: поток собеседника может смениться
    // (переподключение, новое устройство), и два таймера на одного
    // человека начали бы спорить, говорит он или нет.
    this.meters.get(userId)?.();
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 512;
    this.context.createMediaStreamSource(stream).connect(analyser);

    const data = new Uint8Array(analyser.fftSize);
    const gate = new SpeechGate();
    let running = true;
    let lit = false;

    // Смотрим чаще, чем раньше: огонёк должен загораться на первом же
    // звуке. Раньше между замерами проходило 150 мс, и начало слова
    // заметно опаздывало. От частых замеров не мигает — за это отвечает
    // удержание внутри SpeechGate, а не редкий опрос.
    const tick = () => {
      if (!running) return;
      analyser.getByteTimeDomainData(data);
      const speaking = gate.feed(rmsOf(data), Date.now());
      // Наверх сообщаем только перемены: одинаковое решение семь раз
      // в секунду — это семь перерисовок списка ни за чем.
      if (speaking !== lit) {
        lit = speaking;
        this.events.onSpeaking(userId, speaking);
      }
      setTimeout(tick, 80);
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
  // В разработке разговор доступен из консоли: window.__voice.
  // Тем же пользуются сквозные проверки: заглянуть внутрь разговора
  // иначе неоткуда, а гадать о его состоянии — плохая проверка.
  if (import.meta.env?.DEV && typeof window !== "undefined") {
    (window as unknown as { __voice: VoiceSession | null }).__voice = session;
  }
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
