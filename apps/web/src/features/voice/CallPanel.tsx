import { motion } from "motion/react";
import {
  HeadphoneOff,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  MonitorX,
  PhoneOff,
  Video,
  VideoOff,
} from "lucide-react";
import { usePeople, useStore } from "@/lib/store";
import { canShareScreen } from "@/lib/voice";
import { Avatar } from "@/components/Avatar";
import { CallTimer } from "./CallTimer";
import { PingIndicator } from "./PingIndicator";
import { useVoice, watchScreen } from "./useVoice";
import { useCalls } from "./useCalls";
import { Screen } from "./ScreenView";

/**
 * Разговор в личной переписке — полосой сверху, а не вместо переписки.
 *
 * Раньше звонок забирал весь экран: собеседник во весь рост, а сама
 * переписка исчезала. Так не звонят: во время разговора кидают ссылки,
 * смотрят, о чём договаривались вчера, и дописывают то, что не
 * выговаривается. Поэтому переписка остаётся на месте, а звонок живёт
 * над ней — как в дискорде.
 *
 * Здесь только то, что относится к самому звонку: кто участвует,
 * сколько он идёт и чем управлять. Всё остальное — списки, каналы,
 * настройки — в звонке не нужно, и места им тут нет.
 */
/** Чем кончился звонок — человеческими словами. Те же слова, что были
 *  в окне звонка: набор причин от переезда в полосу не изменился. */
const ENDINGS: Record<string, string> = {
  declined: "Отклонил",
  cancelled: "Звонок отменён",
  missed: "Не ответил",
  busy: "Занято",
  offline: "Не в сети",
  accepted: "Соединяю…",
};

