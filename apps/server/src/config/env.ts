import { z } from "zod";

/** Незаполненная строка в .env — это «не задано», а не пустое
 *  значение.
 *
 *  В примере настроек ключи стоят пустыми, и человек оставляет
 *  ненужные как есть. Без этой обёртки TURN_SECRET= (пустой) не просто
 *  выключал бы ретранслятор, а валил бы весь сервер: пустая строка
 *  короче двадцати четырёх символов. */
const blank = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

/** Переменные окружения проверяются один раз при старте.
 *  Лучше не запуститься с внятной ошибкой, чем упасть через час
 *  на первом запросе из-за опечатки в .env. */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, "Не задан DATABASE_URL"),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET должен быть не короче 32 символов"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CLIENT_ORIGIN: z.string().min(1).default("http://localhost:5173"),

  // Почта необязательна: без неё мессенджер работает, просто не шлёт
  // коды подтверждения. Обязательными эти поля делать нельзя — иначе
  // забытая строка в .env валила бы весь сервер вместе с перепиской.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  // Ретранслятор для голоса. Нужен, когда прямое соединение между
  // собеседниками не складывается — а за CGNAT это случается часто.
  // Пока пусто, звонки работают только там, где хватает STUN.
  // Пароль на регистрацию. Пока не задан, зарегистрироваться может
  // любой, кто узнал адрес, — а адрес торчит в интернете. Задан —
  // нужен либо он, либо действующая ссылка-приглашение.
  SIGNUP_CODE: z.string().optional(),

  // Хозяин мессенджера — имя пользователя. Пока не задано, хозяйского
  // раздела нет вовсе: забытая настройка не должна оборачиваться
  // открытой дверью.
  ADMIN_USERNAME: z.string().optional(),

  // Чужой ретранслятор, если когда-нибудь появится платный.
  TURN_URL: blank(z.string()),
  TURN_USER: blank(z.string()),
  TURN_PASS: blank(z.string()),

  // Свой ретранслятор — он живёт в этом же процессе.
  //
  // Включается наличием секрета: он же подписывает временные пароли,
  // и без него раздавать нечего. Секрет длинный не для красоты —
  // подобрав его, чужой человек получит бесплатный канал за наш счёт.
  TURN_SECRET: blank(z.string().min(24, "TURN_SECRET должен быть не короче 24 символов")),
  TURN_PORT: z.coerce.number().int().positive().default(3478),
  /** Каким адресом ретранслятор виден снаружи: домен или внешний IP.
   *  Пусто — берётся адрес в домашней сети, чего хватает для проверок,
   *  но не хватает для друзей из интернета. */
  TURN_HOST: blank(z.string()),
  TURN_REALM: z.string().default("messenger"),

  // Уведомления на закрытый телефон.
  //
  // Пара ключей, которой мы подписываемся перед службой доставки
  // браузера: по открытому она узнаёт отправителя, закрытым мы
  // подписываем каждое письмо. Открытый уезжает на страницу и в этом
  // смысле не тайна; закрытый — тайна ровно как пароль от базы.
  //
  // Обе пустые — уведомления просто выключены, и сервер работает
  // как раньше. Терять их нельзя: сменив пару, придётся заново
  // подписывать каждый телефон.
  VAPID_PUBLIC_KEY: blank(z.string()),
  VAPID_PRIVATE_KEY: blank(z.string()),
  /** Кому жаловаться, если с наших писем посыпались ошибки. Требование
   *  самой службы доставки: обратный адрес обязателен. */
  VAPID_SUBJECT: z.string().default("mailto:admin@example.invalid"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("\n  Ошибка в переменных окружения (.env):\n");
  for (const issue of parsed.error.issues) {
    console.error(`   • ${issue.path.join(".")}: ${issue.message}`);
  }
  console.error("\n  Скопируйте .env.example в .env и заполните значения.\n");
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
