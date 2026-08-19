import webpush from "web-push";
import { prisma } from "../../db/client.js";
import { env } from "../../config/env.js";
import { newId } from "../../lib/ids.js";
import { wantsQuiet } from "../../realtime/quiet.js";

/**
 * Уведомления на закрытый телефон.
 *
 * Пока мессенджер открыт, о новом сообщении рассказывает живое
 * соединение, и никакие письма не нужны. Но телефон в кармане
 * соединения не держит: приложение свёрнуто, сокет закрыт, и человек
 * узнаёт о сообщении, когда сам решит посмотреть. Это и просили
 * починить.
 *
 * Как это устроено. Подписку выдаёт служба доставки самого браузера
 * (у Chrome — своя, у Firefox — своя): браузер отдаёт нам адрес и два
 * ключа. Мы шифруем письмо этими ключами и отправляем по адресу.
 * Служба доставки будит телефон и передаёт браузеру запечатанный
 * конверт — прочитать его она не может, ключей у неё нет.
 *
 * Своего сервера доставки не бывает: разбудить спящий телефон умеет
 * только тот, кто уже держит с ним соединение, то есть сама система.
 * Зато и аккаунта у Google для этого не требуется — достаточно пары
 * ключей, которую мы сделали сами.
 */

/** Настроены ли ключи. Без них уведомления просто выключены —
 *  это не ошибка, а ещё не сделанная настройка. */
export const pushEnabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

if (pushEnabled) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
}

export const vapidPublicKey = env.VAPID_PUBLIC_KEY ?? null;

export type PushPayload = {
  /** Заголовок: от кого. */
  title: string;
  /** Текст: что написали. */
  body: string;
  /** Куда открыть по нажатию. */
  channelId: string;
  /** Чтобы несколько сообщений из одного канала не выстраивались
   *  в столбик, а заменяли друг друга. */
  tag?: string;
  icon?: string;
};

/** Запомнить подписку. Одна и та же приезжает повторно при каждом
 *  запуске — тогда просто продлеваем ей жизнь, а не плодим копии. */
export async function remember(
  userId: string,
  device: { endpoint: string; p256dh: string; auth: string; label?: string },
): Promise<void> {
  await prisma.pushDevice.upsert({
    where: { endpoint: device.endpoint },
    update: { userId, p256dh: device.p256dh, auth: device.auth, usedAt: new Date() },
    create: {
      id: newId(),
      userId,
      endpoint: device.endpoint,
      p256dh: device.p256dh,
      auth: device.auth,
      label: device.label ?? null,
    },
  });
}

/** Отписаться. Без проверки владельца намеренно: знание адреса
 *  подписки и есть право её удалить, а чужого адреса не бывает —
 *  его выдаёт браузер конкретному браузеру. */
export async function forget(endpoint: string): Promise<void> {
  await prisma.pushDevice.deleteMany({ where: { endpoint } });
}

export async function devicesOf(userId: string): Promise<number> {
  return prisma.pushDevice.count({ where: { userId } });
}

/**
 * Разослать письмо на все телефоны человека.
 *
 * Ошибки здесь не должны ломать отправку сообщения: письмо — дело
 * десятое, а сообщение уже написано и уже разослано живым. Поэтому
 * ничего не бросаем наружу.
 *
 * 404 и 410 от службы доставки означают «такой подписки больше нет»:
 * приложение снесли, браузер почистили. Такие строки удаляем сразу,
 * иначе они копятся годами и каждый раз стучатся впустую.
 */
export async function notify(userId: string, payload: PushPayload): Promise<number> {
  if (!pushEnabled) return 0;

  // «Не беспокоить» — значит не беспокоить и телефон. Тишина только
  // на компьютере была бы половиной обещания: телефон лежит рядом
  // и звенит за двоих.
  if (wantsQuiet(userId)) return 0;

  const devices = await prisma.pushDevice.findMany({ where: { userId } });
  if (devices.length === 0) return 0;

  const body = JSON.stringify(payload);
  let delivered = 0;

  await Promise.all(
    devices.map(async (device) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: device.endpoint,
            keys: { p256dh: device.p256dh, auth: device.auth },
          },
          body,
          // Сутки: телефон может быть выключен, и письмо должно дождаться.
          // Дольше держать незачем — вчерашнее «привет» уже не новость.
          { TTL: 86_400, urgency: "high" },
        );
        delivered += 1;
        await prisma.pushDevice.update({
          where: { id: device.id },
          data: { usedAt: new Date() },
        });
      } catch (error) {
        const code = (error as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await prisma.pushDevice.delete({ where: { id: device.id } }).catch(() => undefined);
          return;
        }
        console.warn(`Уведомление не доставлено (${code ?? "нет кода"})`);
      }
    }),
  );

  return delivered;
}
