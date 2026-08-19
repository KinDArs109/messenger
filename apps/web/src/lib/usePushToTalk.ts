import { useEffect } from "react";
import { desktop } from "./desktop";
import { usePreferences } from "./preferences";
import { getSocket } from "./socket";
import { useStore } from "./store";
import { currentSession } from "./voice";

/**
 * Рация.
 *
 * Единственная возможность, которую браузер не даст никогда: клавиши
 * вне своего окна он не видит вовсе. Ради неё приложение и ставят —
 * говорить в игре, не переключаясь на мессенджер.
 *
 * Здесь только связь клавиши с микрофоном; сама клавиша перехватывается
 * в оболочке (см. apps/desktop/main.cjs).
 */
export function usePushToTalk(): void {
  const { prefs } = usePreferences();
  const voiceChannelId = useStore((s) => s.voiceChannelId);

  // Клавишу занимаем только пока сидим в разговоре: держать чужую
  // F9 занятой всё время, что открыт мессенджер, — невежливо
  // по отношению к остальным программам.
  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;

    const mode = voiceChannelId ? prefs.pttMode : "off";
    void bridge.setPushToTalk({ mode, accelerator: prefs.pttKey || null });

    return () => {
      void bridge.setPushToTalk({ mode: "off", accelerator: null });
    };
  }, [prefs.pttMode, prefs.pttKey, voiceChannelId]);

  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;

    return bridge.onPushToTalk((active) => {
      const store = useStore.getState();
      if (!store.voiceChannelId) return;

      // В интерфейсе это тот же выключенный микрофон, что и по кнопке:
      // два разных значения «молчу» развели бы состояние надвое.
      const muted = !active;
      currentSession()?.setMuted(muted);
      store.setVoiceMuted(muted);
      // Микрофоном теперь распоряжается клавиша. Признак «выключен
      // вместе со звуком» снимаем: иначе включение звука открыло бы
      // микрофон посреди рации, и он остался бы открытым.
      store.setVoiceMutedByDeafen(false);
      getSocket()?.emit("voice:state", { muted });
    });
  }, []);

  // Режим включили, сидя в разговоре, — микрофон надо сразу закрыть,
  // иначе рация начнёт работать только со второго нажатия.
  useEffect(() => {
    if (!desktop() || !voiceChannelId) return;
    if (prefs.pttMode === "off") return;

    const store = useStore.getState();
    if (store.voiceMuted) return;
    currentSession()?.setMuted(true);
    store.setVoiceMuted(true);
    store.setVoiceMutedByDeafen(false);
    getSocket()?.emit("voice:state", { muted: true });
  }, [prefs.pttMode, voiceChannelId]);
}
