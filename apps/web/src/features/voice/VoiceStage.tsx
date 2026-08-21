import { useEffect, useRef, useState } from "react";
import {
  HeadphoneOff,
  Headphones,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  MonitorX,
  PhoneOff,
  SwitchCamera,
  Video,
  VideoOff,
  VolumeX,
} from "lucide-react";
import { usePeople, useStore } from "@/lib/store";
import { usePreferences } from "@/lib/preferences";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { useLongPress, type MenuPoint } from "@/lib/useLongPress";
import { useWakeLock } from "@/lib/useWakeLock";
import { Screen } from "./ScreenView";
import { CallTimer } from "./CallTimer";
import { PingIndicator } from "./PingIndicator";
import { MicPopover, OutputPopover } from "./SoundPopover";
import { UserVolumeMenu } from "./UserVolumeMenu";
import { useVoice } from "./useVoice";
import { canShareScreen, hasTwoCameras } from "@/lib/voice";

/**
 * Голосовой канал, открытый в основной части окна.
 *
 * До этого клик по голосовому каналу только подключал, а смотреть было
 * не на что: чужой экран показывался над лентой текстового канала,
 * а свой не показывался вовсе — и понять, что именно ушло собеседникам,
 * было нельзя.
 */
export function VoiceStage({ channelId }: { channelId: string }) {
  const members = useStore((s) => s.voiceMembers.get(channelId));
  const personOf = usePeople();
  const me = useStore((s) => s.me);
  const screens = useStore((s) => s.voiceScreens);
  const videos = useStore((s) => s.voiceVideos);
  const here = useStore((s) => s.voiceChannelId) === channelId;
  const muted = useStore((s) => s.voiceMuted);
  const sharing = useStore((s) => s.voiceSharing);
  const videoOn = useStore((s) => s.voiceVideoOn);
  const deafened = useStore((s) => s.voiceDeafened);
  const ping = useStore((s) => s.voicePing);
  const watching = useStore((s) => s.watchingScreen);
  const stopWatching = useStore((s) => s.setWatchingScreen);
  const { prefs } = usePreferences();
  const [menu, setMenu] = useState<{
    userId: string;
    name: string;
    x: number;
    y: number;
  } | null>(null);
  const { join, leave, toggleMute, toggleScreen, toggleVideo, toggleDeafen, flipCamera } =
    useVoice();

  // Свойства устройства, а не состояния разговора: считаем при
  // отрисовке и нигде не храним.
  const screenable = canShareScreen();
  const flippable = hasTwoCameras();

  const list = [...(members ?? [])];
  // Демонстрации показываем только когда сами в этом канале: чужой
  // экран приходит по прямому соединению, а его нет, пока не вошёл.
  const shown = here ? [...screens] : [];
  /** Смотрим чужой показ прямо сейчас — и он всё ещё идёт.
   *  Второе важно: показывающий может закончить в любую секунду,
   *  и кнопка «прекратить просмотр» осталась бы висеть над пустотой. */
  const watchingNow = Boolean(watching && screens.has(watching));

  // Пока идёт показ, на экран смотрят, не касаясь его, — и телефон,
  // который считает бездействие касаниями, гасит его через минуту.
  // Ради одного разговора экран не держим: звук идёт и с погашенным.
  useWakeLock(shown.length > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-chat">
      <div className="min-h-0 flex-1 overflow-y-auto p-2 md:p-4">
        {/* min-h-full + justify-center: пока участников мало, всё стоит
            посреди пустого места, а когда их станет много — начинает
            прокручиваться сверху вниз, без обрезания. */}
        <div className="flex min-h-full flex-col justify-center gap-4">
          {shown.length > 0 && (
            <div className={cn("grid gap-3", shown.length > 1 ? "lg:grid-cols-2" : "")}>
              {shown.map(([userId, stream]) => (
                <Screen key={userId} userId={userId} stream={stream} />
              ))}
            </div>
          )}

          {list.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 text-center">
              <Headphones className="size-12 text-faint" />
              <p className="text-muted">Здесь пока никого нет</p>
            </div>
          ) : (
            // Ширина плитки постоянная, а по центру ставится вся
            // группа целиком. Плитки, растягивающиеся на свободное
            // место, выглядели бы по-разному при одном и двух
            // участниках — а это одно и то же место.
            <ul className="flex flex-wrap items-start justify-center gap-3">
              {list.map(([userId, state]) => {
                const user = personOf(userId);
                const name = user?.displayName ?? "Участник";

                return (
                  <Tile
                    key={userId}
                    user={user}
                    name={name}
                    state={state}
                    // Своё изображение показываем только когда сами
                    // в этом канале: чужие кадры приходят по прямому
                    // соединению, а его нет, пока не вошёл.
                    video={here ? (videos.get(userId) ?? null) : null}
                    own={userId === me?.id}
                    silenced={prefs.mutedUsers.includes(userId)}
                    // Своя громкость нам не нужна: свой голос мы не слышим.
                    onMenu={
                      userId === me?.id
                        ? undefined
                        : (point) => setMenu({ userId, name, x: point.x, y: point.y })
                    }
                  />
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <ScreenTrouble />

      {/* Управление внизу — как в полоске разговора, но крупнее:
          здесь под него есть место, и целиться в мелкие значки
          посреди большого пустого экрана незачем.

          На телефоне встаёт в два ряда: пять круглых кнопок и строка
          «пинг · время» в одну линию не помещаются в триста семьдесят
          точек, и что-нибудь одно уезжало бы за край. */}
      <div className="flex shrink-0 flex-col items-center justify-center gap-2 border-t border-line p-3 pb-safe-plus-2 md:flex-row md:pb-3">
        {here ? (
          <>
            {/* Значок с числом, а не сам по себе: одинокая иконка
                рядом с круглыми кнопками выглядит как случайно
                оброненный символ. */}
            <span className="flex items-center gap-1.5 text-xs text-muted md:mr-2">
              <PingIndicator className="size-4" />
              {ping !== null && <span>{Math.round(ping)} мс</span>}
              <span aria-hidden>·</span>
              <CallTimer />
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleMute}
                title={muted ? "Включить микрофон" : "Выключить микрофон"}
                aria-label={muted ? "Включить микрофон" : "Выключить микрофон"}
                aria-pressed={muted}
                className={cn(
                  "rounded-full p-3 transition-colors duration-150 hover:bg-hover",
                  muted ? "bg-danger/15 text-danger" : "bg-raised text-bright",
                )}
              >
                {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
              </button>
              <MicPopover />

              <button
                onClick={toggleDeafen}
                title={deafened ? "Включить звук" : "Отключить звук"}
                aria-label={deafened ? "Включить звук" : "Отключить звук"}
                aria-pressed={deafened}
                className={cn(
                  "rounded-full p-3 transition-colors duration-150 hover:bg-hover",
                  deafened ? "bg-danger/15 text-danger" : "bg-raised text-bright",
                )}
              >
                {deafened ? <HeadphoneOff className="size-5" /> : <Headphones className="size-5" />}
              </button>
              <OutputPopover />

              <button
                onClick={() => void toggleVideo()}
                title={videoOn ? "Выключить камеру" : "Включить камеру"}
                aria-label={videoOn ? "Выключить камеру" : "Включить камеру"}
                aria-pressed={videoOn}
                className={cn(
                  "rounded-full p-3 transition-colors duration-150 hover:bg-hover",
                  videoOn ? "bg-online/15 text-online" : "bg-raised text-bright",
                )}
              >
                {videoOn ? <VideoOff className="size-5" /> : <Video className="size-5" />}
              </button>

              {/* Переворот — только на телефоне и только пока камера
                  включена. На компьютере камера одна, переворачивать
                  нечего, и кнопка была бы обманом. */}
              {videoOn && flippable && (
                <button
                  onClick={() => void flipCamera()}
                  title="Другая камера"
                  aria-label="Переключить на другую камеру"
                  className="rounded-full bg-raised p-3 text-bright transition-colors duration-150 hover:bg-hover"
                >
                  <SwitchCamera className="size-5" />
                </button>
              )}

              {/* Показ экрана — там, где он возможен. На телефоне кнопки
                  нет вовсе: getDisplayMedia там не существует, и она
                  могла бы только отказать после нажатия. */}
              {screenable && (
                <button
                  onClick={() => void toggleScreen()}
                  title={sharing ? "Прекратить показ экрана" : "Показать экран"}
                  aria-label={sharing ? "Прекратить показ экрана" : "Показать экран"}
                  aria-pressed={sharing}
                  className={cn(
                    "rounded-full p-3 transition-colors duration-150 hover:bg-hover",
                    sharing ? "bg-online/15 text-online" : "bg-raised text-bright",
                  )}
                >
                  {sharing ? <MonitorOff className="size-5" /> : <MonitorUp className="size-5" />}
                </button>
              )}

              {/* Пока смотришь чужой показ, красная кнопка прекращает
                  просмотр, а не выходит из разговора — как в дискорде.
                  Смотрят именно здесь, и рука тянется к последней
                  кнопке ряда; выход из разговора при этом никуда
                  не делся — он в полоске разговора слева, где виден
                  всегда. Значок — тот же экран, что и у показа, только
                  с крестиком: экран со стрелкой в красном читался бы
                  как «показываю», а тут ровно обратное. */}
              {watchingNow ? (
                <button
                  onClick={() => stopWatching(null)}
                  title="Прекратить просмотр"
                  aria-label="Прекратить просмотр"
                  className="rounded-full bg-danger p-3 text-white transition-opacity duration-150 hover:opacity-85"
                >
                  <MonitorX className="size-5" />
                </button>
              ) : (
                <button
                  onClick={leave}
                  title="Выйти из разговора"
                  aria-label="Выйти из разговора"
                  className="rounded-full bg-danger p-3 text-white transition-opacity duration-150 hover:opacity-85"
                >
                  <PhoneOff className="size-5" />
                </button>
              )}
            </div>
          </>
        ) : (
          <button
            onClick={() => void join(channelId)}
            className="rounded-md bg-online px-6 py-2.5 text-sm font-semibold text-white transition-opacity duration-150 hover:opacity-85"
          >
            Войти в разговор
          </button>
        )}
      </div>

      {menu && (
        <UserVolumeMenu
          userId={menu.userId}
          name={menu.name}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

/**
 * Плитка участника.
 *
 * Размер и форма постоянные, включена камера или нет: карточка 16:9,
 * в ней либо кадр, либо аватар посреди пустого места. Так список
 * не перестраивается каждый раз, когда кто-то включает камеру, —
 * а перестраивался бы он ровно в тот момент, когда все смотрят.
 *
 * Отдельным компонентом ещё и ради хука долгого нажатия: вызывать
 * его внутри map нельзя, а меню громкости нужно каждой плитке своё.
 */
function Tile({
  user,
  name,
  state,
  video,
  own,
  silenced,
  onMenu,
}: {
  user?: { id: string; displayName: string; avatarUrl?: string | null };
  name: string;
  state: { muted: boolean; deafened: boolean; speaking: boolean; sharing: boolean; video: boolean };
  video: MediaStream | null;
  own: boolean;
  silenced: boolean;
  onMenu?: (point: MenuPoint) => void;
}) {
  const hold = useLongPress(onMenu ?? (() => undefined));

  return (
    <li
      {...(onMenu ? hold : {})}
      className={cn(
        // На телефоне две плитки в ряд: 190 точек постоянной ширины
        // означали бы одну, потому что две не помещаются в экран.
        "relative aspect-video w-[calc(50%-0.375rem)] max-w-[220px] overflow-hidden rounded-lg bg-raised md:w-[220px]",
        "ring-2 transition-colors duration-100",
        state.speaking && !silenced ? "ring-online" : "ring-transparent",
        silenced && "opacity-60",
        onMenu && "select-none",
      )}
    >
      {video ? (
        <VideoTile stream={video} own={own} />
      ) : (
        <div className="flex size-full items-center justify-center">
          {user ? (
            <Avatar user={user} size={64} />
          ) : (
            <span className="size-16 rounded-full bg-panel" />
          )}
        </div>
      )}

      {/* Подпись поверх кадра, а не под ним: иначе при включённой
          камере плитка становится выше, и весь ряд подпрыгивает. */}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/75 to-transparent px-2 pt-4 pb-1.5">
        {/* Выключенный звук вместо выключенного микрофона: он важнее.
            Микрофон значит «сейчас молчу», звук — «не слышу вовсе»,
            и говорить такому человеку бесполезно. */}
        {state.deafened ? (
          <HeadphoneOff
            role="img"
            aria-label="Звук выключен — не слышит"
            className="size-3.5 shrink-0 text-danger"
          />
        ) : (
          state.muted && (
            <MicOff role="img" aria-label="Микрофон выключен" className="size-3.5 shrink-0 text-danger" />
          )
        )}
        {state.sharing && (
          <MonitorUp role="img" aria-label="Показывает экран" className="size-3.5 shrink-0 text-online" />
        )}
        {silenced && (
          <VolumeX role="img" aria-label="Заглушён лично вами" className="size-3.5 shrink-0 text-muted" />
        )}
        <span className="truncate text-xs font-medium text-white">{name}</span>
      </div>
    </li>
  );
}

/** Кадр с чужой камеры внутри плитки. */
function VideoTile({ stream, own }: { stream: MediaStream; own: boolean }) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = stream;
    void element.play().catch(() => undefined);
    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  return (
    <video
      ref={video}
      playsInline
      // Свой звук не воспроизводим никогда, но у камеры его и нет —
      // muted здесь на случай, если браузер решит иначе, и заодно
      // снимает запрет на автозапуск.
      muted
      className={cn(
        // cover, а не contain: плитка маленькая, и чёрные поля по бокам
        // съели бы половину и без того небольшого лица.
        "size-full object-cover",
        // Себя человек привык видеть зеркально — так его показывает
        // любая камера телефона и любое зеркало. Чужих не переворачиваем:
        // там зеркалить нечего, это уже чужое лицо, а не своё отражение.
        own && "-scale-x-100",
      )}
    />
  );
}

/**
 * Предупреждение, когда своя демонстрация не тянет.
 *
 * Раньше об этом можно было узнать только от собеседника — «у тебя
 * дёргается». Причину называет сам кодировщик: либо не хватает
 * компьютера, либо канала. Совет от этого зависит, поэтому и текст
 * разный.
 */
function ScreenTrouble() {
  const как = useStore((s) => s.screenStats);
  const scaled = useStore((s) => s.screenScaled);
  if (!как) return null;

  /*
   * Числа, а не «всё хорошо».
   *
   * «Плохое качество» — жалоба, по которой нельзя ничего починить:
   * плохо бывает от размера, от кадров, от полосы и от того, что
   * картинка пошла не той дорогой. Здесь мессенджер говорит прямо,
   * что у него происходит: и человеку спокойнее, и чинить есть что.
   */
  const части: string[] = [];
  if (как.height) части.push(`${как.height}p`);
  if (как.fps !== null) части.push(`${как.fps} к/с`);
  if (как.мбит !== null && как.мбит > 0.05) {
    части.push(`${как.мбит.toFixed(1).replace(".", ",")} Мбит/с`);
  }
  части.push(как.черезСервер ? "через сервер" : "напрямую каждому");

  const беда =
    как.предел === "cpu"
      ? "компьютер не успевает сжимать"
      : как.предел === "bandwidth"
        ? "не хватает канала"
        : null;

  return (
    <div
      role="status"
      className={cn(
        "mx-3 mb-2 shrink-0 rounded-md px-3 py-2 text-xs leading-snug",
        беда ? "bg-idle/10 text-idle" : "bg-raised text-muted",
      )}
    >
      Показ: {части.join(" · ")}
      {scaled !== null && ` · опустил до ${scaled}p ради кадров`}
      {беда && ` · ${беда}`}
    </div>
  );
}
