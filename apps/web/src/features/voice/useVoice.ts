import { useCallback } from "react";
import { useStore } from "@/lib/store";
import { getSocket } from "@/lib/socket";
import { currentSession, startVoice, stopVoice } from "@/lib/voice";

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
    store.setVoiceMuted(false);

    // Себя из списка убираем сразу, не дожидаясь эха с сервера.
    // Эхо придёт и повторно ничего не сломает, но кнопка «выйти»
    // должна срабатывать мгновенно, а не через круг по сети.
    if (channelId && meId) store.voicePeerLeft(channelId, meId);
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
          onSpeaking: (userId, level) =>
            useStore.getState().setVoiceSpeaking(userId, level > 0.06),
        });

        const ok = await socket.emitWithAck("voice:join", { channelId });
        if (!ok) {
          stopVoice();
          return;
        }

        store.setVoiceChannel(channelId);

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
    getSocket()?.emit("voice:state", { muted });
  }, []);

  return { join, leave, toggleMute };
}
