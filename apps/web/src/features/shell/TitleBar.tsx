import { useEffect, useState, type CSSProperties } from "react";
import { Download } from "lucide-react";
import { useStore } from "@/lib/store";
import { desktop, isApp } from "@/lib/desktop";
import { PingIndicator } from "@/features/voice/PingIndicator";

/**
 * Своя шапка окна — только в приложении.
 *
 * Кнопки свернуть-развернуть-закрыть рисует Windows поверх неё: свои
 * ломают Snap Layouts (раскладки при наведении на «развернуть») и
 * перетаскивание окна к краю экрана. Нам остаётся левая часть полосы,
 * и в ней стоит то, чего в системном заголовке быть не может, —
 * состояние разговора.
 *
 * В браузере не рисуется вовсе: там свой заголовок у окна браузера,
 * и вторая полоса рядом с ним выглядела бы поломкой вёрстки.
 */

// app-region: drag — окно таскается за саму полосу. Без этого своя
// шапка означала бы окно, которое нельзя подвинуть.
const DRAG = { WebkitAppRegion: "drag" } as CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as CSSProperties;

export function TitleBar() {
  const voiceChannelId = useStore((s) => s.voiceChannelId);
  const sharing = useStore((s) => s.voiceSharing);

  if (!isApp()) return null;

  return (
    <div
      style={DRAG}
      onDoubleClick={() => desktop()?.window.toggleMaximize()}
      // Отступ справа — под кнопки Windows: они лежат поверх полосы,
      // и содержимое под ними стало бы недоступным.
      className="flex h-10 shrink-0 items-center gap-2 bg-sidebar pr-[150px] pl-3 select-none"
    >
      <span className="text-sm font-semibold text-bright">Мессенджер</span>

      {voiceChannelId && (
        <span style={NO_DRAG} className="ml-3 flex items-center gap-1.5 text-xs text-muted">
          <PingIndicator className="size-3.5" />
          <span>{sharing ? "показываю экран" : "в разговоре"}</span>
        </span>
      )}

      <UpdateButton />
    </div>
  );
}

/**
 * «Обновление готово» — в шапке окна, а не окном посреди экрана.
 *
 * Раньше о готовом обновлении сообщал вопрос «перезапустить сейчас?».
 * Он приходил когда попало — посреди разговора, посреди сообщения, —
 * и на него отвечали не глядя. Хуже того, ответ «перезапустить» иногда
 * не срабатывал: установщик не подхватывался, а окна уже закрыты, и
 * мессенджер оставался жить без окна.
 *
 * Кнопка в углу ждёт столько, сколько нужно, ничего не перекрывает
 * и нажимается тогда, когда человек сам готов.
 */
function UpdateButton() {
  const [ready, setReady] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const bridge = desktop();
    if (!bridge?.onUpdateReady) return;
    return bridge.onUpdateReady((version) => setReady(version));
  }, []);

  if (!ready) return null;

  return (
    <button
      style={NO_DRAG}
      onClick={() => {
        setBusy(true);
        desktop()?.installUpdate?.();
      }}
      title={`Версия ${ready} скачана. Нажмите, чтобы перезапустить и обновиться.`}
      className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-hover"
    >
      <Download className="size-3.5" />
      {busy ? "Перезапуск…" : "Обновление готово"}
    </button>
  );
}
