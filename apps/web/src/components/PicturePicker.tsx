import { useRef, useState, type ReactNode } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { uploadPicture } from "@/lib/pictures";
import { cn } from "@/lib/utils";

interface Props {
  /** Что стоит сейчас. null — картинки нет, показываем запасное. */
  url: string | null;
  /** Чем закрыть пустое место: буква на цветном кружке. Рисуется
   *  снаружи, потому что у профиля и у сервера она разная. */
  fallback: ReactNode;
  onChange: (url: string | null) => Promise<void> | void;
  /** Круглая — у людей, со скруглёнными углами — у серверов:
   *  ровно так они и выглядят в остальном интерфейсе. */
  shape?: "circle" | "square";
  size?: number;
  disabled?: boolean;
}

/**
 * Выбор картинки: аватар человека или значок сервера.
 *
 * Сохраняется сразу по выбору, без отдельной кнопки. Картинку выбирают
 * ровно один раз и осознанно — заставлять после этого нажимать
 * «Сохранить» значит добавить шаг, на котором половина людей уйдёт,
 * решив, что уже всё.
 */
export function PicturePicker({
  url,
  fallback,
  onChange,
  shape = "circle",
  size = 80,
  disabled,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rounded = shape === "circle" ? "rounded-full" : "rounded-2xl";

  async function pick(file: File | undefined) {
    if (!file) return;
    setPending(true);
    setError(null);
    try {
      await onChange(await uploadPicture(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить");
    } finally {
      setPending(false);
      // Обнуляем поле: иначе выбор того же файла второй раз
      // не считается изменением и обработчик не сработает.
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await onChange(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось убрать");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={disabled || pending}
        title="Выбрать картинку"
        className={cn(
          "group relative shrink-0 overflow-hidden disabled:opacity-60",
          rounded,
        )}
        style={{ width: size, height: size }}
      >
        {url ? (
          <img src={url} alt="" className={cn("size-full object-cover", rounded)} />
        ) : (
          fallback
        )}

        {/* Подсказка поверх: без неё непонятно, что по картинке
            вообще можно нажать. */}
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center justify-center bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100 pointer-coarse:bg-black/35",
            rounded,
          )}
        >
          {pending ? (
            <Loader2 className="size-6 animate-spin" />
          ) : (
            <ImagePlus className="size-6" />
          )}
        </span>
      </button>

      <div className="min-w-0 space-y-1">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={disabled || pending}
          className="rounded-md bg-raised px-3 py-1.5 text-sm font-medium text-bright hover:bg-hover disabled:opacity-60"
        >
          {url ? "Заменить" : "Загрузить"}
        </button>
        {url && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={disabled || pending}
            className="ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted hover:text-danger disabled:opacity-60"
          >
            <Trash2 className="size-4" />
            Убрать
          </button>
        )}
        <p className="text-xs text-faint">
          Обрежется в квадрат по центру. PNG, JPEG, GIF или WebP.
        </p>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(e) => void pick(e.target.files?.[0])}
        className="hidden"
      />
    </div>
  );
}
