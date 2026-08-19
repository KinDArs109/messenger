import { useState } from "react";
import { Download, FileText, X } from "lucide-react";
import type { AttachmentDto } from "@messenger/shared";
import { formatBytes } from "@/lib/utils";
import { ImageViewer } from "./ImageViewer";

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
            // max-w-full обязателен: без него картинка держала свои
            // четыреста точек и на телефоне уезжала за правый край
            // экрана почти на сто.
            className="block w-fit max-w-full"
            title={`${item.filename} — ${formatBytes(item.size)}`}
          >
            <img
              // В ленте — уменьшенная копия. Полную человек увидит
              // по клику, а здесь она всё равно ужимается стилями
              // до четырёхсот точек: скачивать ради этого мегабайты
              // оригинала — платить за то, чего не видно.
              src={item.thumbUrl ?? item.url}
              alt={item.filename}
              // Размеры известны с сервера, поэтому место под картинку
              // резервируется заранее — лента не прыгает при загрузке.
              // Берём размеры оригинала: пропорции у превью те же,
              // а место надо занять до того, как оно приедет.
              width={item.width ?? undefined}
              height={item.height ?? undefined}
              // Ленивая загрузка: картинки выше по переписке
              // не качаются, пока до них не долистают.
              loading="lazy"
              decoding="async"
              className="h-auto max-h-[350px] w-auto max-w-full rounded-lg object-contain md:max-w-[400px]"
            />
          </button>
        ) : (
          <a
            key={item.id}
            href={item.url}
            download={item.filename}
            className="flex w-fit max-w-full items-center gap-3 rounded-lg border border-line bg-rail p-3 hover:border-accent md:max-w-[400px]"
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
        <ImageViewer
          url={zoomed.url}
          filename={zoomed.filename}
          onClose={() => setZoomed(null)}
        />
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
            <img
              src={item.thumbUrl ?? item.url}
              alt={item.filename}
              className="size-24 rounded object-cover"
            />
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
