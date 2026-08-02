import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Mic, MicOff, PhoneOff, Signal } from "lucide-react";
import { describeChannel, useStore, type ChannelSource } from "@/lib/store";
import { useVoice } from "./useVoice";

/** Полоска активного разговора над панелью пользователя.
 *
 *  Живёт отдельно от списка каналов: разговор продолжается, даже
 *  когда человек ушёл читать другой канал или в личные сообщения,
 *  и способ выйти должен быть виден всегда. */
export function VoiceBar() {
  const voiceChannelId = useStore((s) => s.voiceChannelId);
  const muted = useStore((s) => s.voiceMuted);
  const servers = useStore((s) => s.servers);
  const dms = useStore((s) => s.dms);
  const me = useStore((s) => s.me);
  const members = useStore((s) => s.voiceMembers);
  const { leave, toggleMute } = useVoice();

  const channel = useMemo(() => {
    if (!voiceChannelId) return undefined;
    const source: ChannelSource = { servers, dms, me };
    return describeChannel(source, voiceChannelId);
  }, [voiceChannelId, servers, dms, me]);

  const count = voiceChannelId ? (members.get(voiceChannelId)?.size ?? 0) : 0;

  return (
    <AnimatePresence>
      {voiceChannelId && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="shrink-0 overflow-hidden bg-panel"
        >
          <div className="flex items-center gap-2 px-2 py-2">
            <Signal className="size-4 shrink-0 text-online" />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-semibold text-online">В разговоре</div>
              <div className="truncate text-xs text-muted">
                {channel?.name ?? "канал"} · {count}
              </div>
            </div>

            <button
              onClick={toggleMute}
              title={muted ? "Включить микрофон" : "Выключить микрофон"}
              aria-label={muted ? "Включить микрофон" : "Выключить микрофон"}
              aria-pressed={muted}
              className={`rounded p-1.5 hover:bg-hover ${muted ? "text-danger" : "text-muted hover:text-bright"}`}
            >
              {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
            </button>

            <button
              onClick={leave}
              title="Выйти из разговора"
              aria-label="Выйти из разговора"
              className="rounded p-1.5 text-muted hover:bg-hover hover:text-danger"
            >
              <PhoneOff className="size-5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
