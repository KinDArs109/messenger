import type { PrivateUser } from "@messenger/shared";

/**
 * Работа без сервера.
 *
 * Сами данные сохраняет service worker: он кладёт ответы сервера и
 * присланные файлы, и отдаёт их, когда сеть не отвечает. Здесь только
 * то, чего он сделать не может, — помнить, кто вошёл.
 *
 * Личность приходится держать отдельно: всё про вход через кэш не
 * проходит намеренно (там токены и коды), а без имени пользователя
 * приложение показало бы форму входа поверх сохранённой переписки.
 *
 * Отсюда честная цена, о которой надо знать: пока вы не вышли из
 * аккаунта, последняя переписка лежит на диске и откроется без пароля
 * у любого, кто откроет приложение на этом компьютере. Так же устроен
 * и дискорд. Выход из аккаунта стирает всё сохранённое.
 */

const KEY = "messenger:last-user";

export function rememberUser(user: PrivateUser): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(user));
  } catch {
    // Переполненное хранилище — не повод ломать вход.
  }
}

export function lastUser(): PrivateUser | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PrivateUser) : null;
  } catch {
    return null;
  }
}

/** Выход стирает и личность, и всё сохранённое worker'ом. */
export function forgetEverything(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Уже нечего забывать.
  }
  navigator.serviceWorker?.controller?.postMessage("forget");
}

/** Дошёл ли запрос до сервера.
 *
 *  Отличать «сервера нет» от «сервер отказал» обязательно: в первом
 *  случае показываем сохранённое, во втором человека действительно
 *  разлогинили, и показывать ему чужую переписку нельзя. */
export function isNetworkFailure(error: unknown): boolean {
  if (!navigator.onLine) return true;
  // fetch не смог достучаться — это TypeError без кода ответа.
  return error instanceof TypeError;
}
