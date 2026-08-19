import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MonitorOff, MonitorUp, PhoneOff, Video, VideoOff } from "lucide-react";
import type { ReactNode } from "react";
import { describeChannel, useStore, type ChannelSource } from "@/lib/store";
import { canShareScreen } from "@/lib/voice";
import { CallTimer } from "./CallTimer";
import { PingIndicator } from "./PingIndicator";
import { useVoice } from "./useVoice";

/** Полоска активного разговора над панелью пользователя.
 *
 *  Живёт отдельно от списка каналов: разговор продолжается, даже
 *  когда человек ушёл читать другой канал или в личные сообщения,
 *  и способ выйти должен быть виден всегда. */
export function VoiceBar() {
  const voiceChannelId = useStore((s) => s.voiceChannelId);
  const servers = useStore((s) => s.servers);
  const dms = useStore((s) => s.dms);
  const me = useStore((s) => s.me);
  const members = useStore((s) => s.voiceMembers);
  const ping = useStore((s) => s.voicePing);
  const sharing = useStore((s) => s.voiceSharing);
  const videoOn = useStore((s) => s.voiceVideoOn);
  const { leave, toggleScreen, toggleVideo } = useVoice();

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
          {/* Раскладка как в дискорде, и не ради подражания.
              Микрофон с наушниками отсюда переехали в панель
              пользователя ниже: там они доступны всегда, а не только
              в разговоре, и шесть кнопок в один ряд в двести сорок
              точек сайдбара всё равно не помещались. Здесь осталось
              то, что относится именно к текущему разговору. */}
          <div className="flex items-center gap-2 px-2 pt-2">
            <PingIndicator className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-online">
              В разговоре
            </span>
            {/* Время закрывает пустоту между надписью и трубкой
                и заодно показывает, что связь держится. */}
            <CallTimer className="shrink-0 text-xs text-muted" />
            {/* Трубка тут всегда трубка. Просмотр чужого показа
                прекращают красной кнопкой в самом канале — там на неё
                и смотрят. Здесь же единственный выход из разговора,
                который виден из любого канала и из личных сообщений,
                и подменять его чем-то другим нельзя: пока смотришь,
                выйти стало бы неоткуда. */}
            <button
              onClick={leave}
              title="Выйти из разговора"
              aria-label="Выйти из разговора"
              className="shrink-0 rounded p-1 text-muted hover:bg-hover hover:text-danger"
            >
              <PhoneOff className="size-5" />
            </button>
          </div>

          <div className="truncate px-2 pb-2 text-xs text-muted">
            {channel?.name ?? "канал"} · {count}
            {/* Число рядом со значком, а не только в подсказке:
                наводить мышь, чтобы понять, почему собеседника
                рвёт, — это на одно действие больше, чем нужно. */}
            {ping !== null && ` · ${Math.round(ping)} мс`}
          </div>

          {/* Камера и экран рядом, в один ряд: обе кнопки про одно —
              «что от меня видят», и разносить их незачем. Подписи
              короткие, потому что на двести сорок точек сайдбара
              длинные не встанут. */}
          <div className="flex gap-1 px-2 pb-2">
            <ShareButton
              onClick={() => void toggleVideo()}
              active={videoOn}
              label={videoOn ? "Выключить камеру" : "Включить камеру"}
              icon={videoOn ? <VideoOff className="size-4" /> : <Video className="size-4" />}
              text="Камера"
            />
            {/* На телефоне показа экрана нет вовсе: getDisplayMedia там
                не существует, и кнопка могла бы только отказать. */}
            {canShareScreen() && (
              <ShareButton
                onClick={() => void toggleScreen()}
                active={sharing}
                label={sharing ? "Прекратить показ экрана" : "Показать экран"}
                icon={
                  sharing ? <MonitorOff className="size-4" /> : <MonitorUp className="size-4" />
                }
                text="Экран"
              />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Кнопка «что от меня видят»: камера или экран.
 *
 *  Одна форма на обе, потому что состояний у них тоже одинаково два
 *  и выглядеть по-разному они не должны — иначе включённая камера
 *  и включённый показ читались бы как разные вещи. */
function ShareButton({
  onClick,
  active,
  label,
  icon,
  text,
}: {
  onClick: () => void;
  active: boolean;
  label: string;
  icon: ReactNode;
  text: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-sm transition-colors duration-150 md:py-1.5 ${
        active
          ? "bg-online/15 text-online hover:bg-online/25"
          : "bg-raised text-body hover:bg-hover hover:text-bright"
      }`}
    >
      {icon}
      <span className="truncate">{text}</span>
    </button>
  );
}
