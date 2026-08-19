import { prisma } from "../db/client.js";
import { badRequest } from "./errors.js";
import { deleteFile, fileUrl } from "./storage.js";

/**
 * Картинки, которые не висят на сообщении: аватар профиля и значок
 * сервера.
 *
 * Они проходят через то же хранилище, что и вложения, — на диске это
 * такой же файл и такая же запись. Отличие одно: вложение привязано
 * к сообщению, а картинка профиля — к самому профилю. Отсюда всё
 * остальное в этом файле: проверить, что человек ставит своё, а не
 * подобранное чужое, и убрать заменённое, ничего не задев.
 */

const PREFIX = "/uploads/";

const keyOf = (url: string): string => url.slice(PREFIX.length);

/**
 * Убедиться, что картинку загрузил тот, кто её сейчас ставит.
 *
 * Без этого достаточно подставить в запрос чужую ссылку — и картинка
 * из чужой переписки станет своим аватаром. Заодно требуем, чтобы она
 * ещё не висела на сообщении: иначе, сменив аватар позже, человек
 * снёс бы вместе с ним картинку из своей же старой переписки.
 */
export async function requireOwnPicture(userId: string, url: string): Promise<void> {
  const attachment = await prisma.attachment.findUnique({
    where: { storageKey: keyOf(url) },
    select: { uploaderId: true, messageId: true },
  });
  if (!attachment || attachment.uploaderId !== userId || attachment.messageId !== null) {
    throw badRequest("NO_PICTURE", "Картинка не найдена");
  }
}

/**
 * Убрать заменённую картинку — и запись, и файл.
 *
 * Вызывается уже после того, как новая записана: сначала проверяем,
 * что на старую никто больше не ссылается. Одну и ту же загрузку
 * можно поставить и себе, и серверу, и тогда смена аватара уносила бы
 * значок сервера вместе с собой.
 */
export async function forgetPicture(url: string | null): Promise<void> {
  if (!url?.startsWith(PREFIX)) return;

  const [asAvatar, asIcon] = await Promise.all([
    prisma.user.count({ where: { avatarUrl: url } }),
    prisma.server.count({ where: { iconUrl: url } }),
  ]);
  if (asAvatar + asIcon > 0) return;

  const key = keyOf(url);
  // Только неприкреплённое: если ссылка почему-то указывает
  // на картинку из переписки, трогать её нельзя.
  const { count } = await prisma.attachment.deleteMany({
    where: { storageKey: key, messageId: null },
  });
  if (count > 0) await deleteFile(key);
}

/** Все ключи файлов, которые сейчас служат аватарами и значками.
 *
 *  Нужны уборке: она сметает всё, что не привязано к сообщению,
 *  и без этого списка первым же запуском снесла бы все аватары. */
export async function pictureKeysInUse(): Promise<Set<string>> {
  const [users, servers] = await Promise.all([
    prisma.user.findMany({ where: { avatarUrl: { not: null } }, select: { avatarUrl: true } }),
    prisma.server.findMany({ where: { iconUrl: { not: null } }, select: { iconUrl: true } }),
  ]);

  const keys = new Set<string>();
  for (const url of [...users.map((u) => u.avatarUrl), ...servers.map((s) => s.iconUrl)]) {
    if (url?.startsWith(PREFIX)) keys.add(keyOf(url));
  }
  return keys;
}

/** Ссылка на только что сохранённую картинку. */
export const pictureUrl = fileUrl;
