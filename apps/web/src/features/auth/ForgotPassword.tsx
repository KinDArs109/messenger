import { useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { ArrowLeft, MailCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { PasswordInput } from "@/components/ui/PasswordInput";

/** Восстановление пароля в два шага на одном экране.
 *
 *  Отдельной страницы со ссылкой из письма нет намеренно: ссылка
 *  требует, чтобы почта открывалась на том же устройстве, где стоит
 *  приложение. Код можно переписать с телефона руками. */
export function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<"ask" | "code">("ask");
  const [login, setLogin] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const r = await api.post<{ mailEnabled: boolean }>("/auth/password/forgot", { login });
      if (!r.mailEnabled) {
        setError("Отправка почты на сервере не настроена — обратитесь к владельцу.");
        return;
      }
      setStep("code");
      // Формулировка обтекаемая намеренно: сервер не сообщает, есть ли
      // такой пользователь, иначе форма стала бы способом проверять
      // чужие адреса на регистрацию.
      setNote("Если такая учётная запись есть, письмо с кодом уже ушло. Загляните и в «Спам».");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить");
    } finally {
      setPending(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.post("/auth/password/reset", { login, code, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сменить пароль");
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
      >
        <MailCheck className="mx-auto mb-3 size-10 text-online" />
        <h1 className="text-xl font-semibold text-bright">Пароль изменён</h1>
        <p className="mt-2 mb-6 text-sm text-muted">
          Все прежние входы отозваны — на других устройствах придётся войти заново.
        </p>
        <Button full size="lg" onClick={onBack}>
          Войти
        </Button>
      </motion.div>
    );
  }

  return (
    <form onSubmit={step === "ask" ? requestCode : submit}>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex items-center gap-1.5 text-sm text-muted hover:text-body"
      >
        <ArrowLeft className="size-4" />
        Назад ко входу
      </button>

      <h1 className="text-xl font-semibold text-bright">Восстановление пароля</h1>
      <p className="mt-1 mb-5 text-sm text-muted">
        {step === "ask"
          ? "Пришлём код на почту, указанную при регистрации."
          : "Введите код из письма и придумайте новый пароль."}
      </p>

      <label className="mb-4 block">
        <span className="mb-2 block text-xs font-bold tracking-wide text-muted uppercase">
          Почта или имя пользователя
        </span>
        <input
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          disabled={step === "code"}
          autoComplete="username"
          className="w-full rounded-md border border-rail bg-rail p-2.5 text-body outline-none transition-colors focus:border-accent disabled:opacity-60"
        />
      </label>

      {step === "code" && (
        <>
          <label className="mb-4 block">
            <span className="mb-2 block text-xs font-bold tracking-wide text-muted uppercase">
              Код из письма
            </span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              className="w-full rounded-md border border-rail bg-rail p-2.5 text-center font-mono text-lg tracking-[0.4em] text-body outline-none transition-colors focus:border-accent"
            />
          </label>

          <label className="mb-5 block">
            <span className="mb-2 block text-xs font-bold tracking-wide text-muted uppercase">
              Новый пароль
            </span>
            <PasswordInput
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            />
          </label>
        </>
      )}

      {error && (
        <p role="alert" className="mb-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {note && !error && <p className="mb-4 text-sm text-muted">{note}</p>}

      <Button
        type="submit"
        size="lg"
        full
        loading={pending}
        disabled={step === "ask" ? login.length < 3 : code.length !== 6 || password.length < 8}
      >
        {step === "ask" ? "Прислать код" : "Сменить пароль"}
      </Button>
    </form>
  );
}
