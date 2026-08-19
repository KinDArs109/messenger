/**
 * Кто просил не беспокоить.
 *
 * Отдельным крошечным модулем, а не полем в присутствии, ради одного:
 * уведомления на телефон отправляет модуль push, а присутствие живёт
 * в realtime — и стоило им сослаться друг на друга, как получилось бы
 * кольцо импортов. Кольца в модулях ломаются не там, где их завели,
 * а через полгода и в другом месте.
 *
 * Здесь только знание «сейчас тихо». Почему тихо и надолго ли —
 * дело присутствия.
 */
const quiet = new Set<string>();

export function setQuiet(userId: string, on: boolean): void {
  if (on) quiet.add(userId);
  else quiet.delete(userId);
}

export function wantsQuiet(userId: string): boolean {
  return quiet.has(userId);
}
