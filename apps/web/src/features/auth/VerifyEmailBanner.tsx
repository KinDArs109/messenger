import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MailWarning, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Dialog } from "@/components/Dialog";
import { Button } from "@/components/ui/Button";

/** Напоминание о неподтверждённой почте.
 *
 *  Полоска, а не блокировка входа: мессенджер для своих, и человек,
 *  у которого письмо ушло в спам, не должен оказаться заперт снаружи.
 *  Закрыть её можно, но только до перезагрузки — иначе напоминание,
 *  спрятанное один раз, не вернётся никогда. */
export function VerifyEmailBanner() {
  const me = useStore((s) => s.me);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);

  if (!me || me.emailVerified || hidden) return null;

  return (
    <>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }}
        transition={{ duration: 0.25 }}
        className="flex shrink-0 items-center gap-3 bg-idle/15 px-4 py-2 text-sm"
      >
        <MailWarning className="size-4 shrink-0 text-idle" />
        <span className="min-w-0 flex-1 truncate text-body">
          Почта <span className="font-medium">{me.email}</span> не подтверждена
        </span>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Подтвердить
        </Button>
        <button
          type="button"
          onClick={() => setHidden(true)}
          aria-label="Скрыть напоминание"
          className="rounded p-1 text-muted hover:bg-hover hover:text-bright"
        >
          <X className="size-4" />
        </button>
      </motion.div>

      <AnimatePresence>
        {open && <VerifyDialog onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </>
  );
}

function VerifyDialog({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me);
  const setMe = useStore((s) => s.setMe);

  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function resend() {
    setSending(true);
    setError(null);
    setNote(null);
    try {
      const r = await api.post<{ sent: boolean; mailEnabled: boolean }>("/auth/email/send");
      setNote(
        r.sent
          ? "Письмо отправлено. Проверьте папку «Спам»."
          : r.mailEnabled
            ? "Письмо отправить не удалось — попробуйте позже."
            : "Отправка почты пока не настроена на сервере.",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить");
    } finally {
      setSending(false);
    }
  }

  async function submit() {
    setPending(true);
    setError(null);
    try {
      await api.post("/auth/email/verify", { code });
      if (me) setMe({ ...me, emailVerified: true });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось проверить код");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog title="Подтверждение почты" onClose={onClose}>
      <p className="mb-4 text-sm text-muted">
        Мы отправили шесть цифр на <span className="text-body">{me?.email}</span>. Код действует
        пятнадцать минут.
      </p>

      <input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="000000"
        inputMode="numeric"
        autoComplete="one-time-code"
        className="w-full rounded-md border border-rail bg-rail p-2.5 text-center font-mono text-xl tracking-[0.4em] text-body outline-none transition-colors focus:border-accent"
      />

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {note && !error && <p className="mt-3 text-sm text-muted">{note}</p>}

      <div className="mt-5 flex items-center gap-3">
        <Button loading={pending} disabled={code.length !== 6} onClick={() => void submit()}>
          Подтвердить
        </Button>
        <Button variant="ghost" loading={sending} onClick={() => void resend()}>
          Отправить ещё раз
        </Button>
      </div>
    </Dialog>
  );
}
