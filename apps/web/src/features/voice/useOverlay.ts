import { useEffect, useRef } from "react";
import { currentServer, findPerson, useStore } from "@/lib/store";
import { desktop, type OverlayPerson, type OverlayState } from "@/lib/desktop";
import { watchList } from "@/lib/games";
import { setPreference, usePreferences } from "@/lib/preferences";
import { avatarPng } from "@/lib/useDesktop";
import { useVoice, setUserVolume, setOutputGain, toggleUserMuted } from "./useVoice";

/**
 * Окошко поверх игры и меню, которое по нему открывается.
 *
 * Оболочка про разговор не знает ничего — весь состав, все «говорит»
 * и все громкости живут здесь. Отсюда и решение, показывать ли окошко:
 * оно нужно, только пока идёт разговор.
 *
 * Состояние уезжает целиком и на каждое изменение. Так меню, которое
 * открывается по клавише в любой момент, рисует правильное сразу —
 * а не пустоту, пока не приедет следующее обновление.
 *
 * Аватары уезжают туда картинкой в данных, а не ссылкой. Окошко —
 * локальный файл, и тянуть в него что-то с сервера значило бы разбирать
 * ещё и доступы; а рисовать кружок с буквой пришлось бы второй раз,
 * своим кодом. Всё это уже сделано для уведомлений, берём оттуда.
 */
