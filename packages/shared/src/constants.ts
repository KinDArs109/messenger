/** Ограничения, общие для клиента и сервера. Клиент показывает счётчики
 *  и блокирует отправку, сервер — проверяет по-настоящему.
 *  Клиентская валидация — это удобство, серверная — это защита. */

export const LIMITS = {
  username: { min: 3, max: 32 },
  displayName: { min: 1, max: 48 },
  password: { min: 8, max: 128 },
  serverName: { min: 2, max: 64 },
  channelName: { min: 1, max: 48 },
  channelTopic: { max: 512 },
  messageContent: { max: 4000 },
  uploadBytes: 10 * 1024 * 1024,
} as const;

/**
 * Уровни сервера и что они открывают.
 *
 * В дискорде буст — способ продать снятие ограничений, которые тот же
 * дискорд и поставил. Здесь продавать некому: сервер свой, платить
 * пришлось бы себе же. Поэтому буст остался механикой, а деньги
 * из неё убраны: бустит любой участник, по одному бусту на человека,
 * и снимает так же — одним нажатием.
 *
 * Пороги маленькие, потому что и компания маленькая: четверо. Порог
 * в четырнадцать бустов, как в дискорде, здесь означал бы «никогда».
 *
 * Каждый уровень обязан что-то открывать, иначе это не уровни,
 * а надпись. Открывает — то, что действительно работает.
 */
export const BOOST_TIERS = [
  {
    level: 1,
    boosts: 1,
    /** Вложения побольше: 10 МБ хватает на картинку, но не на видео,
     *  а именно видео и кидают. */
    uploadBytes: 25 * 1024 * 1024,
    unlocks: "Вложения до 25 МБ и значок у тех, кто бустил",
  },
  {
    level: 2,
    boosts: 2,
    uploadBytes: 50 * 1024 * 1024,
    unlocks: "Баннер сервера и вложения до 50 МБ",
  },
  {
    level: 3,
    boosts: 4,
    uploadBytes: 100 * 1024 * 1024,
    // Здесь должны появиться свои эмодзи сервера — они следующие
    // в работе. Пока их нет, и в списке уровней их нет тоже: обещать
    // в интерфейсе несделанное нельзя, это единственное место, где
    // человек и узнаёт, что ему полагается.
    unlocks: "Вложения до 100 МБ — весь сервер в сборе",
  },
] as const;

/** Какой уровень даёт столько бустов. Ноль — уровня нет. */
export function boostLevel(boosts: number): number {
  let level = 0;
  for (const tier of BOOST_TIERS) if (boosts >= tier.boosts) level = tier.level;
  return level;
}

/** Сколько ещё бустов до следующего уровня. null — выше некуда. */
export function boostsToNext(boosts: number): number | null {
  const next = BOOST_TIERS.find((tier) => boosts < tier.boosts);
  return next ? next.boosts - boosts : null;
}

/** Предел вложения для сервера такого уровня. Без уровня — базовый. */
export function uploadLimitFor(level: number): number {
  const tier = [...BOOST_TIERS].reverse().find((t) => t.level <= level);
  return tier?.uploadBytes ?? LIMITS.uploadBytes;
}

export const CHANNEL_TYPES = ["TEXT", "VOICE", "DM", "GROUP_DM"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const MEMBER_ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const USER_STATUSES = ["online", "idle", "dnd", "offline"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * Что человек выбрал о себе сам.
 *
 * Не то же самое, что видят остальные (UserStatus выше). Разница
 * в двух местах, и обе важные:
 *
 * «Невидимый» наружу не уходит никогда — друзьям он показывается
 * как «не в сети», иначе от невидимости нет никакого толку.
 *
 * «Не в сети» выбрать нельзя: это не выбор, а факт. Оно ставится
 * само, когда закрылось последнее соединение.
 */
export const CHOSEN_STATUSES = ["online", "idle", "dnd", "invisible"] as const;
export type ChosenStatus = (typeof CHOSEN_STATUSES)[number];

/** Через сколько молчания человек считается неактивным.
 *
 *  Десять минут, как в дискорде. Меньше — и «неактивен» загорается
 *  у того, кто просто читает; больше — и он остаётся «в сети»,
 *  уйдя ужинать, а друзья ждут ответа. */
export const IDLE_AFTER_MS = 10 * 60 * 1000;

/** Сообщения одного автора склеиваются в группу, если между ними
 *  меньше этого интервала. Влияет только на отображение. */
export const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Клиент гасит индикатор «печатает», если событие не повторилось. */
export const TYPING_TIMEOUT_MS = 5000;

/** Быстрый набор реакций. Полноценный выбор эмодзи ещё не сделан;
 *  на практике девять кнопок закрывают почти все случаи. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥", "👀", "🎉", "😢", "🤔", "💯"] as const;
