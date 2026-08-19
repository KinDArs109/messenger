import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, X } from "lucide-react";
import { MESSAGE_GROUP_WINDOW_MS } from "@messenger/shared";
import { useStore } from "@/lib/store";
import { MessageRow } from "./MessageRow";
import { formatDay, formatTime } from "@/lib/utils";

/**
 * Что считается «человек стоит в конце».
 *
 * Именно в конце, а не рядом с ним. Сначала здесь было полтораста
 * точек — примерно одно сообщение, — и лента уезжала вниз, даже когда
 * человек отлистнул на пару строк вверх почитать. Дёргать его в этот
 * момент нельзя: он читает, а не ждёт.
 *
 * Восемь точек — не «близко», а запас на округление. Браузер после
 * своей же прокрутки оставляет доли точки, а при дробном масштабе
 * экрана — и целую; без запаса лента считала бы концом не всякий конец
 * и показывала полоску тому, кто и так стоит внизу.
 */
const AT_BOTTOM = 8;

export function MessageList({ onLoadMore }: { onLoadMore: () => void }) {
  const messages = useStore((s) => s.messages);
  const nextCursor = useStore((s) => s.nextCursor);
  const loading = useStore((s) => s.loadingHistory);
  const channelId = useStore((s) => s.channelId);
  const meId = useStore((s) => s.me?.id);

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
  const contentRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<{ height: number; top: number } | null>(null);
  const firstIdRef = useRef<string | null>(null);
  const lastIdRef = useRef<string | null>(null);
  const shownChannel = useRef<string | null>(null);

  /**
   * Стоим ли в самом конце ленты.
   *
   * Считается в обработчике прокрутки, а не в тот момент, когда
   * сообщение уже добавлено. Разница принципиальная: к моменту
   * добавления лента успела вырасти, и человек, стоявший вплотную
   * к концу, оказывается «в трёхстах точках от него» — ровно на
   * высоту пришедшей картинки. Так лента переставала ехать вниз
   * именно на длинных сообщениях, то есть там, где это заметнее
   * всего. Здесь же записано то, что было до прихода.
   */
  const stickRef = useRef(true);
  /** Сколько пришло, пока человек смотрел выше, и с какого времени. */
  const [unseen, setUnseen] = useState(0);
  const [since, setSince] = useState<string | null>(null);

  function toBottom(box: HTMLDivElement) {
    box.scrollTop = box.scrollHeight;
    stickRef.current = true;
    setUnseen(0);
    setSince(null);
  }

  function onScroll() {
    const box = boxRef.current;
    if (!box) return;
    const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < AT_BOTTOM;
    stickRef.current = atEnd;
    // Долистал сам — полоска больше не нужна: он и так всё увидел.
    if (atEnd && unseen > 0) {
      setUnseen(0);
      setSince(null);
    }
  }

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const first = messages[0] ?? null;
    const last = messages[messages.length - 1] ?? null;

    // Подгрузка старых сверху: возвращаем прокрутку на то же место.
    // Без этого человека выбрасывает из того куска, который он читал.
    //
    // Сверяем ещё и первое сообщение, а не только метку: запрос мог
    // не дойти, и тогда метка осталась бы висеть, а следующее новое
    // сообщение было бы принято за подгруженную историю.
    if (anchorRef.current && first && first.id !== firstIdRef.current) {
      box.scrollTop = box.scrollHeight - anchorRef.current.height + anchorRef.current.top;
      anchorRef.current = null;
      firstIdRef.current = first.id;
      // Полез в старое — значит конца больше не держимся. Иначе сторож
      // высоты ниже увидел бы выросшую ленту и утащил бы человека вниз
      // ровно из того куска, который он только что открыл.
      stickRef.current = false;
      return;
    }
    anchorRef.current = null;
    firstIdRef.current = first?.id ?? null;

    // Сменили канал — всегда в конец, что бы ни было прокручено
    // в предыдущем. Раньше положение прокрутки переезжало из канала
    // в канал, и открытый канал встречал человека серединой позавчера.
    if (shownChannel.current !== channelId) {
      shownChannel.current = channelId;
      lastIdRef.current = last?.id ?? null;
      toBottom(box);
      return;
    }

    if (!last || last.id === lastIdRef.current) return;

    const known = lastIdRef.current;
    const fresh = known ? messages.filter((m) => m.id > known) : messages;
    lastIdRef.current = last.id;

    // Хвост изменился, но нового ничего нет — значит последнее удалили.
    // Уезжать вниз из-за чужого удаления нельзя: человек читает
    // и никого об этом не просил.
    if (fresh.length === 0) return;

    // Своё сообщение — вниз всегда. Человек только что нажал «отправить»
    // и ждёт увидеть его, а не искать по ленте: отправляя, он сам
    // и перевёл разговор в конец.
    if (last.author.id === meId || stickRef.current) {
      toBottom(box);
      return;
    }

    // Стоит хоть немного выше конца — не дёргаем. Вместо этого считаем,
    // сколько пропущено, и говорим об этом полоской внизу.
    setUnseen((n) => n + fresh.length);
    setSince((was) => was ?? fresh[0]?.createdAt ?? null);
  }, [messages, channelId, meId]);

  const empty = messages.length === 0 && !loading;

  /**
   * Сторож высоты.
   *
   * Лента растёт не только от новых сообщений. Картинка в сообщении
   * приходит с задержкой и раздвигает его уже после того, как оно
   * показано; так же ведут себя аватары и шрифт, который подставляется
   * не сразу.
   *
   * Из-за этого «уехали в конец» держалось ровно один кадр: высота
   * менялась следом, и только что показанное сообщение оказывалось
   * за нижним краем — приходилось долистывать руками. Пока стоим
   * в конце, возвращаем себя туда на каждое изменение высоты.
   */
  useEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;

    const watch = new ResizeObserver(() => {
      if (stickRef.current) box.scrollTop = box.scrollHeight;
    });
    watch.observe(content);
    // И за самой лентой, а не только за её содержимым. Содержимое
    // не меняется, когда на телефоне открывается клавиатура, — меняется
    // высота окна под ней. Лента при этом оставалась прокрученной
    // по-старому, и последние сообщения уезжали под клавиатуру: снаружи
    // это выглядит так, будто чат подпрыгнул вверх.
    watch.observe(box);
    return () => watch.disconnect();
  }, [empty]);

  function loadMore() {
    const box = boxRef.current;
    if (box) anchorRef.current = { height: box.scrollHeight, top: box.scrollTop };
    onLoadMore();
  }

  if (empty) {
    return (
      <div ref={boxRef} className="flex flex-1 items-center justify-center overflow-y-auto">
        <p className="text-muted">Здесь пока тихо. Напишите первым.</p>
      </div>
    );
  }

  return (
    // Обёртка нужна полоске: она висит над лентой, а не едет вместе
    // с ней. Для самой ленты ничего не меняется — те же flex-1
    // и своя прокрутка.
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={boxRef} onScroll={onScroll} className="flex-1 overflow-y-auto py-4">
        {/* Обёртка ровно для сторожа высоты: следить надо за самим
            содержимым, а размер прокручиваемой коробки не меняется. */}
        <div ref={contentRef}>
          {nextCursor && (
            <div className="flex justify-center pb-3">
              <button
                onClick={loadMore}
                disabled={loading}
                className="rounded bg-raised px-3.5 py-2.5 text-sm hover:bg-active disabled:opacity-60 md:py-1.5"
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
              markAfter !== null &&
              message.id > markAfter &&
              (!previous || previous.id <= markAfter);

            return (
              <div key={message.id}>
                {newDay && <DaySeparator iso={message.createdAt} />}
                {firstUnread && <NewMessagesDivider />}
                <MessageRow message={message} grouped={firstUnread ? false : grouped} />
              </div>
            );
          })}
        </div>
      </div>

      {unseen > 0 && (
        <ArrivedBar
          count={unseen}
          since={since}
          onJump={() => {
            const box = boxRef.current;
            if (box) toBottom(box);
          }}
          onHide={() => {
            setUnseen(0);
            setSince(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * «Пока вы читали, пришло столько-то».
 *
 * Внизу, а не вверху: сообщения пришли под текущим местом, и полоска
 * должна показывать в ту же сторону, куда ведёт. Крестик рядом —
 * для случая, когда спускаться человек не хочет: без него полоска
 * висела бы до самого низа и закрывала последнюю строку.
 */
function ArrivedBar({
  count,
  since,
  onJump,
  onHide,
}: {
  count: number;
  since: string | null;
  onJump: () => void;
  onHide: () => void;
}) {
  return (
    <div
      role="status"
      className="absolute inset-x-0 bottom-0 flex items-center bg-accent text-white shadow-lg"
    >
      <button
        type="button"
        onClick={onJump}
        className="flex min-w-0 flex-1 items-center gap-2 px-4 py-1.5 text-left hover:bg-accent-hover"
      >
        <span className="truncate text-sm font-semibold">
          {plural(count)}
          {since && <span className="font-normal opacity-90"> с {formatTime(since)}</span>}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1 text-xs opacity-90">
          Перейти вниз
          <ArrowDown className="size-3.5" />
        </span>
      </button>
      <button
        type="button"
        onClick={onHide}
        title="Скрыть"
        aria-label="Скрыть"
        className="shrink-0 self-stretch px-3 hover:bg-accent-hover"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

/** Русский счёт: одно сообщение, два сообщения, пять сообщений.
 *  Одиннадцать–четырнадцать — исключение, они ведут себя как пять. */
function plural(count: number): string {
  const tail = count % 100;
  const one = count % 10;
  if (tail < 11 || tail > 14) {
    if (one === 1) return `${count} новое сообщение`;
    if (one >= 2 && one <= 4) return `${count} новых сообщения`;
  }
  return `${count} новых сообщений`;
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
