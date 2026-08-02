import { useEffect, useLayoutEffect, useRef } from "react";
import { MESSAGE_GROUP_WINDOW_MS } from "@messenger/shared";
import { useStore } from "@/lib/store";
import { MessageRow } from "./MessageRow";
import { formatDay } from "@/lib/utils";

export function MessageList({ onLoadMore }: { onLoadMore: () => void }) {
  const messages = useStore((s) => s.messages);
  const nextCursor = useStore((s) => s.nextCursor);
  const loading = useStore((s) => s.loadingHistory);
  const channelId = useStore((s) => s.channelId);

  /* Позицию черты фиксируем один раз при входе в канал. Дальше её
     нельзя двигать: канал тут же помечается прочитанным, и черта
     исчезла бы у человека на глазах, не успев пригодиться. */
  const markAfterRef = useRef<string | null>(null);
  const markedChannel = useRef<string | null>(null);
  const readState = useStore((s) => (channelId ? s.readStates.get(channelId) : undefined));

  if (channelId && markedChannel.current !== channelId) {
    markedChannel.current = channelId;
    const lastRead = readState?.lastReadMessageId ?? null;
    const lastMessage = readState?.lastMessageId ?? null;
    markAfterRef.current = lastRead && lastMessage && lastMessage > lastRead ? lastRead : null;
  }
  const markAfter = markAfterRef.current;

  const boxRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<{ height: number; top: number } | null>(null);
  const count = useRef(0);

  // Перед добавлением старых сообщений запоминаем высоту, после —
  // возвращаем прокрутку на то же место. Без этого подгрузка сверху
  // выбрасывает пользователя из того места, которое он читал.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const grewOnTop = messages.length > count.current && anchorRef.current;
    if (grewOnTop) {
      box.scrollTop = box.scrollHeight - anchorRef.current!.height + anchorRef.current!.top;
      anchorRef.current = null;
    }
    count.current = messages.length;
  }, [messages]);

  // При смене канала и приходе новых сообщений — вниз.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }, [messages, channelId]);

  function loadMore() {
    const box = boxRef.current;
    if (box) anchorRef.current = { height: box.scrollHeight, top: box.scrollTop };
    onLoadMore();
  }

  if (messages.length === 0 && !loading) {
    return (
      <div ref={boxRef} className="flex flex-1 items-center justify-center overflow-y-auto">
        <p className="text-muted">Здесь пока тихо. Напишите первым.</p>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="flex-1 overflow-y-auto py-4">
      {nextCursor && (
        <div className="flex justify-center pb-3">
          <button
            onClick={loadMore}
            disabled={loading}
            className="rounded bg-raised px-3.5 py-1.5 text-sm hover:bg-active disabled:opacity-60"
          >
            {loading ? "Загружаю…" : "Загрузить более старые"}
          </button>
        </div>
      )}

      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const newDay =
          !previous ||
          new Date(previous.createdAt).toDateString() !==
            new Date(message.createdAt).toDateString();

        /* Сообщение примыкает к предыдущему, если тот же автор,
           прошло меньше пяти минут и нет границы дня. Именно эта
           деталь сильнее всего влияет на то, ощущается интерфейс
           мессенджером или списком записей. */
        const grouped =
          !newDay &&
          previous?.author.id === message.author.id &&
          new Date(message.createdAt).getTime() -
            new Date(previous.createdAt).getTime() <
            MESSAGE_GROUP_WINDOW_MS;

        /* Черта «новые сообщения» — там, где человек остановился
           в прошлый раз. Ставим перед первым непрочитанным, а не
           после последнего прочитанного: иначе при удалении
           сообщения черта уезжала бы не туда. */
        const firstUnread =
          markAfter !== null && message.id > markAfter && (!previous || previous.id <= markAfter);

        return (
          <div key={message.id}>
            {newDay && <DaySeparator iso={message.createdAt} />}
            {firstUnread && <NewMessagesDivider />}
            <MessageRow message={message} grouped={firstUnread ? false : grouped} />
          </div>
        );
      })}
    </div>
  );
}

function NewMessagesDivider() {
  return (
    <div className="relative mx-4 my-2 flex items-center" role="separator">
      <span className="h-px flex-1 bg-danger" />
      <span className="rounded-sm bg-danger px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">
        новые сообщения
      </span>
    </div>
  );
}

function DaySeparator({ iso }: { iso: string }) {
  return (
    <div className="mx-4 my-4 flex items-center gap-3">
      <span className="h-px flex-1 bg-line" />
      <span className="text-xs font-semibold text-muted">{formatDay(iso)}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
