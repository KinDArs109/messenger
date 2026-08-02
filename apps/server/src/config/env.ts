import { z } from "zod";

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

  TURN_URL: z.string().optional(),
  TURN_USER: z.string().optional(),
  TURN_PASS: z.string().optional(),
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
