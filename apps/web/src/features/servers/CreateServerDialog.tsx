import { useState } from "react";
import { LIMITS, type ServerDto } from "@messenger/shared";
import { api, ApiError } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Dialog, DialogButton, DialogField, dialogInputClass } from "@/components/Dialog";

export function CreateServerDialog({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me);
  const [name, setName] = useState(me ? `Сервер ${me.displayName}` : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  async function create() {
    setPending(true);
    setError(null);
    setFieldError(undefined);
    try {
      const r = await api.post<{ server: ServerDto }>("/servers", { name: name.trim() });
      const store = useStore.getState();
      // Сервер приходит целиком, вместе с ролью, уровнем и списком
      // поддержавших: собирать его по кусочкам на клиенте — верный
      // способ однажды забыть поле и уронить приложение.
      store.setServers([...store.servers, r.server]);
      store.selectServer(r.server.id);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldError(err.fields?.name);
      } else {
        setError("Не удалось создать сервер");
      }
      setPending(false);
    }
  }

  return (
    <Dialog
      title="Создать сервер"
      description="Сервер — это место для вас и ваших друзей. Название можно поменять потом."
      onClose={onClose}
      footer={
        <>
          <DialogButton variant="ghost" onClick={onClose}>
            Отмена
          </DialogButton>
          <DialogButton onClick={() => void create()} disabled={pending || !name.trim()}>
            {pending ? "Создаём…" : "Создать"}
          </DialogButton>
        </>
      }
    >
      {error && !fieldError && (
        <p role="alert" className="mb-3 rounded-sm bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <DialogField label="Название сервера" error={fieldError}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) void create();
          }}
          maxLength={LIMITS.serverName.max}
          className={dialogInputClass}
        />
      </DialogField>

      <p className="mt-2 text-xs text-faint">
        Внутри сразу появятся текстовый канал «общий» и голосовой «Разговор».
      </p>
    </Dialog>
  );
}
