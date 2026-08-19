import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import { LIMITS, type ServerDto } from "@messenger/shared";
import { api, ApiError } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Dialog } from "@/components/Dialog";
import { Button } from "@/components/ui/Button";
import { PicturePicker } from "@/components/PicturePicker";
import { BoostPanel } from "./BoostPanel";
import { avatarColor, initial } from "@/lib/utils";

/** Ответ на правку сервера. Каналы и роль сервер обратно не шлёт —
 *  меняется только то, что мы просили. */
type Updated = {
  server: { id: string; name: string; iconUrl: string | null; bannerUrl: string | null };
};

export function ServerSettingsDialog({
  server,
  onClose,
}: {
  server: ServerDto;
  onClose: () => void;
}) {
  const updateServer = useStore((s) => s.updateServer);

  const [name, setName] = useState(server.name);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const trimmed = name.trim();
  const dirty = trimmed !== server.name && trimmed.length > 0;

  async function rename(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldError(null);
    try {
      const r = await api.patch<Updated>(`/servers/${server.id}`, { name: trimmed });
      updateServer(r.server);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldError(err.fields?.name ?? null);
      } else {
        setError("Не удалось сохранить");
      }
    } finally {
      setPending(false);
    }
  }

  /** Значок сохраняется сразу по выбору — как и аватар в профиле. */
  async function setIcon(iconUrl: string | null) {
    const r = await api.patch<Updated>(`/servers/${server.id}`, { iconUrl });
    updateServer(r.server);
  }

  /** Баннер — то же самое, но появляется он только со второго уровня. */
  async function setBanner(bannerUrl: string | null) {
    const r = await api.patch<Updated>(`/servers/${server.id}`, { bannerUrl });
    updateServer(r.server);
  }

  return (
    <Dialog title="Настройки сервера" onClose={onClose}>
      <form onSubmit={rename} className="space-y-4">
        <Field label="Значок">
          <PicturePicker
            url={server.iconUrl}
            onChange={setIcon}
            shape="square"
            fallback={
              <span
                aria-hidden
                className="flex size-full items-center justify-center rounded-2xl text-3xl font-semibold text-white"
                style={{ background: avatarColor(server.id) }}
              >
                {initial(server.name)}
              </span>
            }
          />
        </Field>

        {/* Баннер — награда второго уровня. Пока его нет, места
            в настройках он тоже не занимает: пустая недоступная
            строка раздражает сильнее, чем её отсутствие. */}
        {server.level >= 2 && (
          <Field label="Баннер над списком каналов">
            <PicturePicker
              url={server.bannerUrl}
              onChange={setBanner}
              shape="square"
              fallback={
                <span
                  aria-hidden
                  className="flex size-full items-center justify-center rounded-2xl bg-raised text-xs text-faint"
                >
                  нет
                </span>
              }
            />
          </Field>
        )}

        <Field label="Название" error={fieldError}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={LIMITS.serverName.max}
            className="w-full rounded-md bg-input px-3 py-2 text-body outline-none focus:ring-2 focus:ring-accent"
          />
        </Field>

        {error && (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" loading={pending} disabled={!dirty}>
            Сохранить
          </Button>
          <AnimatePresence>
            {saved && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1 text-sm text-online"
              >
                <Check className="size-4" />
                Сохранено
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </form>

      {/* Поддержка сервера — под настройками, отдельным блоком:
          это не настройка, а то, что делает любой участник, включая
          тех, кому править сервер нельзя. */}
      <div className="mt-6 border-t border-line pt-4">
        <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">
          Поддержка сервера
        </h3>
        <BoostPanel server={server} />
      </div>
    </Dialog>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-bold tracking-wide text-muted uppercase">{label}</span>
      {children}
      {error && <span className="block text-sm text-danger">{error}</span>}
    </label>
  );
}
