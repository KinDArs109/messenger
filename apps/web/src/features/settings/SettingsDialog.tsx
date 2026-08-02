import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, KeyRound, Laptop, Shield, Sparkles, User } from "lucide-react";
import {
  LIMITS,
  type PrivateUser,
  type SessionDto,
  type TotpSetupDto,
  type TotpStatusDto,
} from "@messenger/shared";
import { api, ApiError } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Dialog } from "@/components/Dialog";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDateTime } from "@/lib/utils";
import { usePreferences } from "@/lib/preferences";

type Tab = "profile" | "look" | "security";

const TABS = [
  { value: "profile" as const, label: "Профиль", icon: <User className="size-4" /> },
  { value: "look" as const, label: "Вид", icon: <Sparkles className="size-4" /> },
  { value: "security" as const, label: "Вход", icon: <Shield className="size-4" /> },
];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("profile");

  return (
    <Dialog title="Настройки" onClose={onClose}>
      <Tabs items={TABS} value={tab} onChange={setTab} className="mb-5" />

      {/* Высота вкладок разная, поэтому переключение анимируем только
          по прозрачности и лёгкому сдвигу: анимация высоты на разном
          содержимом даёт заметный «прыжок» окна. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
        >
          {tab === "profile" && <ProfileTab />}
          {tab === "look" && <LookTab />}
          {tab === "security" && <SecurityTab />}
        </motion.div>
      </AnimatePresence>
    </Dialog>
  );
}

// ─── Профиль ───────────────────────────────────────────────────

function ProfileTab() {
  const me = useStore((s) => s.me);
  const setMe = useStore((s) => s.setMe);

  const [displayName, setDisplayName] = useState(me?.displayName ?? "");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const dirty = displayName !== me?.displayName;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFields({});
    try {
      const r = await api.patch<{ user: PrivateUser }>("/users/me", { displayName });
      setMe(r.user);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFields(err.fields ?? {});
      } else {
        setError("Не удалось сохранить");
      }
    } finally {
      setPending(false);
    }
  }

  if (!me) return null;

  return (
    <form onSubmit={submit} className="space-y-4">
      <Row label="Отображаемое имя" error={fields.displayName}>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={LIMITS.displayName.max}
          className={INPUT}
        />
      </Row>

      {/* Имя пользователя и почта только для чтения. Логин задаётся
          один раз при регистрации: по нему упоминают, находят в друзьях
          и входят — смена рвала бы всё это разом, а освободившееся имя
          мог бы занять кто угодно. */}
      <Row label="Имя пользователя" note="задаётся при регистрации и не меняется">
        <input value={`@${me.username}`} disabled className={`${INPUT} opacity-60`} />
      </Row>

      <Row label="Почта">
        <input value={me.email} disabled className={`${INPUT} opacity-60`} />
      </Row>

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
  );
}

// ─── Внешний вид ───────────────────────────────────────────────

function LookTab() {
  const { prefs, setPref } = usePreferences();

  return (
    <div className="space-y-1">
      <Toggle
        label="Компактная лента"
        note="Меньше отступов между сообщениями — на экран влезает больше"
        checked={prefs.compact}
        onChange={(v) => setPref("compact", v)}
      />
      <Toggle
        label="Меньше движения"
        note="Отключает анимации переходов. Системная настройка тоже учитывается"
        checked={prefs.reducedMotion}
        onChange={(v) => setPref("reducedMotion", v)}
      />
      <Toggle
        label="Показывать время у каждого сообщения"
        note="Иначе время видно только у первого в группе"
        checked={prefs.alwaysTime}
        onChange={(v) => setPref("alwaysTime", v)}
      />
    </div>
  );
}

// ─── Вход и устройства ─────────────────────────────────────────

/** Одноразовые коды.
 *
 *  Это не второй фактор, а запасной первый: способ войти, когда пароль
 *  забыт. Отсюда и предупреждение — подключая коды, человек соглашается,
 *  что доступ к его телефону равен доступу к учётной записи. */
