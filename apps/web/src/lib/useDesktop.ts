import { useEffect } from "react";
import type { MessageDto, PublicUser } from "@messenger/shared";
import { hasUnread, useStore } from "./store";
import { desktop } from "./desktop";
import { avatarColor, initial } from "./utils";
import { getPreferences } from "./preferences";
import { shouldAlertGame } from "./gameAlerts";

/**
 * То, чем приложение отличается от вкладки браузера.
 *
 * Всё здесь необязательное: в браузере моста нет, и каждая функция
 * просто ничего не делает. Один и тот же клиент должен работать
 * в обоих местах, а не ломаться от того, что человек зашёл по ссылке.
 */

/** Значок с числом непрочитанного поверх иконки в панели задач.
 *
 *  Считаем упоминания, а не сообщения: цифра «312» на иконке значит
 *  ровно столько же, сколько её отсутствие. Если упоминаний нет,
 *  но что-то непрочитанное есть, показываем точку — единицу без
 *  претензии на точный счёт. */
export function useTaskbarBadge(): void {
  const readStates = useStore((s) => s.readStates);

  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;

    let mentions = 0;
    let anyUnread = false;
    for (const state of readStates.values()) {
      mentions += state.mentionCount;
      if (hasUnread(state)) anyUnread = true;
    }

    bridge.setBadge(mentions > 0 ? mentions : anyUnread ? 1 : 0);
  }, [readStates]);
}

/** Щелчок по уведомлению открывает нужный канал.
 *
 *  Источников два, и оба ведут сюда же. Оболочка на компьютере
 *  присылает канал через свой мост. Телефон — через service worker:
 *  там уведомление показывает он, и он же говорит открытой странице,
 *  куда перейти. Если открытой страницы не было, канал приезжает
 *  меткой в адресе — её разбираем здесь же, на запуске. */
export function useNotificationClicks(): void {
  useEffect(() => {
    const open = (channelId: string) => useStore.getState().selectChannel(channelId);

    const stop = desktop()?.onOpenChannel(open);

    const onWorker = (event: MessageEvent) => {
      const data = event.data as { type?: string; channelId?: string } | null;
      if (data?.type === "open-channel" && data.channelId) open(data.channelId);
    };
    navigator.serviceWorker?.addEventListener("message", onWorker);

    // Приложение только что запустили нажатием по уведомлению.
    // Метку сразу убираем: перезагрузка страницы не должна снова
    // уводить человека в ту же переписку через час.
    const fromCold = /^#channel=(.+)$/.exec(location.hash);
    if (fromCold?.[1]) {
      open(decodeURIComponent(fromCold[1]));
      history.replaceState(null, "", location.pathname + location.search);
    }

    return () => {
      stop?.();
      navigator.serviceWorker?.removeEventListener("message", onWorker);
    };
  }, []);
}

/**
 * Аватар человека картинкой для системного уведомления.
 *
 * Рисуем здесь, а не в оболочке, по двум причинам. Аватары лежат
 * в webp — Electron такие не открывает, а окно браузера открывает
 * и умеет перерисовать в png. И у кого аватара нет, нужен тот же
 * кружок с буквой, что и в самом мессенджере: в уведомлении иначе
 * стояла бы иконка приложения, одинаковая для всех, и с одного
 * взгляда было бы не понять, кто написал.
 *
 * Ошибка здесь ничего не ломает: вернём null, и уведомление придёт
 * с иконкой приложения, как раньше.
 */
