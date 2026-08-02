import { useState } from "react";
import { Hash, Volume2 } from "lucide-react";
import { LIMITS, type ChannelDto, type ChannelType } from "@messenger/shared";
import { api, ApiError } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Dialog, DialogButton, DialogField, dialogInputClass } from "@/components/Dialog";
import { cn } from "@/lib/utils";

export function CreateChannelDialog({
  serverId,
  initialType = "TEXT",
  onClose,
}: {
  serverId: string;
  initialType?: ChannelType;
  onClose: () => void;
}) {
  const [type, setType] = useState<ChannelType>(initialType);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  async function create() {
    setPending(true);
    setError(null);
    setFieldError(undefined);
    try {
      const r = await api.post<{ channel: ChannelDto }>(`/servers/${serverId}/channels`, {
        // Пробелы в имени канала заменяем дефисами — так принято
        // везде, и на это рассчитывают упоминания вида #канал.
        name: name.trim().toLowerCase().replace(/\s+/g, "-"),
        type,
      });

      const store = useStore.getState();
      store.setServers(
        store.servers.map((s) =>
          s.id === serverId ? { ...s, channels: [...s.channels, r.channel] } : s,
        ),
      );
      if (r.channel.type === "TEXT") store.selectChannel(r.channel.id);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldError(err.fields?.name);
      } else {
        setError("Не удалось создать канал");
      }
      setPending(false);
    }
  }

  return (
    <Dialog
      title="Создать канал"
      onClose={onClose}
      footer={
        <>
          <DialogButton variant="ghost" onClick={onClose}>
            Отмена
          </DialogButton>
          <DialogButton onClick={() => void create()} disabled={pending || !name.trim()}>
            {pending ? "Создаём…" : "Создать канал"}
          </DialogButton>
        </>
      }
    >
      {error && !fieldError && (
        <p role="alert" className="mb-3 rounded-sm bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <fieldset className="mb-4">
        <legend className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">
          Тип канала
        </legend>
        <div className="space-y-2">
          <TypeOption
            active={type === "TEXT"}
            onSelect={() => setType("TEXT")}
            icon={<Hash className="size-5 text-faint" />}
            title="Текстовый"
            note="Переписка, файлы, ссылки"
          />
          <TypeOption
            active={type === "VOICE"}
            onSelect={() => setType("VOICE")}
            icon={<Volume2 className="size-5 text-faint" />}
            title="Голосовой"
            note="Разговор голосом"
          />
        </div>
      </fieldset>

      <DialogField label="Название канала" error={fieldError}>
        <div className="flex items-center gap-2 rounded-sm border border-rail bg-rail px-2.5">
          {type === "VOICE" ? (
            <Volume2 className="size-4 shrink-0 text-faint" />
          ) : (
            <Hash className="size-4 shrink-0 text-faint" />
          )}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) void create();
            }}
            placeholder="новый-канал"
            maxLength={LIMITS.channelName.max}
            className={cn(dialogInputClass, "border-0 bg-transparent px-0")}
          />
        </div>
      </DialogField>
    </Dialog>
  );
}

function TypeOption({
  active,
  onSelect,
  icon,
  title,
  note,
}: {
  active: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  note: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center gap-3 rounded p-2.5 text-left",
        active ? "bg-active" : "bg-rail hover:bg-hover",
      )}
    >
      {icon}
      <span className="flex-1">
        <span className="block text-sm font-medium text-bright">{title}</span>
        <span className="block text-xs text-muted">{note}</span>
      </span>
      <span
        aria-hidden
        className={cn(
          "size-4 rounded-full border-2",
          active ? "border-accent bg-accent" : "border-faint",
        )}
      />
    </button>
  );
}
