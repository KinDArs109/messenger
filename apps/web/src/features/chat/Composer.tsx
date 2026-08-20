import { useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { CornerUpLeft, Plus, SendHorizontal, X } from "lucide-react";
import { LIMITS, uploadLimitFor, type AttachmentDto, type MessageDto } from "@messenger/shared";
import { api, ApiError, getAccessToken } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useStore } from "@/lib/store";
import { formatBytes } from "@/lib/utils";
import { PendingAttachments } from "./Attachments";
import { EmojiPicker } from "./EmojiPicker";
import { VoiceRecorder } from "./VoiceRecorder";

export function Composer({
  channelId,
  placeholder,
}: {
  channelId: string;
  placeholder: string;
}) {
  const addMessage = useStore((s) => s.addMessage);
  // Уровень сервера, которому принадлежит канал: от него зависит,
  // какой файл вообще можно приложить. У личной переписки сервера
  // нет — там ноль, то есть базовый предел.
  const serverLevel = useStore(
    (s) => s.servers.find((server) => server.channels.some((c) => c.id === channelId))?.level ?? 0,
  );
  const replyTo = useStore((s) => s.replyTo);
  const setReplyTo = useStore((s) => s.setReplyTo);
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<AttachmentDto[]>([]);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const lastTyping = useRef(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  function grow() {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }

  /** Файл уходит на сервер сразу при выборе, а не при отправке:
   *  пока человек дописывает текст, загрузка уже идёт. */
  async function uploadFiles(files: File[]) {
    setError(null);
    // Предел зависит от того, куда отправляем: поддержанный сервер
    // принимает больше — это и есть награда за буст. В личной переписке
    // сервера нет, там предел базовый.
    const limit = uploadLimitFor(serverLevel);
    const accepted = files.filter((file) => {
      if (file.size > limit) {
        setError(`«${file.name}» больше ${formatBytes(limit)}`);
        return false;
      }
      return true;
    });
    if (accepted.length === 0) return;

    setUploading((n) => n + accepted.length);
    for (const file of accepted) {
      try {
        const body = new FormData();
        // Куда отправляем — первым полем: по каналу сервер определит
        // настоящий предел, а части multipart читаются по порядку.
        body.append("channelId", channelId);
        body.append("file", file);
        // FormData отправляем обычным fetch: обёртка api ставит
        // Content-Type: application/json, а здесь его должен
        // выставить браузер сам — вместе с границей multipart.
        const res = await fetch("/api/uploads", {
          method: "POST",
          headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
          body,
        });
        const data = (await res.json()) as
          | { attachment: AttachmentDto }
          | { error: { message: string } };
        if (!res.ok) throw new Error("error" in data ? data.error.message : "Ошибка загрузки");
        setAttachments((prev) => [...prev, (data as { attachment: AttachmentDto }).attachment]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить файл");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function send() {
    const content = value.trim();
    if (!content && attachments.length === 0) return;

    const sentAttachments = attachments;
    const sentReplyTo = replyTo;
    setValue("");
    setAttachments([]);
    setReplyTo(null);
    setError(null);
    requestAnimationFrame(grow);

    try {
      const r = await api.post<{ message: MessageDto }>(`/channels/${channelId}/messages`, {
        content,
        attachmentIds: sentAttachments.map((a) => a.id),
        ...(sentReplyTo ? { replyToId: sentReplyTo.id } : {}),
      });
      addMessage(r.message);
    } catch (err) {
      // Возвращаем всё как было: терять написанное, загруженные файлы
      // и выбранный ответ из-за сбоя сети — худшее, что может сделать
      // мессенджер.
      setValue(content);
      setAttachments(sentAttachments);
      setReplyTo(sentReplyTo);
      setError(err instanceof ApiError ? err.message : "Не удалось отправить");
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    // На экранной клавиатуре Enter — это перенос строки, а не отправка.
    // Shift там нажать негде, так что иначе сообщение в два абзаца
    // с телефона написать было бы нельзя; отправляют кнопкой рядом.
    if (matchMedia("(pointer: coarse)").matches) return;
    event.preventDefault();
    void send();
  }

  function onChange(next: string) {
    setValue(next);
    grow();
    const now = Date.now();
    if (now - lastTyping.current > 3000) {
      lastTyping.current = now;
      getSocket()?.emit("typing:start", { channelId });
    }
  }

  /** Вставить эмодзи туда, где стоит курсор, а не в конец: дописывать
   *  их посреди фразы — обычное дело. */
  function insertEmoji(name: string) {
    const el = area.current;
    const token = `:${name}: `;
    if (!el) {
      setValue((prev) => prev + token);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    const next = value.slice(0, start) + token + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      const at = start + token.length;
      el.setSelectionRange(at, at);
      grow();
    });
  }

  /** Отправить записанное — сразу и отдельным сообщением. */
  async function sendVoice(attachment: AttachmentDto) {
    setError(null);
    try {
      const r = await api.post<{ message: MessageDto }>(`/channels/${channelId}/messages`, {
        content: "",
        attachmentIds: [attachment.id],
      });
      addMessage(r.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Запись не отправилась");
    }
  }

  function onPaste(event: ClipboardEvent) {
    const files = [...event.clipboardData.files];
    if (files.length > 0) {
      event.preventDefault();
      void uploadFiles(files);
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const files = [...event.dataTransfer.files];
    if (files.length > 0) void uploadFiles(files);
  }

  const left = LIMITS.messageContent.max - value.length;
  const canSend = Boolean(value.trim()) || attachments.length > 0;

  return (
    <div
      className="relative shrink-0 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:px-4 md:pb-6"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent/10 text-sm font-medium text-bright">
          Отпустите, чтобы прикрепить
        </div>
      )}

      {error && (
        <p role="alert" className="mb-1 text-sm text-danger">
          {error}
        </p>
      )}

      {replyTo && (
        <div className="flex items-center gap-2 rounded-t-lg bg-panel px-4 py-2 text-sm">
          <CornerUpLeft className="size-4 shrink-0 text-muted" />
          <span className="text-muted">Ответ</span>
          <span className="font-medium text-bright">{replyTo.author.displayName}</span>
          <span className="min-w-0 flex-1 truncate text-muted">{replyTo.content}</span>
          <button
            onClick={() => setReplyTo(null)}
            title="Отменить ответ"
            aria-label="Отменить ответ"
            className="shrink-0 rounded p-0.5 text-muted hover:text-body"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      <PendingAttachments
        items={attachments}
        uploading={uploading}
        onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
      />

      {/* На телефоне отступы и промежутки вдвое меньше: три сотни точек
          ширины делятся между двумя кнопками и полем, и поле важнее. */}
      <div className="flex items-end gap-1 rounded-lg bg-raised px-2 md:gap-3 md:px-4">
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void uploadFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => picker.current?.click()}
          title="Прикрепить файл"
          aria-label="Прикрепить файл"
          className="px-2 py-2.5 text-muted hover:text-body"
        >
          <Plus className="size-6" />
        </button>

        <textarea
          ref={area}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          maxLength={LIMITS.messageContent.max}
          placeholder={placeholder}
          aria-label={placeholder}
          className="max-h-80 flex-1 resize-none bg-transparent py-3 text-body outline-none placeholder:text-faint"
        />

        {left < 200 && (
          <span className={`py-3 text-xs ${left < 0 ? "text-danger" : "text-muted"}`}>{left}</span>
        )}

        {/* Свои эмодзи — рядом с отправкой, как в дискорде: их выбирают
            в конце фразы, а не в начале. */}
        <EmojiPicker onPick={insertEmoji} />

        {/* Голосовое уходит само, отдельным сообщением: дописывать
            к записи текст никто не станет, а лишний шаг «теперь нажми
            отправить» превращает быстрое действие в медленное. */}
        <VoiceRecorder onSend={(attachment) => void sendVoice(attachment)} onError={setError} />

        <button
          onClick={() => void send()}
          disabled={!canSend}
          title="Отправить"
          aria-label="Отправить"
          className="px-3 py-2.5 text-muted hover:text-body disabled:opacity-40 md:px-2"
        >
          <SendHorizontal className="size-5" />
        </button>
      </div>
    </div>
  );
}
