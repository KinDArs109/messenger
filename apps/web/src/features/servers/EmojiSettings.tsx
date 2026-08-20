import { useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { EMOJI_LIMIT, EMOJI_NAME, type EmojiDto, type ServerDto } from "@messenger/shared";
import { api, getAccessToken } from "@/lib/api";
import { useStore } from "@/lib/store";

/**
 * Свои эмодзи сервера — награда третьего уровня.
 *
 * Заводит любой участник, а не только владелец: эмодзи — общая шутка,
 * а не настройка сервера, и просить разрешения ради картинки странно.
 * Убрать может тот, кто завёл; чужое — только тот, кому позволено
 * править сервер, иначе неудачное эмодзи останется навсегда, если
 * автор ушёл.
 */
export function EmojiSettings({ server }: { server: ServerDto }) {
  const setServerEmoji = useStore((s) => s.setServerEmoji);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const emoji = server.emoji ?? [];
  const свободно = EMOJI_LIMIT - emoji.length;
  const имяГодится = EMOJI_NAME.test(name.trim().toLowerCase());

  async function add(file: File) {
    setBusy(true);
    setError(null);
    try {
      // Сначала картинка, потом само эмодзи: сервер обрежет её до
      // нужного размера и вернёт ссылку, а имя мы отправим следом.
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/uploads/emoji", {
        method: "POST",
        headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
        body,
      });
      const data = (await res.json()) as { url?: string; error?: { message: string } };
      if (!res.ok || !data.url) throw new Error(data.error?.message ?? "Картинка не загрузилась");

      const r = await api.post<{ emoji: EmojiDto[] }>(`/servers/${server.id}/emoji`, {
        name: name.trim().toLowerCase(),
        url: data.url,
      });
      setServerEmoji({ serverId: server.id, emoji: r.emoji });
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      const r = await api.delete<{ emoji: EmojiDto[] }>(`/servers/${server.id}/emoji/${id}`);
      setServerEmoji({ serverId: server.id, emoji: r.emoji });
    } catch {
      setError("Не удалось убрать");
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Пишутся в сообщении как <code className="text-body">:название:</code>. Свободно{" "}
        {свободно} из {EMOJI_LIMIT}.
      </p>

      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="название"
          aria-label="Название эмодзи"
          maxLength={32}
          className="min-w-0 flex-1 rounded-md bg-input px-3 py-2 text-body outline-none focus:ring-2 focus:ring-accent"
        />
        <input
          ref={picker}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void add(file);
          }}
        />
        <button
          type="button"
          onClick={() => picker.current?.click()}
          // Кнопка ждёт имени: загрузить картинку и только потом
          // спрашивать, как её звать, — значит оставить на сервере
          // мусор, если человек передумает.
          disabled={!имяГодится || busy || свободно <= 0}
          title={
            свободно <= 0
              ? "Больше не поместится"
              : имяГодится
                ? "Выбрать картинку"
                : "Сначала имя: латиница, цифры и подчёркивание"
          }
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
        >
          <Upload className="size-4" />
          Добавить
        </button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {emoji.length === 0 ? (
        <p className="text-sm text-muted">Пока ни одного.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-1.5">
          {emoji.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-md bg-rail px-2 py-1.5"
            >
              <img src={item.url} alt="" className="size-7 shrink-0 object-contain" />
              <span className="min-w-0 flex-1 truncate text-sm text-body">:{item.name}:</span>
              <button
                type="button"
                onClick={() => void remove(item.id)}
                title="Убрать"
                aria-label={`Убрать :${item.name}:`}
                className="shrink-0 rounded p-1 text-muted hover:bg-hover hover:text-danger"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
