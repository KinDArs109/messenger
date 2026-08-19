import { useEffect, useId, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AppWindow,
  Bell,
  Check,
  KeyRound,
  Laptop,
  Smartphone,
  LogOut,
  Mic,
  Shield,
  Sparkles,
  User,
  X,
} from "lucide-react";
import {
  LIMITS,
  type PrivateUser,
  type SessionDto,
  type TotpSetupDto,
  type TotpStatusDto,
} from "@messenger/shared";
import { api, ApiError } from "@/lib/api";
import { useStore } from "@/lib/store";
import { ModalShell } from "@/components/Dialog";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Toggle } from "@/components/ui/Toggle";
import { PicturePicker } from "@/components/PicturePicker";
import { avatarColor, cn, formatDateTime, initial } from "@/lib/utils";
import { usePreferences } from "@/lib/preferences";
import { desktop, isApp, type RunningApp } from "@/lib/desktop";
import { pushDisable, pushEnable, pushPermission, pushSubscribed, pushSupported } from "@/lib/push";
import { Section } from "./Section";
import { VoiceTab } from "./VoiceTab";

type Tab = "profile" | "voice" | "alerts" | "look" | "security" | "app";

const TABS = [
  { value: "profile" as const, label: "Профиль", icon: <User className="size-4" /> },
  { value: "voice" as const, label: "Голос", icon: <Mic className="size-4" /> },
  { value: "alerts" as const, label: "Уведомления", icon: <Bell className="size-4" /> },
  { value: "look" as const, label: "Вид", icon: <Sparkles className="size-4" /> },
  { value: "security" as const, label: "Вход", icon: <Shield className="size-4" /> },
  // Вкладки «Приложение» в браузере нет вовсе: там нечего настраивать,
  // а пустая вкладка с надписью «поставьте приложение» — это реклама,
  // а не настройка.
  ...(isApp()
    ? [{ value: "app" as const, label: "Приложение", icon: <AppWindow className="size-4" /> }]
    : []),
];

/**
 * Настройки: список слева, содержимое справа.
 *
 * Раньше разделы стояли вкладками поверху, и окно росло под самый
 * длинный из них. «Голос» перерос экран — нижние кнопки оказались
 * за краем, и добраться до них было нельзя: прокрутки у окна не было,
 * а лишнее оно обрезало.
 *
 * Боковой список решает это по существу, а не подпоркой: у окна
 * появляется постоянная высота, прокручивается только правая колонка,
 * и добавление настроек больше не двигает границы окна. Заодно видно
 * все разделы сразу — вкладки поверху при шести пунктах начинают
 * тесниться.
 *
 * На узком экране список ложится строкой поверх содержимого: колонка
 * шириной в треть телефона не оставила бы места самим настройкам.
 */
