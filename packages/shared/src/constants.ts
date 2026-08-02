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

export const CHANNEL_TYPES = ["TEXT", "VOICE", "DM", "GROUP_DM"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const MEMBER_ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const USER_STATUSES = ["online", "idle", "dnd", "offline"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Сообщения одного автора склеиваются в группу, если между ними
 *  меньше этого интервала. Влияет только на отображение. */
export const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Клиент гасит индикатор «печатает», если событие не повторилось. */
export const TYPING_TIMEOUT_MS = 5000;

/** Быстрый набор реакций. Полноценный выбор эмодзи ещё не сделан;
 *  на практике девять кнопок закрывают почти все случаи. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥", "👀", "🎉", "😢", "🤔", "💯"] as const;
