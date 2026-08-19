import { HeadphoneOff, Headphones, Mic, MicOff } from "lucide-react";
import { useStore } from "@/lib/store";
import { MicPopover, OutputPopover } from "./SoundPopover";
import { useVoice } from "./useVoice";

/**
 * Свой микрофон и наушники — в панели пользователя, а не в полоске
 * разговора.
 *
 * Так они доступны всегда. Выключить микрофон заранее, до входа в
 * разговор, — обычное дело: зашёл в комнату, где уже говорят, и не
 * хочешь ворваться со звуком своей клавиатуры. Выставленное здесь
 * применится к разговору при входе.
 */
export function SelfAudioControls() {
  const muted = useStore((s) => s.voiceMuted);
  const deafened = useStore((s) => s.voiceDeafened);
  const { toggleMute, toggleDeafen } = useVoice();

  return (
    <>
      <button
        onClick={toggleMute}
        title={muted ? "Включить микрофон" : "Выключить микрофон"}
        aria-label={muted ? "Включить микрофон" : "Выключить микрофон"}
        aria-pressed={muted}
        className={`shrink-0 rounded p-2 hover:bg-hover md:p-1 ${
          muted ? "text-danger" : "text-muted hover:text-bright"
        }`}
      >
        {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
      </button>
      <MicPopover />

      <button
        onClick={toggleDeafen}
        title={deafened ? "Включить звук" : "Отключить звук"}
        aria-label={deafened ? "Включить звук" : "Отключить звук"}
        aria-pressed={deafened}
        className={`shrink-0 rounded p-2 hover:bg-hover md:p-1 ${
          deafened ? "text-danger" : "text-muted hover:text-bright"
        }`}
      >
        {deafened ? <HeadphoneOff className="size-5" /> : <Headphones className="size-5" />}
      </button>
      <OutputPopover />
    </>
  );
}