export function CallPanel({ channelId }: { channelId: string }) {
  const members = useStore((s) => s.voiceMembers.get(channelId));
  const personOf = usePeople();
  const muted = useStore((s) => s.voiceMuted);
  const deafened = useStore((s) => s.voiceDeafened);
  const sharing = useStore((s) => s.voiceSharing);
  const videoOn = useStore((s) => s.voiceVideoOn);
  const screens = useStore((s) => s.voiceScreens);
  const watching = useStore((s) => s.watchingScreen);
  const { leave, toggleMute, toggleScreen, toggleVideo } = useVoice();
  /** Смотрим показ собеседника — и он всё ещё идёт. */
  const watchingNow = Boolean(watching && screens.has(watching));

  /** Исходящий звонок по этой переписке — ещё не разговор, но уже
   *  не пустота: гудки идут, и отменить их надо там же, где потом
   *  будет трубка. */
  const call = useStore((s) => s.call);
  const { cancel } = useCalls();
  const ringing = Boolean(call && !call.incoming && call.channelId === channelId);
  const ending = call?.state ? ENDINGS[call.state] : null;

  // Кого показываем: всех, кто сейчас в этом разговоре. Имена берём
  // из общей памяти — участник может быть и в списке сервера, и только
  // в собеседниках переписки, и вообще нигде, кроме прошлого сеанса.
  const participants = [...(members?.entries() ?? [])].map(([userId, state]) => ({
    userId,
    state,
    user: personOf(userId),
  }));

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="shrink-0 overflow-hidden border-b border-line bg-panel"
    >
      <div className="flex flex-col items-center gap-3 px-4 py-4">
        {/* Одни аватары, без подписей.
            Имена тут не нужны: в личной переписке собеседник ровно
            один, и его имя уже стоит в шапке. Подписи же лезли в две
            строки и обрезались многоточием — «Проверка Вто…» рядом
            с «Проверка Пер…» читается хуже, чем ничего. Кто есть кто,
            если понадобится, скажет подсказка при наведении.
            Говорящий обведён — это единственное, что нужно понять
            взглядом, не читая. */}
        {/* Гудки. Состав канала в этот момент пуст — показываем того,
            кому звоним, и говорим, что происходит. */}
        {ringing && (
          <>
            <div className="animate-pulse">
              <Avatar
                user={call?.peer ?? { id: channelId, displayName: "?" }}
                size={64}
              />
            </div>
            <p className="text-sm text-muted">{call?.error ?? ending ?? "Звоню…"}</p>
          </>
        )}

        <ul className="flex items-center justify-center gap-3">
          {participants.map(({ userId, state, user }) => (
            <li key={userId} className="relative" title={user?.displayName ?? "участник"}>
              <span
                className={
                  state.speaking
                    ? "block rounded-full ring-2 ring-online transition-shadow"
                    : "block rounded-full ring-2 ring-transparent transition-shadow"
                }
              >
                <Avatar user={user ?? { id: userId, displayName: "?" }} size={64} />
              </span>
              {/* Выключенный микрофон — значком на самом аватаре,
                  как в дискорде: строка под ним ради одного значка
                  не нужна. Выключенный звук рисуется вместо него
                  и главнее его: с человеком, который не слышит,
                  бесполезно говорить, даже если микрофон у него
                  открыт. */}
              {(state.deafened || state.muted) && (
                <span
                  title={state.deafened ? "Звук выключен — не слышит" : "Микрофон выключен"}
                  className="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full border-2 border-panel bg-danger text-white"
                >
                  {state.deafened ? (
                    <HeadphoneOff className="size-2.5" />
                  ) : (
                    <MicOff className="size-2.5" />
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>

        {!ringing && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <PingIndicator className="size-3.5" />
            <CallTimer />
          </div>
        )}

        {/* Кнопки одним рядом и крупные: в разговоре по ним попадают
            не глядя, а на телефоне — пальцем. Пока идут гудки, кнопка
            одна: отменить. Выключать микрофон, которого ещё никто
            не слышит, незачем. */}
        <div className="flex items-center gap-2">
          {!ringing && (
            <>
              <Round
                onClick={() => void toggleMute()}
                active={muted}
                label={muted ? "Включить микрофон" : "Выключить микрофон"}
              >
                {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
              </Round>

              <Round
                onClick={() => void toggleVideo()}
                active={videoOn}
                label={videoOn ? "Выключить камеру" : "Включить камеру"}
              >
                {videoOn ? <VideoOff className="size-5" /> : <Video className="size-5" />}
              </Round>

              {/* Показ экрана есть не везде: с телефона его не отдать. */}
              {canShareScreen() && (
                <Round
                  onClick={() => void toggleScreen()}
                  active={sharing}
                  label={sharing ? "Прекратить показ" : "Показать экран"}
                >
                  {sharing ? <MonitorOff className="size-5" /> : <Monitor className="size-5" />}
                </Round>
              )}
            </>
          )}

          {/* Трубка красная и стоит с краю: её нажимают в конце
              разговора, и промахиваться по ней соседними кнопками
              нельзя ни в ту, ни в другую сторону.
              Пока смотришь показ собеседника, она прекращает просмотр,
              а не разговор, — так же, как в голосовом канале. Выйти
              при этом можно из полоски разговора слева. */}
          <button
            onClick={ringing ? cancel : watchingNow ? () => watchScreen(null) : leave}
            title={
              ringing ? "Отменить звонок" : watchingNow ? "Прекратить просмотр" : "Завершить звонок"
            }
            aria-label={
              ringing
                ? "Отменить звонок"
                : watchingNow
                  ? "Прекратить просмотр"
                  : "Выйти из разговора"
            }
            className={
              ringing
                ? "flex size-11 items-center justify-center rounded-full bg-danger text-white hover:brightness-110"
                : "ml-2 flex size-11 items-center justify-center rounded-full bg-danger text-white hover:brightness-110"
            }
          >
            {watchingNow ? <MonitorX className="size-5" /> : <PhoneOff className="size-5" />}
          </button>
        </div>

        {deafened && <p className="text-xs text-idle">Звук выключен — вы никого не слышите</p>}

        {/* Показ экрана — здесь же, под кнопками. Отдельного места
            для него в личной переписке нет, а смотреть на чужой экран
            и переписываться одновременно — обычное дело.
            Сам показ не разворачивается: пока не нажмёшь «смотреть»,
            это просто строчка. */}
        {screens.size > 0 && (
          <div className="w-full max-w-[760px] space-y-2">
            {[...screens].map(([userId, stream]) => (
              <Screen key={userId} userId={userId} stream={stream} />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** Круглая кнопка разговора. Включённое состояние — заливкой, а не
 *  цветом значка: в тёмном интерфейсе разницу оттенка значка
 *  не видно. */
function Round({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void;
  active: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={
        active
          ? "flex size-11 items-center justify-center rounded-full bg-bright text-rail"
          : "flex size-11 items-center justify-center rounded-full bg-raised text-body hover:bg-hover hover:text-bright"
      }
    >
      {children}
    </button>
  );
}