export function useOverlay(): void {
  const { prefs } = usePreferences();
  const channelId = useStore((s) => s.voiceChannelId);
  const members = useStore((s) => s.voiceMembers);
  /* Людей берём из общей памяти, а не из списка участников открытого
   * сервера. Список пустеет, как только человек уходит с сервера —
   * например, на главную, — и окошко теряло собеседника ровно тогда,
   * когда оно и нужно: разговор идёт, а поверх игры «Участник». */
  const known = useStore((s) => s.known);
  const serverMembers = useStore((s) => s.members);
  const dms = useStore((s) => s.dms);
  const friendships = useStore((s) => s.friendships);
  const me = useStore((s) => s.me);
  const muted = useStore((s) => s.voiceMuted);
  const deafened = useStore((s) => s.voiceDeafened);
  const sharing = useStore((s) => s.voiceSharing);
  // Переход между каналами — это выход и вход: на мгновение канала нет
  // вовсе. Для оболочки это выглядело как «разговор кончился», и она
  // закрывала меню ровно в тот момент, когда человек в нём выбрал
  // канал. «Подключаемся» — тот же разговор, просто ещё не готовый.
  const connecting = useStore((s) => s.voiceConnecting);
  const server = useStore(currentServer);
  const servers = useStore((s) => s.servers);

  /** Готовые картинки: рисовать их на каждое «начал говорить» — это
   *  десятки перерисовок в минуту ради того, что не меняется.
   *
   *  Ключ — человек и его картинка вместе, а не один человек. Раньше
   *  был один человек, и поставленная аватарка не появлялась в окошке
   *  вовсе: там лежал кружок с буквой, нарисованный до неё, и повода
   *  перерисовать его не возникало до перезапуска. */
  const avatars = useRef(new Map<string, string>());

  /** Последнее, что показывали. Нужно ровно на время перехода между
   *  каналами, когда канала уже нет, а нового ещё нет. */
  const previous = useRef<{
    people: OverlayPerson[];
    channels: OverlayState["channels"];
    channelName: string;
  } | null>(null);

  useEffect(() => {
    const bridge = desktop();
    if (!bridge?.setOverlay) return;

    const base = {
      hudMode: prefs.overlayMode,
      // Известные игры плюс отмеченные руками: следить надо и за тем,
      // чего человек не отмечал, — иначе «играет в …» не увидит никто,
      // пока каждый не сходит в настройки.
      games: watchList(prefs.overlayGames),
      master: prefs.outputGain,
      pos: prefs.overlayPos,
      scale: prefs.overlayScale,
      key: prefs.overlayKey,
    };

    if (!channelId) {
      // Пока идёт подключение, отдаём последнее, что было: списки
      // на секунду опустели бы, и меню моргало бы «пока никого»
      // и пустым списком каналов — теми самыми кнопками, по одной
      // из которых только что нажали.
      if (connecting && previous.current) {
        // Микрофон и наушники переносим тоже: переход их не трогает,
        // а без них кнопки на секунду показали бы включённым то,
        // что человек только что выключил.
        bridge.setOverlay({
          ...base,
          ...previous.current,
          inCall: true,
          muted,
          deafened,
          sharing,
        });
        return;
      }
      previous.current = null;
      bridge.setOverlay({ ...base, inCall: false, people: [], channels: [] });
      return;
    }

    // Канал разговора может быть не на том сервере, который сейчас
    // открыт: человек зашёл в голосовой и ушёл читать другой сервер.
    // Список каналов для перехода берём от того сервера, где идёт
    // разговор, — иначе меню предлагало бы уйти не туда.
    const home =
      server?.channels.some((c) => c.id === channelId) === true
        ? server
        : servers.find((s) => s.channels.some((c) => c.id === channelId));

    const channels = (home?.channels ?? [])
      .filter((c) => c.type === "VOICE")
      .map((c) => ({
        id: c.id,
        // Имени у канала может не быть вовсе — рисовать пустую кнопку
        // нельзя: нажать на неё можно, а понять, куда она ведёт, нет.
        name: c.name ?? "Без названия",
        count: members.get(c.id)?.size ?? 0,
        current: c.id === channelId,
      }));

    const roster = members.get(channelId);
    let cancelled = false;

    void (async () => {
      const list = [];
      for (const [userId, state] of roster ?? []) {
        const user = findPerson(
          { me, known, members: serverMembers, dms, friendships },
          userId,
        );
        if (!user) continue;

        const key = `${userId}:${user.avatarUrl ?? ""}`;
        let avatar = avatars.current.get(key);
        if (avatar === undefined) {
          avatar = (await avatarPng(user)) ?? "";
          avatars.current.set(key, avatar);
        }

        list.push({
          id: userId,
          name: user.displayName,
          avatar,
          speaking: state.speaking,
          muted: state.muted,
          // «Не слышит» — отдельно от «молчит»: поверх игры это
          // особенно важно, потому что переспросить некому.
          deafened: state.deafened,
          // Кто показывает экран. В самом мессенджере это видно
          // по значку у канала, но поверх игры мессенджера не видно —
          // а вопрос «кто там показывает» возникает как раз в игре.
          screen: state.sharing,
          me: userId === me?.id,
          // Громкость и заглушение — наши личные, по сети не уходят.
          // В меню они нужны потому, что в разговоре вчетвером всегда
          // есть один тихий и один громкий, а правится это сейчас
          // только в самом мессенджере, то есть свернув игру.
          volume: prefs.userGain[userId] ?? 1,
          silenced: prefs.mutedUsers.includes(userId),
        });
      }

      if (cancelled) return;

      const shown = {
        people: list,
        channels,
        channelName: home?.channels.find((c) => c.id === channelId)?.name ?? "",
      };
      previous.current = shown;

      bridge.setOverlay?.({ ...base, ...shown, inCall: true, muted, deafened, sharing });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    prefs.overlayMode,
    prefs.overlayGames,
    prefs.overlayPos,
    prefs.overlayScale,
    prefs.overlayKey,
    prefs.userGain,
    prefs.mutedUsers,
    prefs.outputGain,
    channelId,
    members,
    known,
    serverMembers,
    dms,
    friendships,
    me,
    muted,
    deafened,
    sharing,
    connecting,
    server,
    servers,
  ]);

  // Уходя — гасим. Без этого закрытое окно мессенджера оставляло бы
  // окошко висеть поверх всего до перезапуска, а клавиша осталась бы
  // занятой.
  useEffect(() => {
    const bridge = desktop();
    if (!bridge?.setOverlay) return;
    return () =>
      bridge.setOverlay?.({
        inCall: false,
        hudMode: "never",
        games: [],
        people: [],
        channels: [],
      });
  }, []);
}

/**
 * Нажатия в меню оверлея.
 *
 * Отдельно от useOverlay: там состояние уходит наружу, здесь действия
 * приходят снаружи, и подписка не должна пересоздаваться каждый раз,
 * когда кто-то в разговоре открыл рот.
 */
export function useOverlayActions(): void {
  const { leave, toggleMute, toggleDeafen, toggleScreen, join } = useVoice();

  useEffect(() => {
    const bridge = desktop();
    if (!bridge?.onOverlayAction) return;

    return bridge.onOverlayAction((action) => {
      switch (action.type) {
        case "mute":
          toggleMute();
          break;
        case "deafen":
          toggleDeafen();
          break;
        case "leave":
          leave();
          break;
        case "screen":
          // В обе стороны. Начать — оболочка уже вывела окно вперёд,
          // здесь остаётся открыть выбор источника; прекратить —
          // выбирать нечего.
          void toggleScreen();
          break;
        case "join":
          if (typeof action.channelId === "string") void join(action.channelId);
          break;
        case "volume":
          if (typeof action.userId === "string" && typeof action.value === "number") {
            setUserVolume(action.userId, action.value);
          }
          break;
        case "master":
          if (typeof action.value === "number") setOutputGain(action.value);
          break;
        case "silence":
          if (typeof action.userId === "string") toggleUserMuted(action.userId);
          break;
        // Положение и размер окошка правятся там же, где их видно, —
        // в открытом меню. Сюда они приходят, чтобы попасть в настройки:
        // хранилище одно, и оболочка в него не пишет.
        case "move":
          if (typeof action.x === "number" && typeof action.y === "number") {
            setPreference("overlayPos", { x: action.x, y: action.y });
          }
          break;
        case "scale":
          if (typeof action.value === "number") setPreference("overlayScale", action.value);
          break;
        case "hudMode":
          if (action.mode === "always" || action.mode === "game" || action.mode === "never") {
            setPreference("overlayMode", action.mode);
          }
          break;
      }
    });
  }, [leave, toggleMute, toggleDeafen, toggleScreen, join]);
}
