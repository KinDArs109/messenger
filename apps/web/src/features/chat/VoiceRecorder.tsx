import { useEffect, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";
import type { AttachmentDto } from "@messenger/shared";
import { getAccessToken } from "@/lib/api";

/**
 * Запись голосового сообщения.
 *
 * Нажал — пишет, нажал ещё раз — отправляет. Не «удерживать»: держать
 * палец сорок секунд неудобно, а случайно отпустить — обидно. Отменить
 * можно крестиком рядом, и это единственный способ выбросить запись:
 * отправка нажатием той же кнопки, которой начинали.
 *
 * Длительность считаем здесь и отправляем вместе с файлом. Иначе никак:
 * Chrome пишет webm без длительности в заголовке, и проигрыватель
 * показывает «бесконечность», пока не домотает запись до конца.
 */
export function VoiceRecorder({
  onSend,
  onError,
}: {
  onSend: (attachment: AttachmentDto) => void;
  onError: (message: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  /** Отменили — значит записанное выбрасываем, а не отправляем. */
  const cancelled = useRef(false);

  // Секунды идут своим таймером, а не по событиям записи: события
  // приходят кусками по несколько сотен миллисекунд, и счётчик по ним
  // дёргался бы.
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  // Уходя со страницы посреди записи, микрофон надо отпустить: иначе
  // в системе остаётся гореть значок «идёт запись».
  useEffect(() => {
    return () => {
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);

      chunks.current = [];
      cancelled.current = false;

      media.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };

      media.onstop = () => {
        // Микрофон отпускаем всегда — и когда отправили, и когда
        // передумали.
        stream.getTracks().forEach((track) => track.stop());
        const длина = seconds;
        if (cancelled.current || chunks.current.length === 0) return;
        void upload(new Blob(chunks.current, { type: media.mimeType }), длина);
      };

      media.start(250);
      recorder.current = media;
      setSeconds(0);
      setRecording(true);
    } catch {
      onError("Микрофон недоступен — проверьте разрешение");
    }
  }

  function stop(send: boolean) {
    cancelled.current = !send;
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
  }

  async function upload(blob: Blob, длина: number) {
    // Меньше секунды — это промах по кнопке, а не сообщение.
    if (длина < 1) return;

    setBusy(true);
    try {
      const body = new FormData();
      body.append("duration", String(длина));
      body.append("file", blob, "voice.weba");

      const res = await fetch("/api/uploads/voice", {
        method: "POST",
        headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
        body,
      });
      const data = (await res.json()) as
        | { attachment: AttachmentDto }
        | { error: { message: string } };
      if (!res.ok) throw new Error("error" in data ? data.error.message : "Не отправилось");
      onSend((data as { attachment: AttachmentDto }).attachment);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Запись не отправилась");
    } finally {
      setBusy(false);
      setSeconds(0);
    }
  }

  // Записи в браузере может не быть вовсе — тогда и кнопки нет:
  // кнопка, которая всегда отвечает отказом, хуже её отсутствия.
  if (typeof MediaRecorder === "undefined") return null;

  if (!recording) {
    return (
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        title={busy ? "Отправляю…" : "Записать голосовое"}
        aria-label="Записать голосовое сообщение"
        className="shrink-0 rounded p-2 text-muted hover:bg-hover hover:text-bright disabled:opacity-40"
      >
        <Mic className="size-5" />
      </button>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => stop(false)}
        title="Отменить запись"
        aria-label="Отменить запись"
        className="rounded p-2 text-muted hover:bg-hover hover:text-danger"
      >
        <X className="size-5" />
      </button>

      {/* Красная точка и время: без них непонятно, идёт ли запись
          вообще, — а это первое, что хочется знать. */}
      <span className="flex items-center gap-1.5 px-1 text-sm tabular-nums text-danger">
        <span className="size-2 animate-pulse rounded-full bg-danger" />
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
      </span>

      <button
        type="button"
        onClick={() => stop(true)}
        title="Отправить запись"
        aria-label="Отправить запись"
        className="rounded-full bg-accent p-2 text-white hover:bg-accent-hover"
      >
        <Square className="size-4" />
      </button>
    </span>
  );
}
