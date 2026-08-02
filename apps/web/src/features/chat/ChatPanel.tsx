import { AtSign, Hash, Users, Volume2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { activeChannel, useStore } from "@/lib/store";
import { Welcome } from "@/features/shell/Welcome";
import { MessagesSkeleton } from "@/components/ui/Skeleton";
import { ChannelTabs } from "./ChannelTabs";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { TypingIndicator } from "./TypingIndicator";

export function ChatPanel({ onLoadMore }: { onLoadMore: () => void }) {
  // activeChannel собирает новый объект на каждый вызов. Без
  // поверхностного сравнения zustand считает, что состояние менялось
  // при каждой проверке, и React уходит в бесконечную перерисовку.
  const channel = useStore(useShallow(activeChannel));
  const membersOpen = useStore((s) => s.membersOpen);
  const toggleMembers = useStore((s) => s.toggleMembers);
  const isHome = useStore((s) => s.serverId === null);
  // «Пусто» — только когда данные действительно пришли. Пока они
  // грузятся или не пришли, приветствие для новичка показывать нельзя.
  const isEmptyAccount = useStore(
    (s) => s.loading === "ready" && s.servers.length === 0 && s.dms.length === 0,
  );
  const stillLoading = useStore((s) => s.loading === "pending");

  // Ничего не выбрано и выбирать не из чего — значит человек только
  // что зарегистрировался, и ему нужен не намёк, а действие.
  if (!channel && isEmptyAccount) return <Welcome />;

  if (!channel) {
    // Пока данные идут — скелет ленты, а не спиннер: он показывает,
    // что именно появится, и лента не прыгает в момент подстановки.
    if (stillLoading) {
      return (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="h-head shrink-0 shadow-[0_1px_0_rgba(0,0,0,0.2)]" />
          <MessagesSkeleton />
        </div>
      );
    }

    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted">
          {isHome ? "Выберите переписку слева" : "Выберите канал слева"}
        </p>
      </div>
    );
  }

  const Icon = channel.isDm ? AtSign : channel.type === "VOICE" ? Volume2 : Hash;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ChannelTabs />

      <header className="flex h-head shrink-0 items-center gap-2 px-4 shadow-[0_1px_0_rgba(0,0,0,0.2)]">
        <Icon className="size-6 text-faint" />
        <h1 className="font-semibold text-bright">{channel.name}</h1>
        {channel.topic && (
          <>
            <span className="mx-2 h-6 w-px bg-line" />
            <p className="truncate text-sm text-muted">{channel.topic}</p>
          </>
        )}
        <button
          onClick={toggleMembers}
          hidden={channel.isDm}
          title={membersOpen ? "Скрыть участников" : "Показать участников"}
          aria-label={membersOpen ? "Скрыть участников" : "Показать участников"}
          aria-pressed={membersOpen}
          className={`ml-auto rounded p-1 hover:bg-hover ${membersOpen ? "text-bright" : "text-muted"}`}
        >
          <Users className="size-6" />
        </button>
      </header>

      {/* Сюда попасть почти нельзя: клик по голосовому каналу
          подключает к разговору, а не открывает его лентой. Ветка
          осталась на случай, если канал окажется выбран иначе —
          например, останется висеть вкладкой после смены типа. */}
      {channel.type === "VOICE" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <Volume2 className="size-12 text-faint" />
          <p className="text-muted">Голосовой канал — нажмите на него слева, чтобы войти</p>
        </div>
      ) : (
        <>
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
