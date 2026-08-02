import { useEffect, useRef, useState } from "react";
import { CornerUpLeft, Pencil, Trash2 } from "lucide-react";
import { can, LIMITS, type MessageDto } from "@messenger/shared";
import { api, ApiError } from "@/lib/api";
import { currentServer, useStore } from "@/lib/store";
import { Avatar } from "@/components/Avatar";
import { Attachments } from "./Attachments";
import { MessageContent } from "./MessageContent";
import { ReactionPicker, Reactions } from "./Reactions";
import { formatDateTime, formatTime } from "@/lib/utils";
import { usePreferences } from "@/lib/preferences";

export function MessageRow({ message, grouped }: { message: MessageDto; grouped: boolean }) {
  const me = useStore((s) => s.me);
  const server = useStore(currentServer);
  const setReplyTo = useStore((s) => s.setReplyTo);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { prefs } = usePreferences();
  const compact = prefs.compact;

  const isAuthor = me?.id === message.author.id;
  // Править чужое нельзя никому, включая владельца: подменённые
  // чужие слова — это не модерация, а другая история.
  const mayEdit = isAuthor;
  const mayDelete = isAuthor || (server ? can(server.role, "message:deleteAny") : false);

  async function remove() {
    try {
      await api.delete(`/messages/${message.id}`);
      useStore.getState().removeMessage(message.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось удалить");
      setConfirming(false);
    }
  }

  // Компактная лента ужимает только отступы между группами: сжимать
  // сам текст бессмысленно, читаемость упадёт, а места не прибавится.
  const gap = grouped ? "" : message.replyTo ? (compact ? "mt-3" : "mt-6") : compact ? "mt-2" : "mt-4";

  return (
    <article
      data-message={message.id}
      className={`group relative flex gap-4 px-4 py-0.5 hover:bg-hover ${gap}`}
    >
      {/* Цитата над ответом. Показываем строку, а не всё сообщение:
          иначе лента превращается в дерево и читать её нельзя. */}
      {message.replyTo && (
        <>
          <span aria-hidden className="w-10 shrink-0" />
          <button
            onClick={() => {
              document
                .querySelector(`[data-message="${message.replyTo!.id}"]`)
                ?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            className="absolute top-0 left-18 flex max-w-[70%] items-center gap-1.5 text-left text-xs text-muted hover:text-body"
          >
            <CornerUpLeft className="size-3 shrink-0" />
            <span className="font-medium text-bright">{message.replyTo.authorName}</span>
            <span className={`truncate ${message.replyTo.deleted ? "italic" : ""}`}>
              {message.replyTo.content}
            </span>
          </button>
        </>
      )}

      {grouped ? (
        <time
          dateTime={message.createdAt}
          className={`w-10 shrink-0 text-center text-[11px] leading-[22px] text-muted ${
            prefs.alwaysTime ? "" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          {formatTime(message.createdAt)}
        </time>
      ) : (
        <Avatar user={message.author} size={40} className="mt-0.5" />
      )}

      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="leading-snug">
            <span className="font-medium text-bright">{message.author.displayName}</span>
            <time dateTime={message.createdAt} className="ml-2 text-xs text-muted">
              {formatDateTime(message.createdAt)}
            </time>
          </div>
        )}

        {editing ? (
          <EditForm message={message} onDone={() => setEditing(false)} />
        ) : (
          <>
            {message.content && (
              <p className="wrap-break-word whitespace-pre-wrap text-body">
                <MessageContent content={message.content} />
                {message.editedAt && (
                  <span className="ml-1 text-[10px] text-muted">(изменено)</span>
                )}
              </p>
            )}
            <Attachments items={message.attachments} />
            <Reactions messageId={message.id} reactions={message.reactions} />
          </>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        {confirming && (
          <div className="mt-1 flex items-center gap-3 rounded bg-rail px-3 py-2 text-sm">
            <span className="text-muted">Удалить сообщение?</span>
            <button onClick={() => void remove()} className="font-medium text-danger hover:underline">
              Удалить
            </button>
            <button onClick={() => setConfirming(false)} className="text-muted hover:underline">
              Отмена
            </button>
          </div>
        )}
      </div>

      {/* Панель действий появляется при наведении и по фокусу с клавиатуры —
          иначе до неё нельзя добраться без мыши. */}
      {!editing && (
        <div className="absolute -top-3 right-4 hidden gap-0.5 rounded border border-line bg-sidebar p-0.5 shadow-md group-focus-within:flex group-hover:flex">
          <ReactionPicker messageId={message.id} />
          <button
            onClick={() => setReplyTo(message)}
            title="Ответить"
            aria-label="Ответить на сообщение"
            className="rounded p-1.5 text-muted hover:bg-hover hover:text-body"
          >
            <CornerUpLeft className="size-4" />
          </button>
          {mayEdit && (
            <button
              onClick={() => setEditing(true)}
              title="Изменить"
              aria-label="Изменить сообщение"
              className="rounded p-1.5 text-muted hover:bg-hover hover:text-body"
            >
              <Pencil className="size-4" />
            </button>
          )}
          {mayDelete && (
            <button
              onClick={() => setConfirming(true)}
              title="Удалить"
              aria-label="Удалить сообщение"
              className="rounded p-1.5 text-muted hover:bg-hover hover:text-danger"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function EditForm({ message, onDone }: { message: MessageDto; onDone: () => void }) {
  const [value, setValue] = useState(message.content);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.focus();
    // Курсор в конец, а не в начало: правят обычно последнее слово.
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  async function save() {
    const content = value.trim();
    if (!content || content === message.content) {
      onDone();
      return;
    }
    try {
      await api.patch(`/messages/${message.id}`, { content });
      useStore.getState().updateMessage(message.id, content, new Date().toISOString());
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить");
    }
  }

  return (
    <div>
      <textarea
        ref={area}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${e.target.scrollHeight}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape") onDone();
        }}
        maxLength={LIMITS.messageContent.max}
        className="w-full resize-none rounded bg-raised px-3 py-2 text-body outline-none"
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <p className="mt-1 text-xs text-muted">
        Escape — <button onClick={onDone} className="text-link hover:underline">отмена</button> · Enter —{" "}
        <button onClick={() => void save()} className="text-link hover:underline">сохранить</button>
      </p>
    </div>
  );
}
