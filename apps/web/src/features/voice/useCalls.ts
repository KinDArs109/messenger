import { useCallback, useEffect } from "react";
import type { PublicUser } from "@messenger/shared";
import { getSocket } from "@/lib/socket";
import { useStore } from "@/lib/store";
import { startRinging, stopRinging } from "@/lib/sounds";
import { notifyCall } from "@/lib/useDesktop";
import { useVoice } from "./useVoice";

/**
 * Звонки в личной переписке.
 *
 * Разговор здесь обычный — тот же голосовой канал, только каналом
 * служит сама переписка. Новое только одно: вызов. Раньше «поговорить
 * вдвоём» означало, что один заходит в канал и ждёт, пока второй
 * случайно заметит; теперь у второго звонит телефон.
 *
 * Состояние звонка живёт в общем хранилище, а не здесь: окно звонка
 * рисуется поверх всего приложения, а нажать «ответить» надо из любого
 * места.
 */
/**
 * Подписка на события звонка. Строго в одном месте — в App.
 *
 * Разделено с кнопками намеренно: кнопки нужны и в шапке переписки,
 * и в самом окне звонка, а подписка, повешенная дважды, звонила бы
 * дважды и слала бы два уведомления на один звонок.
 */
export function useCallEvents(): void {
  const { join } = useVoice();
  /** Соединение поднимается отдельным действием, и до него сокета
   *  просто нет. Без этой зависимости подписка пыталась повеситься
   *  на пустоту один раз при запуске — и больше не пыталась никогда.
   *  Звонящий видел «Звоню…», а у собеседника не происходило ничего. */
  const connected = useStore((s) => s.connected);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !connected) return;

    const onRing = ({ channelId, from }: { channelId: string; from: PublicUser }) => {
      const store = useStore.getState();
      // Уже разговариваем в этом же канале — звонить незачем: человек
      // просто нажал «позвонить», не заметив, что мы уже вместе.
      if (store.voiceChannelId === channelId) return;

      store.setCall({ channelId, peer: from, incoming: true });
      startRinging("ring");
      notifyCall(from.displayName, channelId);
    };

    const onState = ({
      channelId,
      state,
    }: {
      channelId: string;
      state: "accepted" | "declined" | "cancelled" | "missed" | "busy" | "offline";
    }) => {
      const store = useStore.getState();
      stopRinging();

      if (state === "accepted") {
        store.setCall(null);
        // Оба заходят в один и тот же канал — дальше работает обычный
        // голос, который уже умеет всё остальное.
        store.selectHome();
        store.selectChannel(channelId);
        void join(channelId);
        return;
      }

      // Остальное — отказ той или иной степени вежливости. Показываем
      // причину на пару секунд и убираем окно: держать на экране
      // «не ответил» до нажатия незачем.
      store.setCall({ ...(store.call ?? { channelId, peer: null, incoming: false }), state });
      setTimeout(() => {
        const current = useStore.getState().call;
        if (current?.channelId === channelId && current.state) useStore.getState().setCall(null);
      }, 2500);
    };

    socket.on("call:ring", onRing);
    socket.on("call:state", onState);
    return () => {
      socket.off("call:ring", onRing);
      socket.off("call:state", onState);
      stopRinging();
    };
  }, [join, connected]);
}

/** Кнопки звонка. Ничего не слушают — только отправляют. */
export function useCalls(): {
  call: (channelId: string) => void;
  accept: () => void;
  decline: () => void;
  cancel: () => void;
} {
  const call = useCallback((channelId: string) => {
    const socket = getSocket();
    const store = useStore.getState();
    const channel = store.dms.find((dm) => dm.id === channelId);
    const peer = channel?.participants.find((p) => p.id !== store.me?.id) ?? null;

    store.setCall({ channelId, peer, incoming: false });
    startRinging("callout");

    socket?.emit("call:invite", { channelId }, (ok, reason) => {
      if (ok) return;
      stopRinging();
      useStore.getState().setCall({ channelId, peer, incoming: false, error: reason });
      setTimeout(() => {
        const current = useStore.getState().call;
        if (current?.channelId === channelId && current.error) useStore.getState().setCall(null);
      }, 2500);
    });
  }, []);

  const accept = useCallback(() => {
    const store = useStore.getState();
    const call = store.call;
    if (!call) return;
    stopRinging();
    getSocket()?.emit("call:accept", { channelId: call.channelId });
  }, []);

  const decline = useCallback(() => {
    const store = useStore.getState();
    const call = store.call;
    if (!call) return;
    stopRinging();
    store.setCall(null);
    getSocket()?.emit("call:decline", { channelId: call.channelId });
  }, []);

  const cancel = useCallback(() => {
    const store = useStore.getState();
    const call = store.call;
    if (!call) return;
    stopRinging();
    store.setCall(null);
    getSocket()?.emit("call:cancel", { channelId: call.channelId });
  }, []);

  return { call, accept, decline, cancel };
}
