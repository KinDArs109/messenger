import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MailCheck } from "lucide-react";
import type { LoginPendingDto, PrivateUser } from "@messenger/shared";
import { api, ApiError, setAccessToken } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/Button";

/**
 * Второй шаг входа: код из письма.
 *
 * Пароль отвечает только на вопрос «знаете ли вы секрет». Секреты
 * утекают — и почти никогда отсюда, а с других сайтов, где пароль
 * оказался тем же. Поэтому дальше нужен ящик: не «кто знает», а «кто
 * дотягивается».
 *
 * Экран нарочно похож на подтверждение почты: те же шесть цифр, то же
 * место, та же кнопка «отправить ещё раз». Человеку не нужно понимать
 * разницу между «подтвердите адрес» и «подтвердите вход» — ему нужно
 * ввести цифры из письма.
 */
export function LoginCodeStep({
  шаг,
  onBack,
}: {
  шаг: LoginPendingDto;
  onBack: () => void;
}) {
  const setMe = useStore((s) => s.setMe);

  const [code, setCode] = useState("");
  const [адрес, setАдрес] = useState(шаг.email);
  const [pending, setPending] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(
    шаг.sent ? null : "Письмо отправить не удалось — попробуйте ещё раз.",
  );

  const поле = useRef<HTMLInputElement>(null);
  useEffect(() => {
    поле.current?.focus();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const r = await api.post<{ user: PrivateUser; accessToken: string }>("/auth/login/confirm", {
        ticket: шаг.ticket,
        code,
      });
      setAccessToken(r.accessToken);
      setMe(r.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось проверить код");
      setCode("");
      поле.current?.focus();
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    setSending(true);
    setError(null);
    setNote(null);
    try {
      const r = await api.post<{ sent: boolean; email: string; mailEnabled: boolean }>(
        "/auth/login/resend",
        { ticket: шаг.ticket },
      );
      setАдрес(r.email);
      setNote(
        r.sent
          ? "Отправили ещё раз. Загляните в «Спам» — там оно чаще всего и лежит."
          : r.mailEnabled
            ? "Письмо отправить не удалось — попробуйте через минуту."
            : "Отправка почты пока не настроена на сервере.",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl bg-sidebar p-8 shadow-2xl">
      <div className="mb-5 flex justify-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-accent/15">
          <MailCheck className="size-7 text-accent" />
        </div>
      </div>

      <h1 className="text-center text-2xl font-semibold text-bright">Код из письма</h1>
      <p className="mt-2 mb-6 text-center text-muted">
        Мы отправили шесть цифр на <span className="text-body">{адрес}</span>. Код действует
        пятнадцать минут.
      </p>

      <input
        ref={поле}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="000000"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="Код из письма"
        className="w-full rounded-md border border-rail bg-rail p-3 text-center font-mono text-2xl tracking-[0.4em] text-body outline-none transition-colors focus:border-accent"
      />

      <AnimatePresence initial={false}>
        {(error ?? note) && (
          <motion.p
            role={error ? "alert" : undefined}
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: "auto", marginTop: 12 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.2 }}
            className={
              error
                ? "rounded-md bg-danger/10 px-3 py-2 text-sm text-danger"
                : "text-sm text-muted"
            }
          >
            {error ?? note}
          </motion.p>
        )}
      </AnimatePresence>

      <Button type="submit" loading={pending} disabled={code.length !== 6} className="mt-5 w-full">
        Войти
      </Button>

      <div className="mt-4 flex items-center justify-center gap-4 text-sm">
        <button
          type="button"
          onClick={() => void resend()}
          disabled={sending}
          className="text-link hover:underline disabled:opacity-50"
        >
          Отправить ещё раз
        </button>
        <button type="button" onClick={onBack} className="text-muted hover:underline">
          Назад
        </button>
      </div>
    </form>
  );
}
