import { useCallback } from "react";
import { useStore } from "@/lib/store";
import { getPreferences, setPreference } from "@/lib/preferences";
import { getSocket } from "@/lib/socket";
import { playSound } from "@/lib/sounds";
import { currentSession, startVoice, stopVoice, type ShareKind } from "@/lib/voice";
import { micOnDeafenChange } from "./deafen";
import type { Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@messenger/shared";

/** Объявить свой поток остальным.
 *
 *  Событий два, а не одно с полем «вид»: у экрана и камеры разные
 *  имена полей в протоколе, и типы событий это проверяют. Развилка
 *  на две строки здесь дешевле, чем общее событие, в котором нельзя
 *  выразить, что именно пришло. */
function emitShare(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  kind: ShareKind,
  streamId: string | null,
): void {
  if (kind === "screen") socket?.emit("voice:screen", { screenId: streamId });
  else socket?.emit("voice:video", { videoId: streamId });
}

/** Вход и выход из голосового канала.
 *
 *  Разведено с самим WebRTC намеренно: там сетевая механика, здесь —
 *  порядок действий и состояние интерфейса. Смешивать их в одном
 *  файле означает, что любая правка кнопки задевает соединение. */
export function useVoice() {
  const meId = useStore((s) => s.me?.id);

  const leave = useCallback(() => {
    const store = useStore.getState();
    const channelId = store.voiceChannelId;

    getSocket()?.emit("voice:leave");
    stopVoice();
    store.setVoiceChannel(null);
    // Микрофон и наушники не трогаем: выключенный микрофон — это
    // решение человека, а не свойство разговора. Вышел и зашёл
    // в другой канал — остаётся выключенным, как в дискорде.
    store.setVoicePing(null);
    store.setVoiceSharing(false);
    store.setVoiceVideoOn(false);
    for (const userId of store.voiceScreens.keys()) store.setVoiceScreen(userId, null);
    for (const userId of store.voiceVideos.keys()) store.setVoiceVideo(userId, null);

    // Себя из списка убираем сразу, не дожидаясь эха с сервера.
    // Эхо придёт и повторно ничего не сломает, но кнопка «выйти»
    // должна срабатывать мгновенно, а не через круг по сети.
    if (channelId && meId) store.voicePeerLeft(channelId, meId);

    // Свой выход звучит так же, как чужой: это подтверждение, что
    // разговор действительно закрылся, а не просто пропала кнопка.
    if (channelId) playSound("leave");
  }, [meId]);

  const join = useCallback(
    async (channelId: string) => {
      const socket = getSocket();
      if (!socket || !meId) return;

      const store = useStore.getState();
      if (store.voiceChannelId === channelId) return;
      if (store.voiceChannelId) leave();

      store.setVoiceConnecting(true);
      try {
        // Микрофон спрашиваем до входа в канал: отказ в доступе
        // не должен оставлять человека в списке говорящих немым.
        const session = await startVoice(channelId, meId, {
          onPeerState: () => undefined,
          onSpeaking: (userId, speaking) => useStore.getState().setVoiceSpeaking(userId, speaking),
          onQuality: (rtt, toServer, viaRelay) =>
            useStore.getState().setVoicePing(rtt, toServer, viaRelay),
          onScreen: (userId, screen) => useStore.getState().setVoiceScreen(userId, screen),
          onScreenSound: (userId, есть) =>
            useStore.getState().setVoiceScreenSound(userId, есть),
          onVideo: (userId, video) => useStore.getState().setVoiceVideo(userId, video),
          onScreenStats: (как) => useStore.getState().setScreenStats(как),
          onScreenScaled: (height) => useStore.getState().setScreenScaled(height),
        });

        const ok = await socket.emitWithAck("voice:join", { channelId });
        if (!ok) {
          stopVoice();
          return;
        }

        store.setVoiceChannel(channelId);
        playSound("join");

        // Теперь сервер знает, что мы здесь, — можно спросить, что уже
        // показывают. Раньше этого момента ответ был бы «ничего».
        void session.подхватить();

        // Микрофон и наушники могли быть выключены заранее, ещё
        // до входа. Переносим это состояние в новый разговор, иначе
        // человек, специально выключивший микрофон, ворвался бы
        // в канал со звуком.
        const { voiceMuted, voiceDeafened } = useStore.getState();
        if (voiceDeafened) session.setDeafened(true);
        if (voiceMuted || voiceDeafened) {
          if (voiceMuted) session.setMuted(true);
          socket.emit("voice:state", { muted: voiceMuted, deafened: voiceDeafened });
        }

        // Первым предлагает соединиться тот, кто вошёл позже: он уже
        // знает состав, а сидящие в канале о нём — ещё нет.
        const peers = useStore.getState().voiceMembers.get(channelId);
        for (const userId of peers?.keys() ?? []) {
          if (userId !== meId) session.connectTo(userId, true);
        }
      } catch (error) {
        console.error("Не удалось подключить микрофон:", error);
        stopVoice();
      } finally {
        useStore.getState().setVoiceConnecting(false);
      }
    },
    [meId, leave],
  );

  const toggleMute = useCallback(() => {
    const store = useStore.getState();
    const muted = !store.voiceMuted;
    currentSession()?.setMuted(muted);
    store.setVoiceMuted(muted);
    // Взялся за микрофон сам — дальше он его и решает. Признак
    // «выключен вместе со звуком» снимаем, иначе включение звука
    // перебило бы только что принятое решение.
    store.setVoiceMutedByDeafen(false);
    getSocket()?.emit("voice:state", { muted, deafened: store.voiceDeafened });
  }, []);

  /**
   * Включить или выключить показ — экрана или камеры.
   *
   * Один порядок действий на оба: объявляем имя потока раньше, чем
   * отдаём дорожки. Сообщение и видео идут разными путями, и собеседник
   * должен успеть узнать имя до того, как придут кадры, — иначе их
   * будет некуда деть.
   */
  const toggleShare = useCallback(
    async (kind: ShareKind) => {
      const session = currentSession();
      const socket = getSocket();
      if (!session) return;

      const store = useStore.getState();
      const off = kind === "screen" ? store.setVoiceSharing : store.setVoiceVideoOn;
      const put = kind === "screen" ? store.setVoiceScreen : store.setVoiceVideo;

      if (session.isSharing(kind)) {
        emitShare(socket, kind, null);
        await session.stopShare(kind);
        off(false);
        if (meId) put(meId, null);
        // Камера включается и выключается молча: с ней сидят весь
        // разговор, и сигнал звучал бы к месту ровно один раз.
        if (kind === "screen") playSound("screenOff");
        return;
      }

      const streamId = kind === "screen" ? await session.startScreen() : await session.startVideo();
      // null — человек закрыл окно выбора или не дал доступ к камере.
      // Это не ошибка, и говорить о ней не надо: он сам передумал.
      if (!streamId) return;

      emitShare(socket, kind, streamId);
      session.publish(kind);
      off(true);
      if (kind === "screen") playSound("screenOn");
      // Своё кладём туда же, где чужое: показывающий должен видеть,
      // что именно ушло собеседникам.
      if (meId) put(meId, session.ownStream(kind));
    },
    [meId],
  );

  const toggleScreen = useCallback(() => toggleShare("screen"), [toggleShare]);
  const toggleVideo = useCallback(() => toggleShare("video"), [toggleShare]);

  /** Отключить звук целиком — и вернуть его вместе с микрофоном.
   *  Само правило и его причины — в deafen.ts; здесь только применение. */
  const toggleDeafen = useCallback(() => {
    const store = useStore.getState();
    const deafened = !store.voiceDeafened;
    const session = currentSession();

    session?.setDeafened(deafened);
    store.setVoiceDeafened(deafened);

    const mic = micOnDeafenChange(deafened, store.voiceMuted, store.voiceMutedByDeafen);
    if (mic) {
      session?.setMuted(mic.muted);
      store.setVoiceMuted(mic.muted);
      store.setVoiceMutedByDeafen(mic.mutedByDeafen);
    }

    // Сообщаем всегда, а не только когда заодно поменялся микрофон.
    // Раньше выход был выше по коду — и собеседники не узнавали, что
    // человек выключил звук: у них он оставался просто с микрофоном,
    // и они продолжали говорить с тем, кто их не слышит.
    getSocket()?.emit("voice:state", {
      muted: mic ? mic.muted : store.voiceMuted,
      deafened,
    });
  }, []);

  /** Передняя камера ↔ задняя. На компьютере не вызывается: там
   *  показывают экран, и переворачивать нечего. */
  const flipCamera = useCallback(async () => {
    await currentSession()?.flipCamera();
  }, []);

  return { join, leave, toggleMute, toggleScreen, toggleVideo, toggleDeafen, flipCamera };
}

/**
 * Согласиться смотреть чужой показ — или перестать.
 *
 * Одно место на весь мессенджер, потому что согласие решает два
 * вопроса сразу: показывать ли картинку и пускать ли звук. Раньше
 * второго вопроса не было вовсе — звук чужой игры начинал играть,
 * стоило зайти в канал, без единого нажатия.
 */
export function watchScreen(userId: string | null): void {
  useStore.getState().setWatchingScreen(userId);
  currentSession()?.смотреть(userId);
}

/** Громкость собеседника — только для себя. По сети не уходит ничего:
 *  это наши наушники и наше дело. */
export function setUserVolume(userId: string, gain: number): void {
  const { userGain } = getPreferences();
  setPreference("userGain", { ...userGain, [userId]: gain });
  currentSession()?.applyVolumes();
}

/** Громкость чужого показа — отдельно от его голоса. */
export function setScreenVolume(userId: string, gain: number): void {
  const { screenGain } = getPreferences();
  setPreference("screenGain", { ...screenGain, [userId]: gain });
  currentSession()?.applyVolumes();
}

export function toggleUserMuted(userId: string): void {
  const { mutedUsers } = getPreferences();
  const next = mutedUsers.includes(userId)
    ? mutedUsers.filter((id) => id !== userId)
    : [...mutedUsers, userId];
  setPreference("mutedUsers", next);
  currentSession()?.applyVolumes();
}

/** Общая громкость разговора и громкость своего микрофона. */
export function setOutputGain(gain: number): void {
  setPreference("outputGain", gain);
  currentSession()?.applyVolumes();
}

export function setMicGain(gain: number): void {
  setPreference("micGain", gain);
  currentSession()?.applyMicGain();
}

/** Смена устройств на ходу, без выхода из разговора — как в дискорде. */
export function applySpeakerChange(): void {
  void currentSession()?.setSpeaker();
}

export function applyMicChange(): void {
  void currentSession()?.setMicrophone();
}

/** Автоусиление включили или выключили — на живом разговоре, без
 *  перезахвата микрофона: узел стоит в цепочке всегда, меняются
 *  только его настройки. */
export function applyAutoGain(): void {
  currentSession()?.syncAutoGain();
}