export function SettingsDialog({
  onClose,
  onLogout,
}: {
  onClose: () => void;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<Tab>("profile");
  const titleId = useId();
  const current = TABS.find((t) => t.value === tab);

  return (
    <ModalShell onClose={onClose} labelledBy={titleId} maxWidth={860} className="h-[85vh]">
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          aria-label="Разделы настроек"
          className="flex shrink-0 gap-1 overflow-x-auto bg-rail p-2 md:w-56 md:flex-col md:overflow-x-visible md:overflow-y-auto md:p-3"
        >
          <h2 id={titleId} className="hidden px-2 pt-1 pb-2 text-xs font-bold tracking-wide text-muted uppercase md:block">
            Настройки
          </h2>

          {TABS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setTab(item.value)}
              aria-current={tab === item.value ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm whitespace-nowrap",
                tab === item.value
                  ? "bg-active text-bright"
                  : "text-muted hover:bg-hover hover:text-body",
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}

          {/* Выход — внизу списка и на отдельном отступе: его нажимают
              раз в полгода, и стоять он должен подальше от того,
              что нажимают каждый день. */}
          <button
            onClick={onLogout}
            className="mt-auto flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm whitespace-nowrap text-muted hover:bg-hover hover:text-danger"
          >
            <LogOut className="size-4" />
            Выйти
          </button>
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between px-4 pt-4 md:px-6">
            <h3 className="text-lg font-semibold text-bright">{current?.label}</h3>
            <button
              onClick={onClose}
              aria-label="Закрыть"
              className="rounded p-1 text-muted hover:bg-hover hover:text-body"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Прокручивается только эта колонка. min-h-0 обязателен:
              без него она отказывается быть ниже своего содержимого,
              и прокрутка не появляется. */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4 md:px-6">
            {/* Высота разделов разная, поэтому переключение анимируем
                только по прозрачности и лёгкому сдвигу: анимация
                высоты на разном содержимом даёт заметный прыжок. */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
              >
                {tab === "profile" && <ProfileTab />}
                {tab === "voice" && <VoiceTab />}
                {tab === "alerts" && <AlertsTab />}
                {tab === "look" && <LookTab />}
                {tab === "security" && <SecurityTab />}
                {tab === "app" && <AppTab />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Уведомления ───────────────────────────────────────────────

/**
 * Уведомления, когда мессенджер закрыт.
 *
 * Пока приложение открыто, о сообщениях рассказывает живое соединение,
 * и настраивать нечего. Речь ровно про закрытое: телефон в кармане
 * соединения не держит, и без подписки человек узнаёт о сообщении,
 * только когда сам заглянет.
 *
 * Разрешение спрашиваем по нажатию и никогда само: браузер запрещает
 * спрашивать без действия человека, и правильно делает — окно
 * «разрешить уведомления» на первой секунде знакомства с сервисом
 * закрывают не глядя, и потом его уже не вернуть.
 */
function AlertsTab() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void pushSubscribed().then(setOn);
  }, []);

  const supported = pushSupported();
  const blocked = pushPermission() === "denied";

  async function toggle(next: boolean) {
    setBusy(true);
    setProblem(null);
    try {
      if (next) {
        const failure = await pushEnable();
        setProblem(failure);
        setOn(failure === null);
      } else {
        await pushDisable();
        setOn(false);
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Не получилось");
      setOn(await pushSubscribed());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section title="Когда мессенджер закрыт">
        <Toggle
          checked={on ?? false}
          onChange={(value) => void toggle(value)}
          disabled={!supported || busy || on === null}
          label="Присылать уведомления на это устройство"
          note={
            supported
              ? "Приходят, только когда приложение закрыто или свёрнуто. Пока оно открыто, сообщения и так видно."
              : "Этот браузер не умеет уведомления при закрытом приложении."
          }
        />

        {blocked && !on && (
          <p className="text-xs text-idle">
            Уведомления запрещены для этого сайта в настройках браузера — включить их отсюда нельзя,
            сначала разрешите в браузере.
          </p>
        )}

        {problem && <p className="text-xs text-danger">{problem}</p>}

        <p className="text-xs text-faint">
          Настройка своя у каждого устройства: включив её на телефоне, вы не включите её на
          компьютере.
        </p>
      </Section>
    </div>
  );
}

// ─── Приложение ────────────────────────────────────────────────
// Только то, чего в браузере не бывает.

function AppTab() {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const { prefs, setPref } = usePreferences();

  useEffect(() => {
    void desktop()?.getAutostart().then(setAutostart);
  }, []);

  return (
    <div className="space-y-6">
      <Section title="Запуск">
        <label className="flex cursor-pointer items-start gap-3 rounded-md bg-raised px-3 py-2.5">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-accent"
            checked={autostart ?? false}
            disabled={autostart === null}
            onChange={(event) => {
              setAutostart(event.target.checked);
              void desktop()
                ?.setAutostart(event.target.checked)
                .then(setAutostart);
            }}
          />
          <span>
            <span className="block text-sm text-bright">Запускать вместе с Windows</span>
            <span className="block text-xs text-muted">
              Открывается сразу в трее, окно не разворачивается.
            </span>
          </span>
        </label>
      </Section>

      <Section title="Окно">
        <p className="rounded-md bg-raised px-3 py-2.5 text-xs text-muted">
          Крестик прячет мессенджер в трей — разговор не обрывается, уведомления приходят.
          Выйти совсем: правая кнопка по значку в трее, «Выход».
        </p>
      </Section>

      {/* Окошко поверх игры стояло в «Голосе», рядом с микрофоном
          и динамиками. Оно про окно, а не про звук: браузер ничего
          поверх чужой игры нарисовать не может, и пункта этого там нет
          вовсе — значит, ему сюда, к остальному оконному.
          Проверять isApp() здесь не надо: вкладки «Приложение»
          в браузере не существует. */}
      <Section title="Поверх игры">
        <div>
          <span className={SELECT_LABEL}>Показывать, кто говорит</span>
          <div className="flex gap-2">
            {(
              [
                ["always", "Всегда"],
                ["game", "Только в игре"],
                ["never", "Никогда"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPref("overlayMode", value)}
                className={`flex-1 rounded-md px-3 py-2 text-sm ${
                  prefs.overlayMode === value
                    ? "bg-accent text-white"
                    : "bg-raised text-muted hover:text-bright"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">
            Окошко в углу экрана со списком разговора. Не сворачивая игру видно, кто из друзей
            говорит. Меню по клавише открывается при любом из трёх — микрофон под рукой нужен
            и без списка.
          </p>
        </div>

        {/* Список игр нужен теперь не только окошку: по нему же друзья
            видят, во что вы играете. Поэтому он стоит всегда, а не
            только в режиме «в игре». */}
        <GamePicker />

        {/* Клавиша здесь, а положение и размер — в самом меню:
            их подбирают глядя на экран, а не на этот список. */}
        <div>
          <label className={SELECT_LABEL} htmlFor="overlay-key">
            Клавиша меню
          </label>
          <select
            id="overlay-key"
            className={INPUT}
            value={prefs.overlayKey}
            onChange={(event) => setPref("overlayKey", event.target.value)}
          >
            {["Shift+F1", "Shift+F2", "Shift+F3", "Alt+O", "Control+Shift+O"].map((key) => (
              <option key={key} value={key}>
                {key.replace("Control", "Ctrl")}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-muted">
            Затемняет экран и открывает меню: микрофон, звук, громкость каждого, переход в другой
            канал, выход из разговора. Там же окошко перетаскивается мышью и меняет размер.
            Клавиша занимается, только пока вы в разговоре.
          </p>
        </div>

        <p className="text-xs text-idle">
          Поверх полноэкранного режима не рисуется ни окошко, ни меню — так устроена Windows.
          В настройках игры выберите «оконный без рамки».
        </p>
      </Section>

      {/* Версия — последней строкой и мельче остального: её ищут раз
          в жизни, когда что-то сломалось. */}
      <p className="border-t border-line pt-4 text-xs text-faint">
        Версия {desktop()?.version ?? "—"}
      </p>
    </div>
  );
}

/**
 * Какие программы считать игрой.
 *
 * Честно определить «идёт игра» нельзя: в игру приложение
 * не встраивается, а Windows сама не знает, что считать игрой. Сотню
 * с лишним известных игр приложение узнаёт по имени файла и без всяких
 * настроек — здесь дописывают остальное.
 *
 * Спрашиваем не именем файла по памяти, а выбором из того, что сейчас
 * запущено: игра почти всегда самое тяжёлое, что есть на машине,
 * поэтому список отсортирован по памяти и системное из него убрано.
 *
 * Отсюда и порядок действий: запустите игру, откройте это, отметьте.
 */
function GamePicker() {
  const { prefs, setPref } = usePreferences();
  const [apps, setApps] = useState<RunningApp[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setApps((await desktop()?.listApps?.()) ?? []);
    } finally {
      setLoading(false);
    }
  }

  function toggle(name: string, title?: string) {
    const has = prefs.overlayGames.some((game) => game.toLowerCase() === name.toLowerCase());
    setPref(
      "overlayGames",
      has
        ? prefs.overlayGames.filter((game) => game.toLowerCase() !== name.toLowerCase())
        : [...prefs.overlayGames, name],
    );

    // Заодно запоминаем, как игра называется по-человечески: друзья
    // увидят «играет в Rust», а не «играет в RustClient». Название
    // берём из заголовка окна — другого источника у нас нет, и он же
    // самый честный: так игра называет себя сама.
    if (!has && title && title !== name) {
      setPref("gameNames", { ...prefs.gameNames, [name.toLowerCase()]: title });
    }
  }

  return (
    <div>
      <span className={SELECT_LABEL}>Что считать игрой</span>

      {prefs.overlayGames.length === 0 ? (
        <p className="mb-2 text-xs text-muted">
          Известные игры узнаются сами — отмечать их не нужно. Если вашей среди них не оказалось,
          запустите её и отметьте в списке ниже: по нему окошко понимает, что идёт игра, а друзья
          видят, во что вы играете.
        </p>
      ) : (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {prefs.overlayGames.map((game) => (
            <button
              key={game}
              type="button"
              onClick={() => toggle(game)}
              title="Убрать из списка"
              className="rounded-full bg-accent px-2.5 py-1 text-xs text-white hover:bg-accent-hover"
            >
              {game} ✕
            </button>
          ))}
        </div>
      )}

      <Button size="sm" variant="ghost" loading={loading} onClick={() => void load()}>
        {apps ? "Обновить список" : "Показать запущенные"}
      </Button>

      {apps && (
        <div className="mt-2 max-h-48 overflow-y-auto rounded-md bg-rail p-1">
          {apps.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted">Ничего подходящего не нашлось</p>
          ) : (
            apps.map((app) => {
              const picked = prefs.overlayGames.some(
                (game) => game.toLowerCase() === app.name.toLowerCase(),
              );
              return (
                <button
                  key={app.name}
                  type="button"
                  onClick={() => toggle(app.name, app.title)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ${
                    picked ? "text-bright" : "text-muted hover:bg-hover hover:text-body"
                  }`}
                >
                  <span className="w-3 shrink-0">{picked ? "✓" : ""}</span>
                  <span className="truncate">
                    {app.title ?? app.name}
                    {app.title && <span className="text-faint"> · {app.name}</span>}
                  </span>
                  <span className="ml-auto shrink-0 text-faint">
                    {Math.round(app.memory / 1024)} МБ
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
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

  /** Аватар сохраняется сразу, отдельно от имени: это не поле формы,
   *  а действие, и держать выбранную картинку до нажатия «Сохранить»
   *  значит показывать человеку одно, а собеседникам другое. */
  async function setAvatar(avatarUrl: string | null) {
    const r = await api.patch<{ user: PrivateUser }>("/users/me", { avatarUrl });
    setMe(r.user);
  }

  if (!me) return null;

  return (
    <form onSubmit={submit} className="space-y-4">
      <Row label="Аватар">
        <PicturePicker
          url={me.avatarUrl}
          onChange={setAvatar}
          fallback={
            <span
              aria-hidden
              className="flex size-full items-center justify-center rounded-full text-3xl font-semibold text-white"
              style={{ background: avatarColor(me.id) }}
            >
              {initial(me.displayName)}
            </span>
          }
        />
      </Row>

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
    <div className="space-y-6">
      {/* Две настройки из трёх — про ленту сообщений, третья про всё
          приложение сразу. Вперемешку они читались как один список
          несвязанных галочек. */}
      <Section title="Лента сообщений">
        <div className="space-y-1">
          <Toggle
            label="Компактная лента"
            note="Меньше отступов между сообщениями — на экран влезает больше"
            checked={prefs.compact}
            onChange={(v) => setPref("compact", v)}
          />
          <Toggle
            label="Показывать время у каждого сообщения"
            note="Иначе время видно только у первого в группе"
            checked={prefs.alwaysTime}
            onChange={(v) => setPref("alwaysTime", v)}
          />
        </div>
      </Section>

      <Section title="Движение">
        <Toggle
          label="Меньше движения"
          note="Отключает анимации переходов. Системная настройка тоже учитывается"
          checked={prefs.reducedMotion}
          onChange={(v) => setPref("reducedMotion", v)}
        />
      </Section>
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
    <div className="rounded-md bg-rail p-3">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 shrink-0 text-faint" />
        {/* Заголовок раздела уже сказал, что это. Здесь — только то,
            чего он не говорит: подключено или нет и что для этого
            нужно. Повторять название второй раз значит показывать
            одну строку дважды. */}
        <div className="min-w-0 flex-1">
          <div className="text-sm text-body">
            {status.enabled ? "Подключено" : "Запасной способ входа"}
          </div>
          <div className="text-xs text-faint">
            {status.enabled
              ? "Если забудете пароль — войдёте по коду из приложения."
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

  return (
    <div className="space-y-6">
      <Section title="Вход по одноразовому коду">
        <TotpSection />
      </Section>

      {/* Раньше ошибка списка устройств возвращалась вместо всей
          вкладки — и вместе со списком пропадала настройка кодов,
          к которой список отношения не имеет. Теперь каждый раздел
          отвечает сам за себя. */}
      <Section title="Устройства">
        <p className="text-sm text-muted">
          Где выполнен вход. Отозвали — там придётся входить заново.
        </p>

        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : !sessions ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center gap-3 rounded-md bg-rail px-3 py-2.5"
              >
                {/* Телефон значком телефона: в списке из четырёх строк
                    одинаковые ноутбуки не помогают понять, где что. */}
                {/iPhone|iPad|Android/.test(session.userAgent ?? "") ? (
                  <Smartphone className="size-5 shrink-0 text-faint" />
                ) : (
                  <Laptop className="size-5 shrink-0 text-faint" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-body">
                    {describeAgent(session.userAgent, session.client)}
                  </div>
                  <div className="text-xs text-faint">
                    вход {formatDateTime(session.createdAt)}
                  </div>
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
        )}
      </Section>
    </div>
  );
}

/** Из полной строки user-agent человеку нужны браузер и система.
 *  Показывать её целиком бессмысленно: это сто символов версий,
 *  по которым устройство всё равно не опознать. */
function describeAgent(agent: string | null, client?: string | null): string {
  if (!agent) return "Неизвестное устройство";

  // Приложение — первым делом, до всякого разбора браузера. Внутри
  // оболочки живёт тот же Chromium, и по одной только строке любой
  // вход из приложения выглядел как «Chrome»: человек видел четыре
  // одинаковых Chrome и не мог понять, где он сидит с приложением,
  // а где открыл вкладку.
  //
  // Проверяем и слово из строки, и то, что сказал сам клиент:
  // на телефоне строка не отличается ничем, там правду говорит
  // только заголовок.
  const app =
    client === "app-desktop" || client === "app-mobile" || /Electron\/|@messenger\/desktop/.test(agent);

  const browser =
    app ? "Приложение"
    : /YaBrowser/.test(agent) ? "Яндекс Браузер"
    : /Edg\//.test(agent) ? "Edge"
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

/** Подпись над полем. Та же, что в VoiceTab: настройки должны
 *  выглядеть одинаково независимо от того, в каком файле лежат. */
const SELECT_LABEL = "mb-1.5 block text-xs font-semibold tracking-wide text-muted uppercase";

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

