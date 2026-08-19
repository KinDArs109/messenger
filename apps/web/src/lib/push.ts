import { api } from "./api";

/**
 * Уведомления, когда мессенджер закрыт.
 *
 * Пока приложение открыто, о новом сообщении рассказывает живое
 * соединение. Но телефон в кармане соединения не держит: приложение
 * свёрнуто, сокет закрыт — и человек узнаёт о сообщении, только когда
 * сам решит посмотреть.
 *
 * Чинится это единственным существующим способом: подпиской у службы
 * доставки самого браузера. Она одна умеет разбудить спящий телефон,
 * потому что соединение с ним держит система, а не мы. Наш сервер
 * лишь отдаёт ей запечатанный конверт — ключи от него есть только
 * у этого браузера.
 *
 * Всё, кроме подписки, делает service worker: страницы в этот момент
 * может не быть вовсе.
 */

/** Умеет ли этот браузер вообще. Safari до 16.4 и любой браузер
 *  без service worker — не умеет, и предлагать там нечего. */
export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Разрешение спрашивали и что ответили. */
export function pushPermission(): NotificationPermission {
  return pushSupported() ? Notification.permission : "denied";
}

/** Подписан ли этот браузер прямо сейчас. */
export async function pushSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  const registration = await navigator.serviceWorker.ready;
  return (await registration.pushManager.getSubscription()) !== null;
}

/**
 * Включить.
 *
 * Возвращает понятную человеку причину отказа или null, если всё
 * получилось. Причина нужна: «не работает» без объяснения — худшее,
 * что можно показать в настройках.
 */
export async function pushEnable(): Promise<string | null> {
  if (!pushSupported()) return "Этот браузер не умеет уведомления при закрытом приложении";

  const { key } = await api.get<{ key: string | null }>("/push/key");
  if (!key) return "На сервере не настроены ключи уведомлений";

  // Спрашивать разрешение можно только по нажатию — здесь мы как раз
  // внутри обработчика нажатия.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return permission === "denied"
      ? "Уведомления запрещены в настройках браузера — разрешите их для этого сайта"
      : "Разрешение не выдано";
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();

  // Старая подписка могла остаться от прежней пары ключей: сервер
  // такие письма подписать не сможет, и они будут молча теряться.
  // Дешевле переподписаться, чем разбираться, та ли она.
  if (existing) await existing.unsubscribe().catch(() => undefined);

  const subscription = await registration.pushManager.subscribe({
    // Уведомление без текста браузеры запрещают: «тихая» подписка
    // позволяла бы следить за человеком, ничего ему не показывая.
    userVisibleOnly: true,
    applicationServerKey: fromBase64Url(key),
  });

  const raw = subscription.toJSON() as { endpoint?: string; keys?: Record<string, string> };
  if (!raw.endpoint || !raw.keys?.p256dh || !raw.keys?.auth) {
    return "Браузер выдал подписку без ключей";
  }

  await api.post("/push", {
    endpoint: raw.endpoint,
    keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth },
    label: deviceLabel(),
  });

  return null;
}

/** Выключить — и на этом устройстве, и на сервере. */
export async function pushDisable(): Promise<void> {
  if (!pushSupported()) return;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => undefined);
  await api.post("/push/forget", { endpoint }).catch(() => undefined);
}

/** Как назвать устройство в списке. Грубо и достаточно: человеку надо
 *  отличить телефон от ноутбука, а не узнать версию браузера. */
function deviceLabel(): string {
  const agent = navigator.userAgent;
  const where = /Android/i.test(agent)
    ? "Android"
    : /iPhone|iPad/i.test(agent)
      ? "iPhone"
      : /Windows/i.test(agent)
        ? "Windows"
        : /Mac/i.test(agent)
          ? "Mac"
          : "устройство";
  const browser = /Firefox/i.test(agent)
    ? "Firefox"
    : /Edg\//i.test(agent)
      ? "Edge"
      : /Chrome/i.test(agent)
        ? "Chrome"
        : "браузер";
  return `${browser} на ${where}`;
}

/** Ключ приезжает в base64url, а подписке нужны байты. */
function fromBase64Url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