export async function avatarPng(user: PublicUser): Promise<string | null> {
  const SIZE = 96;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    if (user.avatarUrl) {
      const image = await new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = user.avatarUrl!;
      });
      if (!image) return null;

      // Кружком, как везде в мессенджере: квадратная картинка
      // в уведомлении выглядит чужой.
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(image, 0, 0, SIZE, SIZE);
    } else {
      ctx.fillStyle = avatarColor(user.id);
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#fff";
      ctx.font = `600 ${SIZE * 0.42}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // Небольшой сдвиг вниз: middle у шрифта считается по кегельной
      // площадке, а не по глазу буквы, и без поправки буква сидит выше
      // середины кружка.
      ctx.fillText(initial(user.displayName), SIZE / 2, SIZE / 2 + SIZE * 0.04);
    }

    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/**
 * Показать уведомление — тем способом, какой здесь работает.
 *
 * В приложении на компьютере это делает оболочка: у неё есть иконка
 * в трее, свои звуки и переход в нужный канал по нажатию.
 *
 * В браузере — service worker. Именно он, а не `new Notification`:
 * на Android второе запрещено вовсе, там уведомление умеет показывать
 * только он. Заодно и нажатие обрабатывается в одном месте — тем же
 * кодом, что и уведомления с сервера, когда мессенджер закрыт.
 *
 * Разрешения не спрашиваем: его спрашивают в настройках, по нажатию.
 * Нет разрешения — молча ничего не показываем.
 */
function show(payload: {
  title: string;
  body: string;
  channelId: string;
  icon?: string | null;
  tag?: string;
}): void {
  // «Не беспокоить» — здесь, в единственном месте, через которое
  // проходят все уведомления. Проверять в каждом вызове означало бы
  // однажды забыть в одном из них, и обещание тишины держалось бы
  // до первого нового вида уведомлений.
  //
  // Сообщения при этом никуда не деваются: они приходят, копятся
  // непрочитанными и ждут. Молчит только окошко.
  if (useStore.getState().myStatus === "dnd") return;

  const bridge = desktop();
  if (bridge) {
    bridge.notify({
      title: payload.title,
      body: payload.body,
      channelId: payload.channelId,
      icon: payload.icon ?? null,
    });
    return;
  }

  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  void navigator.serviceWorker?.ready.then((registration) =>
    registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon ?? "/icon-192.png",
      badge: "/icon-192.png",
      tag: payload.tag ?? payload.channelId,
      data: { channelId: payload.channelId },
    }),
  );
}

/** Уведомление о новом сообщении.
 *
 *  Не уведомляем в двух случаях: сообщение своё и человек смотрит
 *  ровно этот канал. Второе важнее, чем кажется: без него окно
 *  всплывает на каждое слово собеседника, с которым как раз
 *  и переписываешься.
 */
export function notifyMessage(message: MessageDto): void {
  const state = useStore.getState();
  if (message.author.id === state.me?.id) return;
  if (message.channelId === state.channelId && document.hasFocus()) return;

  const channel = state.dms.find((dm) => dm.id === message.channelId)
    ? null
    : state.servers.flatMap((s) => s.channels).find((c) => c.id === message.channelId);

  void avatarPng(message.author).then((icon) => {
    show({
      title: channel
        ? `${message.author.displayName} · #${channel.name}`
        : message.author.displayName,
      // Вложение без текста — это не пустое сообщение, и уведомление
      // «прислал пустоту» сбивало бы с толку.
      body: message.content || "Вложение",
      channelId: message.channelId,
      icon,
    });
  });
}

/**
 * Найти человека по идентификатору где придётся.
 *
 * Список участников заполнен, только пока открыт сервер: ушёл человек
 * в личные сообщения — и список пуст. А уведомление о входе в разговор
 * нужно как раз тогда, когда в мессенджер не смотрят вовсе, и на каком
 * экране он был оставлен — дело случая. Поэтому смотрим ещё
 * в собеседников и в друзей.
 */
function findUser(userId: string): PublicUser | undefined {
  const state = useStore.getState();
  return (
    state.members.find((m) => m.id === userId) ??
    state.dms.flatMap((dm) => dm.participants).find((p) => p.id === userId) ??
    state.friendships.find((f) => f.user.id === userId)?.user
  );
}

/**
 * Кто-то зашёл в голосовой канал.
 *
 * Ради этого мессенджер, в общем, и заводили. Раньше узнать, что
 * друзья собрались, было нельзя никак: сигнал о чужом входе звучал,
 * только если ты уже сидишь в том же канале, — то есть ровно тогда,
 * когда и так всё видишь. Отсюда и «го в гс» в переписке: это
 * сообщение существовало потому, что приложение молчало.
 *
 * Не уведомляем сидящих в разговоре: они и так слышат сигнал входа,
 * а всплывающее окно поверх игры посреди разговора — помеха.
 * И не уведомляем о самом себе: второе устройство того же человека
 * не новость.
 */
