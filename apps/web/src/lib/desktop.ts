/**
 * Возможности оболочки, которых нет у сайта.
 *
 * Один и тот же клиент открывается и в браузере, и в приложении.
 * В браузере моста нет вовсе — значит здесь всё необязательное:
 * ни одна кнопка не должна ломаться от того, что человек зашёл
 * по ссылке, а не поставил .exe.
 *
 * Мост появляется, только если страница загружена с того адреса,
 * который оболочка считает своим (см. apps/desktop/preload.cjs).
 */

export type PushToTalkMode = "off" | "hold" | "toggle";

export interface OverlayPerson {
  id: string;
  name: string;
  avatar: string;
  speaking: boolean;
  /** Микрофон выключен у него самого — это видят все. */
  muted: boolean;
  /** Показывает экран. */
  screen: boolean;
  me: boolean;
  /** Громкость и заглушение — наши личные, по сети не уходят. */
  volume: number;
  silenced: boolean;
}

export interface OverlayState {
  /** Идёт ли разговор. От этого зависит и окошко, и то, занята ли
   *  клавиша: держать её занятой вне разговора — значит отбирать
   *  её у игр без надобности. */
  inCall: boolean;
  /** Когда показывать само окошко. Меню открывается при любом
   *  значении: кому-то список поверх игры мешает, а быстрый доступ
   *  к микрофону нужен всем. */
  hudMode: "always" | "game" | "never";
  /** Имена файлов игр для режима "game". Решает оболочка: список
   *  запущенных процессов виден только ей. */
  games: string[];
  people: OverlayPerson[];
  channels: { id: string; name: string; count: number; current: boolean }[];
  channelName?: string;
  muted?: boolean;
  deafened?: boolean;
  sharing?: boolean;
  /** Общая громкость разговора, 0–2. */
  master?: number;
  pos?: { x: number; y: number };
  scale?: number;
  key?: string;
}

/** Что нажали в меню. Все поля кроме type необязательные: разбирает
 *  их получатель, и разбирает по одному. */
export interface OverlayAction {
  type:
    | "mute"
    | "deafen"
    | "leave"
    | "screen"
    | "join"
    | "volume"
    | "silence"
    | "move"
    | "scale"
    | "master"
    | "hudMode";
  channelId?: string;
  userId?: string;
  value?: number;
  mode?: string;
  x?: number;
  y?: number;
}

/** Что сейчас запущено на компьютере. Нужно затем, чтобы игру
 *  выбирали из списка, а не вписывали имя файла по памяти. */
export interface RunningApp {
  name: string;
  /** Килобайты. Игра — обычно самое тяжёлое, что есть на машине. */
  memory: number;
  /** Заголовок окна: то, как программа называет себя сама. Его же
   *  увидят друзья в «играет в …». Бывает пустым — у программ
   *  без окна. */
  title?: string;
}

interface DesktopBridge {
  isApp: true;
  version?: string;
  window: {
    minimize: () => void;
    toggleMaximize: () => void;
    hide: () => void;
    isMaximized: () => Promise<boolean>;
    /** Окно во весь экран. Появилось позже остальных — у не обновившейся
     *  оболочки этого нет, и тогда работает запасной путь страницы. */
    setFullscreen?: (on: boolean) => void;
    /** Перезапустить мессенджер целиком — когда вышла новая версия.
     *  Тоже появилось позже: у старой оболочки этого нет, и там
     *  по-прежнему перезагружается страница. */
    restart?: () => void;
    onMaximizedChange: (callback: (value: boolean) => void) => () => void;
  };
  /** То, что знает система, а страница — нет. */
  system?: {
    /** Сколько секунд человек не трогал ни мышь, ни клавиатуру —
     *  во всей системе, а не только в мессенджере.
     *
     *  Нужно для «неактивен». По своим событиям играющий в игру
     *  выглядит отошедшим через десять минут, хотя как раз сидит
     *  за компьютером и ждёт, когда друзья соберутся. */
    idleSeconds?: () => Promise<number>;
  };
  setBadge: (count: number) => void;
  /** icon — картинка данными (data:image/png). Нужна, чтобы в окошке
   *  стоял аватар человека, а не одинаковая иконка приложения.
   *  null — рисовать нечего, оболочка возьмёт иконку сама. */
  notify: (data: {
    title: string;
    body: string;
    channelId?: string;
    icon?: string | null;
  }) => void;
  onOpenChannel: (callback: (channelId: string) => void) => () => void;
  /** Всё, что нужно окошку поверх игры и его меню. Уезжает целиком
   *  и на каждое изменение: меню открывается по клавише в любой момент
   *  и должно нарисовать правильное сразу.
   *
   *  Необязательное: в оболочках, поставленных до появления оверлея,
   *  этой функции нет, и вызов без проверки уронил бы приложение
   *  у всех, кто не обновился. */
  setOverlay?: (data: OverlayState) => void;
  /** Нажатия в меню оверлея. Возвращает отписку. */
  onOverlayAction?: (callback: (action: OverlayAction) => void) => () => void;
  /** Что сейчас запущено — для выбора игры в настройках. */
  listApps?: () => Promise<RunningApp[]>;
  /** Запустилась или закрылась игра из списка: имя файла или null. */
  onGame?: (callback: (name: string | null) => void) => () => void;
  /** Что запущено прямо сейчас. Нужно после обрыва связи: про перемены
   *  оболочка расскажет сама, а про «всё это время шло одно и то же» —
   *  только если спросить. Появилось позже onGame, поэтому необязательно:
   *  у не обновившейся оболочки этого нет. */
  currentGame?: () => Promise<string | null>;
  /** Обновление скачано и ждёт перезапуска. Приходит версия. */
  onUpdateReady?: (callback: (version: string) => void) => () => void;
  /** Перезапустить и установить скачанное. */
  installUpdate?: () => void;
  getAutostart: () => Promise<boolean>;
  setAutostart: (enabled: boolean) => Promise<boolean>;
  setPushToTalk: (options: {
    mode: PushToTalkMode;
    accelerator: string | null;
  }) => Promise<{ ok: boolean; reason?: string }>;
  onPushToTalk: (callback: (active: boolean) => void) => () => void;
  onScreenPick: (
    callback: (sources: { id: string; name: string; kind: "screen" | "window"; thumbnail: string }[]) => void,
  ) => () => void;
  screenPicked: (id: string | null) => void;
}

declare global {
  interface Window {
    messenger?: DesktopBridge;
  }
}

export const desktop = (): DesktopBridge | undefined =>
  typeof window === "undefined" ? undefined : window.messenger;

/** В приложении мы или в браузере. Определяет, рисовать ли свою шапку
 *  окна и показывать ли настройки, которых в браузере не бывает. */
export const isApp = (): boolean => Boolean(desktop());