function TotpSection() {
  const [status, setStatus] = useState<TotpStatusDto | null>(null);
  const [setup, setSetup] = useState<TotpSetupDto | null>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<TotpStatusDto>("/auth/totp")
      .then(setStatus)
      .catch(() => setStatus({ enabled: false, enabledAt: null }));
  }, []);

  async function begin() {
    setPending(true);
    setError(null);
    try {
      setSetup(await api.post<TotpSetupDto>("/auth/totp/setup"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось получить ключ");
    } finally {
      setPending(false);
    }
  }

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      setStatus(await api.post<TotpStatusDto>("/auth/totp/enable", { code }));
      setSetup(null);
      setCode("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось подключить");
    } finally {
      setPending(false);
    }
  }

  if (!status) return <Skeleton className="h-20" />;

  return (
    <div className="mb-6 rounded-md bg-rail p-3">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 shrink-0 text-faint" />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-body">Вход по одноразовому коду</div>
          <div className="text-xs text-faint">
            {status.enabled
              ? "Подключено. Если забудете пароль — войдёте по коду из приложения."
              : "Google Authenticator и любое совместимое приложение."}
          </div>
        </div>
        {!status.enabled && !setup && (
          <Button size="sm" loading={pending} onClick={() => void begin()}>
            Подключить
          </Button>
        )}
        {status.enabled && (
          <span className="shrink-0 rounded-full bg-online/15 px-2 py-0.5 text-xs font-medium text-online">
            включено
          </span>
        )}
      </div>

      {setup && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-3 text-xs text-muted">
            Отсканируйте код в приложении, затем введите шесть цифр, чтобы подтвердить.
          </p>
          <div className="flex gap-4">
            <img
              src={setup.qr}
              alt="QR-код для приложения-аутентификатора"
              className="size-[140px] shrink-0 rounded bg-white p-1"
            />
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-xs text-faint">Или введите ключ вручную:</div>
              <code className="block break-all rounded bg-panel px-2 py-1 font-mono text-[11px] text-body">
                {setup.secret}
              </code>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className={`${INPUT} mt-2`}
              />
              <Button
                size="sm"
                className="mt-2"
                loading={pending}
                disabled={code.length !== 6}
                onClick={() => void confirm()}
              >
                Подтвердить
              </Button>
            </div>
          </div>
          <p className="mt-3 text-xs text-idle">
            Пока коды подключены, доступ к телефону равен доступу к учётной записи.
          </p>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

function SecurityTab() {
  const [sessions, setSessions] = useState<SessionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<{ sessions: SessionDto[] }>("/auth/sessions")
      .then((r) => setSessions(r.sessions))
      .catch(() => setError("Не удалось получить список"));
  }, []);

  async function revoke(id: string) {
    setRevoking(id);
    try {
      await api.delete(`/auth/sessions/${id}`);
      setSessions((list) => list?.filter((s) => s.id !== id) ?? null);
    } catch {
      setError("Не удалось отозвать");
    } finally {
      setRevoking(null);
    }
  }

  if (error) return <p className="text-sm text-danger">{error}</p>;

  if (!sessions) {
    return (
      <div className="space-y-2">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <TotpSection />

      <p className="mb-3 text-sm text-muted">
        Устройства, на которых выполнен вход. Отозвали — там придётся входить заново.
      </p>

      {sessions.map((session) => (
        <div
          key={session.id}
          className="flex items-center gap-3 rounded-md bg-rail px-3 py-2.5"
        >
          <Laptop className="size-5 shrink-0 text-faint" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-body">{describeAgent(session.userAgent)}</div>
            <div className="text-xs text-faint">вход {formatDateTime(session.createdAt)}</div>
          </div>
          {session.current ? (
            <span className="shrink-0 rounded-full bg-online/15 px-2 py-0.5 text-xs font-medium text-online">
              это устройство
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              loading={revoking === session.id}
              onClick={() => void revoke(session.id)}
            >
              Отозвать
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Из полной строки user-agent человеку нужны браузер и система.
 *  Показывать её целиком бессмысленно: это сто символов версий,
 *  по которым устройство всё равно не опознать. */
function describeAgent(agent: string | null): string {
  if (!agent) return "Неизвестное устройство";

  const browser =
    /Edg\//.test(agent) ? "Edge"
    : /OPR\/|Opera/.test(agent) ? "Opera"
    : /Firefox\//.test(agent) ? "Firefox"
    : /Chrome\//.test(agent) ? "Chrome"
    : /Safari\//.test(agent) ? "Safari"
    : "Браузер";

  const system =
    /Windows/.test(agent) ? "Windows"
    : /Android/.test(agent) ? "Android"
    : /iPhone|iPad/.test(agent) ? "iOS"
    : /Mac OS/.test(agent) ? "macOS"
    : /Linux/.test(agent) ? "Linux"
    : "";

  return system ? `${browser} · ${system}` : browser;
}

// ─── Мелочи ────────────────────────────────────────────────────

const INPUT =
  "w-full rounded-md border border-rail bg-rail p-2.5 text-body outline-none transition-colors focus:border-accent";

function Row({
  label,
  error,
  note,
  children,
}: {
  label: string;
  error?: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold tracking-wide text-muted uppercase">
        {label}
        {error && <span className="text-danger normal-case"> — {error}</span>}
      </span>
      {children}
      {note && !error && <span className="mt-1 block text-xs text-faint">{note}</span>}
    </label>
  );
}

function Toggle({
  label,
  note,
  checked,
  onChange,
}: {
  label: string;
  note: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-md px-2 py-2.5 text-left hover:bg-hover"
    >
      <span
        className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          checked ? "bg-accent" : "bg-raised"
        }`}
      >
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 600, damping: 34 }}
          className={`size-4 rounded-full bg-white ${checked ? "ml-auto" : ""}`}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-body">{label}</span>
        <span className="block text-xs text-faint">{note}</span>
      </span>
    </button>
  );
}
