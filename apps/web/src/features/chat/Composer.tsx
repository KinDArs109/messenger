import { useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { CornerUpLeft, Plus, SendHorizontal, X } from "lucide-react";
import { LIMITS, type AttachmentDto, type MessageDto } from "@messenger/shared";
import { api, ApiError, getAccessToken } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useStore } from "@/lib/store";
import { formatBytes } from "@/lib/utils";
import { PendingAttachments } from "./Attachments";

export function Composer({
  channelId,
  placeholder,
}: {
  channelId: string;
  placeholder: string;
}) {
  const addMessage = useStore((s) => s.addMessage);
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
    const accepted = files.filter((file) => {
      if (file.size > LIMITS.uploadBytes) {
        setError(`«${file.name}» больше ${formatBytes(LIMITS.uploadBytes)}`);
        return false;
      }
      return true;
    });
    if (accepted.length === 0) return;

    setUploading((n) => n + accepted.length);
    for (const file of accepted) {
      try {
        const body = new FormData();
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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
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
      className="relative shrink-0 px-4 pb-6"
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

      <div className="flex items-end gap-3 rounded-lg bg-raised px-4">
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
          className="py-2.5 text-muted hover:text-body"
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

        <button
          onClick={() => void send()}
          disabled={!canSend}
          title="Отправить"
          aria-label="Отправить"
          className="py-2.5 text-muted hover:text-body disabled:opacity-40"
        >
          <SendHorizontal className="size-5" />
        </button>
      </div>
    </div>
  );
}
