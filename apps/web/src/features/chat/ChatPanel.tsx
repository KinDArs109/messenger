import { AnimatePresence } from "motion/react";
import { AtSign, Hash, Phone, Volume2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { activeChannel, useStore } from "@/lib/store";
import { MobileTopBar, PaneToggle, PeopleToggle, useMobileNav } from "@/features/shell/MobileShell";
import { Welcome } from "@/features/shell/Welcome";
import { MessagesSkeleton } from "@/components/ui/Skeleton";
import { VoiceStage } from "@/features/voice/VoiceStage";
import { CallPanel } from "@/features/voice/CallPanel";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { TypingIndicator } from "./TypingIndicator";
import { useCalls } from "@/features/voice/useCalls";

export function ChatPanel({ onLoadMore }: { onLoadMore: () => void }) {
  // activeChannel собирает новый объект на каждый вызов. Без
  // поверхностного сравнения zustand считает, что состояние менялось
  // при каждой проверке, и React уходит в бесконечную перерисовку.
  const channel = useStore(useShallow(activeChannel));
  // На обычном экране null — и всё, что ниже, ведёт себя как раньше.
  const nav = useMobileNav();
  const isHome = useStore((s) => s.serverId === null);
  // «Пусто» — только когда данные действительно пришли. Пока они
  // грузятся или не пришли, приветствие для новичка показывать нельзя.
  const isEmptyAccount = useStore(
    (s) => s.loading === "ready" && s.servers.length === 0 && s.dms.length === 0,
  );
  const stillLoading = useStore((s) => s.loading === "pending");
  const { call } = useCalls();
  // Уже разговариваем в этой переписке — звонить некому.
  const inCall = useStore((s) => s.voiceChannelId) === channel?.id;
  // Исходящий звонок по этой переписке: гудки идут — полоса уже нужна.
  const ringingHere = useStore(
    (s) => Boolean(s.call && !s.call.incoming && s.call.channelId === channel?.id),
  );

  // Ничего не выбрано и выбирать не из чего — значит человек только
  // что зарегистрировался, и ему нужен не намёк, а действие.
  if (!channel && isEmptyAccount) return <Welcome />;

  if (!channel) {
    // Пока данные идут — скелет ленты, а не спиннер: он показывает,
    // что именно появится, и лента не прыгает в момент подстановки.
    if (stillLoading) {
      return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {nav ? (
            <MobileTopBar title="Загрузка…" />
          ) : (
            <div className="h-head shrink-0 shadow-[0_1px_0_rgba(0,0,0,0.2)]" />
          )}
          <MessagesSkeleton />
        </div>
      );
    }

    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <MobileTopBar title="Мессенджер" />
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <p className="text-muted">
            {/* «Слева» на телефоне неправда: там ничего нет, пока
                не потянешь. Подсказка должна называть то действие,
                которое человек действительно может сделать. */}
            {nav
              ? isHome
                ? "Откройте список — кнопка вверху слева"
                : "Выберите канал — кнопка вверху слева"
              : isHome
                ? "Выберите переписку слева"
                : "Выберите канал слева"}
          </p>
        </div>
      </div>
    );
  }

  const Icon = channel.isDm ? AtSign : channel.type === "VOICE" ? Volume2 : Hash;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-head shrink-0 items-center gap-2 px-2 pt-safe shadow-[0_1px_0_rgba(0,0,0,0.2)] md:px-4">
        {/* Кнопка каналов — первой: панель выезжает слева, и открывать
            её кнопкой у другого края было бы странно. На большом экране
            она не рисуется вовсе. */}
        <PaneToggle />
        <Icon className="size-6 shrink-0 text-faint" />
        <h1 className="truncate font-semibold text-bright">{channel.name}</h1>
        {/* Тема канала — первое, чем жертвуем: на телефоне на неё
            уходит вся строка, а имя канала важнее. */}
        {channel.topic && !nav && (
          <>
            <span className="mx-2 h-6 w-px bg-line" />
            <p className="truncate text-sm text-muted">{channel.topic}</p>
          </>
        )}
        {/* Позвонить — только в личной переписке. В канале сервера
            звонить некому: туда просто заходят, и кто зашёл, видно
            всем. */}
        {channel.isDm && !inCall && (
          <button
            onClick={() => call(channel.id)}
            title="Позвонить"
            aria-label="Позвонить"
            className="ml-auto shrink-0 rounded p-2 text-muted hover:bg-hover hover:text-online"
          >
            <Phone className="size-5" />
          </button>
        )}

        {/* Участники — кнопкой и только на телефоне: на большом экране
            они стоят своим столбцом и видны всегда, прятать четырёх
            человек за кнопкой незачем. */}
        <PeopleToggle />
      </header>

      {channel.type === "VOICE" ? (
        <VoiceStage channelId={channel.id} />
      ) : (
        <>
          {/* Звонок в личной переписке — полосой сверху, а переписка
              остаётся на месте. Во время разговора кидают ссылки
              и смотрят, о чём договаривались вчера; экран, забранный
              звонком целиком, всё это отнимал. */}
          <AnimatePresence>
            {channel.isDm && (inCall || ringingHere) && <CallPanel channelId={channel.id} />}
          </AnimatePresence>

          {/* Показ экрана здесь не рисуем.
              Раньше он висел над лентой — предполагалось, что во время
              показа заодно и переписываются. На деле кадр занимает
              половину высоты, переписку из-за него не видно, а нужен он
              ровно там, где на него смотрят: в голосовом канале.
              Вернуться туда — одно нажатие на канал в полоске
              разговора слева. */}
          <MessageList onLoadMore={onLoadMore} />
          <TypingIndicator />
          <Composer
            channelId={channel.id}
            placeholder={
              channel.isDm ? `Написать ${channel.topic ?? channel.name}` : `Написать в #${channel.name}`
            }
          />
        </>
      )}
    </div>
  );
}
