import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { AttachmentDto } from "@messenger/shared";

/**
 * Голосовое сообщение в ленте.
 *
 * Свой проигрыватель, а не `<audio controls>`: системный выглядит
 * по-разному в каждом браузере, занимает всю ширину и приносит с собой
 * громкость и меню скачивания, которых в ленте не надо. Здесь нужно
 * ровно три вещи — играть, видеть, сколько осталось, и уметь перемотать.
 *
 * Длительность берём из вложения, а не из самого файла: браузер
 * не кладёт её в запись, и до конца первого прослушивания она была бы
 * «бесконечностью».
 */
export function VoicePlayer({ item }: { item: AttachmentDto }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);

  const всего = item.duration ?? 0;

  useEffect(() => {
    const el = audio.current;
    if (!el) return;

    const onTime = () => setAt(el.currentTime);
    const onEnd = () => {
      setPlaying(false);
      setAt(0);
      // Перемотка в начало: второй раз нажимают «играть», а не ищут,
      // куда вернуть ползунок.
      el.currentTime = 0;
    };

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
    };
  }, []);

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }

  const время = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const доля = всего > 0 ? Math.min(1, at / всего) : 0;

  return (
    <div className="mt-1 flex w-fit max-w-full items-center gap-2 rounded-lg bg-raised px-2 py-1.5">
      {/* preload="none": в ленте таких сообщений бывает десяток,
          и качать их все ради полоски незачем — файл поедет, когда
          нажмут «играть». */}
      <audio ref={audio} src={item.url} preload="none" />

      <button
        type="button"
        onClick={toggle}
        title={playing ? "Пауза" : "Играть"}
        aria-label={playing ? "Пауза" : "Играть голосовое сообщение"}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-white hover:bg-accent-hover"
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </button>

      {/* Полоса — она же перемотка. Диапазон в сотых долях: сдвиг
          в одну секунду на записи в двадцать секунд иначе прыгал бы
          на двадцатую часть длины. */}
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={доля}
        onChange={(event) => {
          const el = audio.current;
          if (!el || всего <= 0) return;
          const next = Number(event.target.value) * всего;
          el.currentTime = next;
          setAt(next);
        }}
        aria-label="Перемотать"
        className="h-1 w-40 accent-accent md:w-56"
      />

      <span className="shrink-0 text-xs tabular-nums text-muted">
        {время(playing || at > 0 ? at : всего)}
      </span>
    </div>
  );
}
