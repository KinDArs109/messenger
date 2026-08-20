import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MailCheck } from "lucide-react";
import { api, ApiError, setAccessToken } from "@/lib/api";
import { useStore } from "@/lib/store";
import { disconnectSocket } from "@/lib/socket";
import { forgetEverything } from "@/lib/offline";
import { Button } from "@/components/ui/Button";
import { PasswordInput } from "@/components/ui/PasswordInput";

/**
 * Экран подтверждения почты — вместо мессенджера, а не поверх него.
 *
 * Раньше здесь была полоска-напоминание, которую можно закрыть.
 * Закрывали. А потом оказывалось, что адрес, на который приходит
 * восстановление пароля, никто никогда не проверял, — и выяснялось
 * это ровно в тот момент, когда пароль забыт.
 *
 * Заперть человека снаружи навсегда этот экран не может: адрес
 * меняется прямо отсюда — на случай опечатки при регистрации, — и
 * выйти отсюда тоже можно.
 */
export function VerifyEmailGate() {
  const me = useStore((s) => s.me);
  const setMe = useStore((s) => s.setMe);

  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);

  // Код уже отправлен сервером — и при регистрации, и при входе.
  // Кнопка «отправить ещё раз» здесь для писем, которые не дошли,
  // а не для первого шага.
  const поле = useRef<HTMLInputElement>(null);
  useEffect(() => {
    поле.current?.focus();
    // Сокет сюда всё равно не пустят — той же проверкой, что и на
    // /api. Без этого он молча стучался бы в дверь всё время, пока
    // человек ищет письмо.
    disconnectSocket();
  }, []);

  async function resend() {
    setSending(true);
    setError(null);
    setNote(null);
    try {
      const r = await api.post<{ sent: boolean; mailEnabled: boolean }>(
        "/auth/email/send",
      );
      setNote(
        r.sent
          ? "Письмо отправлено. Загляните в папку «Спам» — там оно чаще всего и лежит."
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNote(null);
    try {
      await api.post("/auth/email/verify", { code });
      // Обновляем себя — и экран сменяется мессенджером сам,
      // без перезагрузки: она бы выглядела как сбой.
      if (me) setMe({ ...me, emailVerified: true });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Не удалось проверить код",
      );
      setCode("");
      поле.current?.focus();
    } finally {
      setPending(false);
    }
  }

  async function logout() {
    await api.post("/auth/logout").catch(() => undefined);
    setAccessToken(null);
    disconnectSocket();
    forgetEverything();
    useStore.getState().reset();
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-chat p-4">
      <motion.div
        className="w-full max-w-[440px]"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.2, 0, 0.2, 1] }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {changing ? (
            <motion.div
              key="change"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="rounded-xl bg-sidebar p-8 shadow-2xl"
            >
              <ChangeEmail
                onDone={(email) => {
                  if (me) setMe({ ...me, email });
                  setChanging(false);
                  setCode("");
                  setError(null);
                  setNote("Код отправлен на новый адрес.");
                }}
                onBack={() => setChanging(false)}
              />
            </motion.div>
          ) : (
            <motion.div
              key="verify"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="rounded-xl bg-sidebar p-8 shadow-2xl"
            >
              <form onSubmit={submit}>
                <div className="mb-5 flex justify-center">
                  <div className="flex size-14 items-center justify-center rounded-full bg-accent/15">
                    <MailCheck className="size-7 text-accent" />
                  </div>
                </div>

                <h1 className="text-center text-2xl font-semibold text-bright">
                  Подтвердите почту
                </h1>
                <p className="mt-2 mb-6 text-center text-muted">
                  Мы отправили шесть цифр на{" "}
                  <span className="text-body">{me?.email}</span>. Код действует
                  пятнадцать минут.
                </p>

                <input
                  ref={поле}
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
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

                <Button
                  type="submit"
                  loading={pending}
                  disabled={code.length !== 6}
                  className="mt-5 w-full"
                >
                  Подтвердить
                </Button>

                <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
                  <button
                    type="button"
                    onClick={() => void resend()}
                    disabled={sending}
                    className="text-link hover:underline disabled:opacity-50"
                  >
                    Отправить ещё раз
                  </button>
                  <button
                    type="button"
                    onClick={() => setChanging(true)}
                    className="text-link hover:underline"
                  >
                    Не тот адрес?
                  </button>
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="text-muted hover:underline"
                  >
                    Выйти
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

/** Смена адреса до подтверждения — выход из ловушки для тех, кто
 *  промахнулся буквой при регистрации. Пароль обязателен: адрес
 *  открывает восстановление доступа, и менять его по одной открытой
 *  вкладке нельзя. */
function ChangeEmail({
  onDone,
  onBack,
}: {
  onDone: (email: string) => void;
  onBack: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFields({});
    try {
      const r = await api.post<{ email: string }>("/auth/email/change", {
        email,
        password,
      });
      onDone(r.email);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFields(err.fields ?? {});
      } else {
        setError("Не удалось сменить адрес");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1 className="text-center text-2xl font-semibold text-bright">
        Другой адрес
      </h1>
      <p className="mt-2 mb-6 text-center text-muted">
        Код уйдёт на новый адрес. Старый перестанет быть вашим логином.
      </p>

      <label className="mb-5 block">
        <span className="mb-2 block text-xs font-bold tracking-wide text-muted uppercase">
          Почта
          {fields.email && (
            <span className="text-danger normal-case"> — {fields.email}</span>
          )}
        </span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="w-full rounded-md border border-rail bg-rail p-2.5 text-body outline-none transition-colors focus:border-accent"
        />
      </label>

      <label className="mb-5 block">
        <span className="mb-2 block text-xs font-bold tracking-wide text-muted uppercase">
          Пароль
        </span>
        <PasswordInput
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
      </label>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}

      <Button
        type="submit"
        loading={pending}
        disabled={!email || !password}
        className="w-full"
      >
        Сменить и получить код
      </Button>

      <button
        type="button"
        onClick={onBack}
        className="mt-4 w-full text-center text-sm text-muted hover:underline"
      >
        Назад
      </button>
    </form>
  );
}