/**
 * «Друг запустил игру».
 *
 * Не про всякую игру, а про ту, во что играем и мы: правило и причины
 * лежат в lib/gameAlerts.ts, здесь только показ. Тем, кто уже
 * в разговоре, не говорим — они и так вместе.
 */
const рассказано = new Map<string, string>();

export function notifyGame(userId: string, game: string | null): void {
  const state = useStore.getState();
  const prefs = getPreferences();

  const можно = shouldAlertGame({
    userId,
    meId: state.me?.id ?? null,
    game,
    myGames: prefs.myGames,
    enabled: prefs.gameAlerts,
    inCall: Boolean(state.voiceChannelId),
    quiet: state.myStatus === "dnd",
    told: game !== null && рассказано.get(userId) === game,
  });

  // Помним последнее в любом случае — и когда сказали, и когда
  // промолчали: иначе выход из разговора превращался бы в повод
  // рассказать про игру, которая идёт уже час.
  if (game) рассказано.set(userId, game);
  else рассказано.delete(userId);

  if (!можно || !game) return;

  const who = findUser(userId);
  if (!who) return;

  void avatarPng(who).then((icon) => {
    show({
      title: `${who.displayName} запустил ${game}`,
      body: "Вы тоже в это играете",
      // Ведём в личную переписку с ним, если она есть: первое, что
      // после такого уведомления делают, — пишут «го».
      channelId: state.dms.find((dm) => dm.participants.some((p) => p.id === userId))?.id ?? "",
      icon,
      tag: `game:${userId}`,
    });
  });
}

export function notifyVoiceJoin(channelId: string, userId: string): void {
  const state = useStore.getState();
  if (userId === state.me?.id) return;
  // Уже разговариваем — где угодно. Значит, и так в курсе.
  if (state.voiceChannelId) return;

  // Сервер нужен целиком, а не только канал: голосовых каналов
  // несколько, и серверов несколько — «кто-то где-то зашёл»
  // не отвечает ни на один вопрос.
  const server = state.servers.find((s) => s.channels.some((c) => c.id === channelId));
  const channel = server?.channels.find((c) => c.id === channelId);
  if (!channel) return;

  const who = findUser(userId);
  if (!who) return;

  // Сколько там теперь всего. При заходе троих подряд это разница
  // между тремя одинаковыми окошками и понятным «уже трое».
  const сколько = state.voiceMembers.get(channelId)?.size ?? 1;
  // Имя есть у всех каналов сервера; пустым оно бывает только
  // у личных переписок, а голосовых среди них не бывает.
  const где = `${server?.name ?? "сервер"} · ${channel.name ?? "голосовой канал"}`;

  void avatarPng(who).then((icon) => {
    show({
      title: `${who.displayName} зашёл в разговор`,
      body: сколько > 1 ? `${где} · уже ${сколько}` : где,
      channelId,
      icon,
      // Зашли трое — плашка одна, с последним числом.
      tag: `voice:${channelId}`,
    });
  });
}

/**
 * Вам звонят — уведомлением на рабочий стол.
 *
 * Звонок и так звучит, но окно мессенджера может быть свёрнуто
 * и заслонено игрой: звук слышно, а откуда он — нет. Уведомление
 * отвечает на этот вопрос и открывает переписку по нажатию.
 */
export function notifyCall(name: string, channelId: string): void {
  const bridge = desktop();
  if (!bridge) return;

  const who = useStore
    .getState()
    .dms.flatMap((dm) => dm.participants)
    .find((p) => p.displayName === name);

  void (who ? avatarPng(who) : Promise.resolve(null)).then((icon) => {
    bridge.notify({ title: `${name} звонит`, body: "Входящий звонок", channelId, icon });
  });
}
