import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LIMITS, type PrivateUser, type SignupPolicyDto } from "@messenger/shared";
import { api, ApiError, setAccessToken } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { ForgotPassword } from "./ForgotPassword";

interface AuthResponse {
  user: PrivateUser;
  accessToken: string;
}

type Mode = "login" | "register";

const TABS = [
  { value: "login" as const, label: "Вход" },
  { value: "register" as const, label: "Регистрация" },
];

/** Вход и регистрация — один экран с вкладками, а не два роута.
 *  Человек, пришедший по приглашению, чаще всего ещё не зарегистрирован,
 *  и лишний переход между страницами здесь только мешает. */
/** Код приглашения из адреса, если человек пришёл по ссылке.
 *  Тогда спрашивать его ещё раз не надо — он уже в руках. */
function inviteCodeFromUrl(): string {
  return /^\/invite\/([a-z0-9]{4,16})\/?$/.exec(location.pathname)?.[1] ?? "";
}

export function AuthScreen({ hint }: { hint?: ReactNode }) {
  const setMe = useStore((s) => s.setMe);
  const [mode, setMode] = useState<Mode>("login");
  const [login, setLogin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [byCode, setByCode] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [signupCode, setSignupCode] = useState(inviteCodeFromUrl);
  const [codeRequired, setCodeRequired] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const isRegister = mode === "register";

  // Спрашиваем один раз при открытии экрана: поле кода не должно
  // мелькать у тех, кому оно не нужно.
  useEffect(() => {
    void api
      .get<SignupPolicyDto>("/auth/signup-policy")
      .then((r) => setCodeRequired(r.codeRequired))
      .catch(() => undefined);
  }, []);

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setError(null);
    setFields({});
    setByCode(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFields({});
    try {
      const path = isRegister ? "/auth/register" : byCode ? "/auth/login-code" : "/auth/login";
      const body = isRegister
        ? { email, password, username, displayName: displayName || username, signupCode }
        : byCode
          ? { login, code }
          : { login, password };
      const r = await api.post<AuthResponse>(path, body);
      setAccessToken(r.accessToken);
      setMe(r.user);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFields(err.fields ?? {});
      } else {
        setError("Сервер недоступен. Проверьте, запущен ли он.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    // flex-1, а не min-h-screen: в приложении сверху стоит своя полоса
    // окна, и «на всю высоту экрана» означало бы высоту экрана плюс
    // полоса — то есть лишнюю прокрутку.
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-chat p-4">
      <motion.div
        className="w-full max-w-[440px]"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.2, 0, 0.2, 1] }}
      >
        {hint}

        {forgot ? (
          <div className="rounded-xl bg-sidebar p-8 shadow-2xl">
            <ForgotPassword onBack={() => setForgot(false)} />
          </div>
        ) : (
        <form onSubmit={submit} className="rounded-xl bg-sidebar p-8 shadow-2xl">
          <Tabs items={TABS} value={mode} onChange={switchMode} className="mb-7" />

          <h1 className="text-center text-2xl font-semibold text-bright">
            {isRegister ? "Создать учётную запись" : "С возвращением!"}
          </h1>
          <p className="mt-2 mb-6 text-center text-muted">
            {isRegister ? "Займёт меньше минуты" : "Рады видеть вас снова"}
          </p>

          {/* Ошибка не появляется рывком: высота анимируется, поэтому
              поля ниже не подпрыгивают в момент её показа. */}
          <AnimatePresence initial={false}>
            {error && (
              <motion.p
                role="alert"
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: "auto", marginBottom: 16 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden rounded-md bg-danger/10 px-3 py-2 text-sm text-danger"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          {isRegister ? (
            <Field label="Электронная почта" error={fields.email}>
              <Input type="email" value={email} onChange={setEmail} autoComplete="username" />
            </Field>
          ) : (
            <Field label="Почта или имя пользователя" error={fields.login}>
              {/* type="text", а не "email": браузер не должен отвергать
                  логин за отсутствие собаки. */}
              <Input value={login} onChange={setLogin} autoComplete="username" />
            </Field>
          )}

          {/* Поля регистрации выезжают, а не возникают: так видно, что
              форма та же самая, просто в ней стало больше. */}
          <AnimatePresence initial={false}>
            {isRegister && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: [0.2, 0, 0.2, 1] }}
                className="overflow-hidden"
              >
                <Field label="Отображаемое имя" error={fields.displayName}>
                  <Input
                    value={displayName}
                    onChange={setDisplayName}
                    autoComplete="nickname"
                    maxLength={LIMITS.displayName.max}
                  />
                </Field>
                <Field
                  label="Имя пользователя"
                  error={fields.username}
                  note="латиница, цифры, точка и подчёркивание — по нему вас упоминают"
                >
                  <Input
                    value={username}
                    onChange={(v) => setUsername(v.toLowerCase())}
                    autoComplete="off"
                    maxLength={LIMITS.username.max}
                  />
                </Field>
              </motion.div>
            )}
          </AnimatePresence>

          {byCode ? (
            <Field
              label="Код из приложения"
              error={fields.code}
              note="шесть цифр из Google Authenticator"
            >
              <Input
                value={code}
                onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
                autoComplete="one-time-code"
              />
            </Field>
          ) : (
            <Field label="Пароль" error={fields.password}>
              <PasswordInput
                value={password}
                onChange={setPassword}
                autoComplete={isRegister ? "new-password" : "current-password"}
              />
            </Field>
          )}

          {/* Код приглашения — только при регистрации и только если
              сервер закрыт. Пришедшему по ссылке он уже подставлен. */}
          {isRegister && codeRequired && (
            <Field
              label="Код приглашения"
              error={fields.signupCode}
              note="спросите у того, кто вас позвал"
            >
              <Input value={signupCode} onChange={setSignupCode} autoComplete="off" />
            </Field>
          )}

          <Button type="submit" size="lg" full loading={pending}>
            {pending ? "Минуту…" : isRegister ? "Продолжить" : "Вход"}
          </Button>

          {!isRegister && (
            <div className="mt-4 flex flex-col items-center gap-1.5 text-[13px]">
              <button
                type="button"
                onClick={() => setForgot(true)}
                className="text-link hover:underline"
              >
                Забыли пароль?
              </button>
              <button
                type="button"
                onClick={() => {
                  setByCode(!byCode);
                  setError(null);
                  setFields({});
                }}
                className="text-muted hover:text-body hover:underline"
              >
                {byCode ? "Войти по паролю" : "Войти по коду из приложения"}
              </button>
            </div>
          )}

        </form>
        )}
      </motion.div>
    </div>
  );
}

function Input({
  value,
  onChange,
  type = "text",
  autoComplete,
  maxLength,
}: {
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  maxLength?: number;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={autoComplete}
      maxLength={maxLength}
      className="w-full rounded-md border border-rail bg-rail p-2.5 text-body outline-none transition-colors focus:border-accent"
    />
  );
}

function Field({
  label,
  error,
  note,
  children,
}: {
  label: string;
  error?: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <label className="mb-5 block">
      <span className="mb-2 block text-xs font-bold tracking-wide text-muted uppercase">
        {label}
        {error && <span className="text-danger normal-case"> — {error}</span>}
      </span>
      {children}
      {note && !error && <span className="mt-1 block text-xs text-faint">{note}</span>}
    </label>
  );
}
