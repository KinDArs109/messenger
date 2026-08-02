import { useState } from "react";
import { Download, FileText, X } from "lucide-react";
import type { AttachmentDto } from "@messenger/shared";
import { formatBytes } from "@/lib/utils";

const isImage = (mimeType: string) => mimeType.startsWith("image/");

/** Вложения под текстом сообщения. */
export function Attachments({ items }: { items: AttachmentDto[] }) {
  const [zoomed, setZoomed] = useState<AttachmentDto | null>(null);
  if (items.length === 0) return null;

  return (
    <div className="mt-1 flex flex-col gap-2">
      {items.map((item) =>
        isImage(item.mimeType) ? (
          <button
            key={item.id}
            onClick={() => setZoomed(item)}
            className="block w-fit"
            title={`${item.filename} — ${formatBytes(item.size)}`}
          >
            <img
              src={item.url}
              alt={item.filename}
              // Размеры известны с сервера, поэтому место под картинку
              // резервируется заранее — лента не прыгает при загрузке.
              width={item.width ?? undefined}
              height={item.height ?? undefined}
              className="max-h-[350px] max-w-[400px] rounded-lg object-contain"
            />
          </button>
        ) : (
          <a
            key={item.id}
            href={item.url}
            download={item.filename}
            className="flex w-fit max-w-[400px] items-center gap-3 rounded-lg border border-line bg-rail p-3 hover:border-accent"
          >
            <FileText className="size-8 shrink-0 text-accent" />
            <span className="min-w-0">
              <span className="block truncate text-link">{item.filename}</span>
              <span className="block text-xs text-muted">{formatBytes(item.size)}</span>
            </span>
            <Download className="ml-2 size-5 shrink-0 text-muted" />
          </a>
        ),
      )}

      {zoomed && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-8"
          onClick={() => setZoomed(null)}
          role="dialog"
          aria-modal="true"
          aria-label={zoomed.filename}
        >
          <img
            src={zoomed.url}
            alt={zoomed.filename}
            className="max-h-full max-w-full rounded object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <a
            href={zoomed.url}
            download={zoomed.filename}
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-6 rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Скачать {zoomed.filename}
          </a>
        </div>
      )}
    </div>
  );
}

/** Файлы, выбранные, но ещё не отправленные — над полем ввода. */
export function PendingAttachments({
  items,
  uploading,
  onRemove,
}: {
  items: AttachmentDto[];
  uploading: number;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0 && uploading === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-2 rounded-lg bg-rail p-3">
      {items.map((item) => (
        <div key={item.id} className="relative">
          {isImage(item.mimeType) ? (
            <img src={item.url} alt={item.filename} className="size-24 rounded object-cover" />
          ) : (
            <div className="flex size-24 flex-col items-center justify-center rounded bg-raised p-1">
              <FileText className="size-8 text-accent" />
              <span className="mt-1 w-full truncate text-center text-[10px] text-muted">
                {item.filename}
              </span>
            </div>
          )}
          <button
            onClick={() => onRemove(item.id)}
            title="Убрать"
            aria-label={`Убрать ${item.filename}`}
            className="absolute -top-1.5 -right-1.5 rounded-full bg-danger p-1 text-white hover:brightness-110"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}

      {Array.from({ length: uploading }, (_, i) => (
        <div
          key={`pending-${i}`}
          className="flex size-24 animate-pulse items-center justify-center rounded bg-raised text-xs text-muted"
        >
          загрузка…
        </div>
      ))}
    </div>
  );
}
