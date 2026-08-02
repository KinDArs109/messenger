import { LIMITS } from "./constants.js";

/** Разбор упоминаний вида @username.
 *
 *  Правило живёт здесь, а не на сервере и не в клиенте по отдельности:
 *  сервер по нему считает, кому увеличить счётчик, а клиент — что
 *  подсветить в тексте. Разойдись они хоть на символ — человек видел бы
 *  подсветку там, где уведомления не будет, или наоборот. */
const PATTERN = new RegExp(
  `@([a-z0-9._]{${LIMITS.username.min},${LIMITS.username.max}})`,
  "gi",
);

export interface MentionMatch {
  username: string;
  start: number;
  end: number;
}

export function findMentions(text: string): MentionMatch[] {
  const found: MentionMatch[] = [];
  for (const match of text.matchAll(PATTERN)) {
    if (match.index === undefined) continue;
    // Логин не может кончаться точкой — отрезаем её, если прилипла
    // из-за знака препинания в конце фразы.
    const username = match[1]!.toLowerCase().replace(/\.+$/, "");
    if (username.length < LIMITS.username.min) continue;
    found.push({
      username,
      start: match.index,
      end: match.index + username.length + 1,
    });
  }
  return found;
}

export const mentionedUsernames = (text: string): string[] => [
  ...new Set(findMentions(text).map((m) => m.username)),
];

export interface ReadStateDto {
  channelId: string;
  /** Последнее сообщение в канале. null, если канал пуст. */
  lastMessageId: string | null;
  /** На чём остановился читатель. null — не открывал ни разу. */
  lastReadMessageId: string | null;
  mentionCount: number;
}
