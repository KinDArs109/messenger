import { Router } from "express";
import { toDataURL } from "qrcode";
import {
  loginCodeSchema,
  loginSchema,
  registerSchema,
  totpDisableSchema,
  totpEnableSchema,
  emailCodeSchema,
  changeEmailSchema,
  loginConfirmSchema,
  loginResendSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "@messenger/shared";
import { generateSecret, otpauthUrl, verifyCode } from "../../lib/totp.js";
import { verifyPassword } from "../../lib/password.js";
import { isMailEnabled } from "../../lib/mailer.js";
import { env } from "../../config/env.js";
import { issueEmailCode, verifyEmailCode } from "./email.js";
import { requestPasswordReset, resetPassword } from "./reset.js";
import { validateBody } from "../../middleware/validate.js";
import { authLimiter } from "../../middleware/rateLimit.js";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { forgetVerified } from "../../middleware/verified.js";
import { prisma } from "../../db/client.js";
import { toPrivateUser } from "../../lib/dto.js";
import { badRequest, conflict, notFound, unauthorized } from "../../lib/errors.js";
import { hashRefreshToken } from "../../lib/tokens.js";
import * as authService from "./service.js";
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  setRefreshCookie,
} from "./cookies.js";

export const authRouter: Router = Router();

/**
 * Чем зашли — приложением или браузером.
 *
 * Клиент говорит об этом сам, заголовком. Из user-agent это выводится
 * не всегда: приложение на Android показывает ровно тот же user-agent,
 * что и вкладка Chrome, и отличить их снаружи нельзя никак.
 *
 * Строка чужая, поэтому берём не то, что прислали, а только то, что
 * узнали: три известных слова, всё остальное — «не сказано». Иначе
 * в списке входов оказался бы текст, написанный кем угодно.
 */
const CLIENTS = new Set(["app-desktop", "app-mobile", "browser"]);

function clientOf(req: { headers: Record<string, unknown> }): string | undefined {
  const raw = req.headers["x-client"];
  const value = typeof raw === "string" ? raw.trim() : "";
  return CLIENTS.has(value) ? value : undefined;
}

authRouter.post(
  "/register",
  authLimiter,
  validateBody(registerSchema),
  async (req, res) => {
    const { refreshToken, ...result } = await authService.register(
      req.body,
      req.headers["user-agent"],
      clientOf(req),
    );
    setRefreshCookie(res, refreshToken);
    res.status(201).json(result);
  },
);

/**
 * Вход — в два шага, и первый из них сессии не даёт.
 *
 * Пока почта на сервере не настроена, шаг один: сервер сразу отвечает
 * сессией, как раньше. Клиент различает ответы по полю pending —
 * ему не нужно знать, настроена ли почта.
 */
function ответНаВход(res: Parameters<typeof setRefreshCookie>[0], результат: unknown) {
  const итог = результат as { refreshToken?: string; pending?: string };
  // Первый шаг: сессии ещё нет, ставить cookie нечем и незачем.
  if (итог.pending) {
    res.json(итог);
    return;
  }
  const { refreshToken, ...остальное } = итог as { refreshToken: string };
  setRefreshCookie(res, refreshToken);
  res.json(остальное);
}

authRouter.post(
  "/login",
  authLimiter,
  validateBody(loginSchema),
  async (req, res) => {
    ответНаВход(
      res,
      await authService.login(req.body, req.headers["user-agent"], clientOf(req)),
    );
  },
);

/** Второй шаг: код из письма. Здесь и появляется сессия. */
authRouter.post(
  "/login/confirm",
  authLimiter,
  validateBody(loginConfirmSchema),
  async (req, res) => {
    const { ticket, code } = req.body as { ticket: string; code: string };
    const { refreshToken, ...result } = await authService.finishLogin(
      ticket,
      code,
      req.headers["user-agent"],
      clientOf(req),
    );
    setRefreshCookie(res, refreshToken);
    res.json(result);
  },
);

/** Письмо не дошло. Пароль заново не спрашиваем: пропуск с первого
 *  шага ещё действует, и он же ограничивает, кому слать. */
authRouter.post(
  "/login/resend",
  authLimiter,
  validateBody(loginResendSchema),
  async (req, res) => {
    const { ticket } = req.body as { ticket: string };
    res.json({ ...(await authService.resendLoginCode(ticket)), mailEnabled: isMailEnabled() });
  },
);

/** Забыли пароль: код на почту.
 *
 *  Отвечаем «ок» всегда, даже если такого пользователя нет. Иначе
 *  форма превращается в способ проверять, зарегистрирован ли адрес. */
authRouter.post(
  "/password/forgot",
  authLimiter,
  validateBody(forgotPasswordSchema),
  async (req, res) => {
    await requestPasswordReset((req.body as { login: string }).login);
    res.json({ sent: true, mailEnabled: isMailEnabled() });
  },
);

authRouter.post(
  "/password/reset",
  authLimiter,
  validateBody(resetPasswordSchema),
  async (req, res) => {
    const { login, code, password } = req.body as {
      login: string;
      code: string;
      password: string;
    };
    await resetPassword(login, code, password);
    res.status(204).end();
  },
);

/** Нужен ли код для регистрации. Спрашивается до показа формы,
 *  без входа: иначе поле «код приглашения» пришлось бы показывать
 *  всем и объяснять, что его можно не заполнять. */
authRouter.get("/signup-policy", (_req, res) => {
  res.json({ codeRequired: Boolean(env.SIGNUP_CODE) });
});

/** Подтверждение почты.
 *
 *  Без него в мессенджер не пускают: адрес, который никто не проверял,
 *  бесполезен ровно тогда, когда нужен больше всего — при потере
 *  пароля. Сама застава живёт в middleware/verified.ts, здесь только
 *  то, чем её проходят.
 *
 *  Эти три обработчика доступны и непроверенному: они в разделе
 *  /api/auth, который застава пропускает всегда. Иначе подтвердить
 *  почту было бы нечем.
 */
authRouter.post("/email/send", requireAuth, async (req, res) => {
  const sent = await issueEmailCode(currentUserId(req), false);
  res.json({ sent, mailEnabled: isMailEnabled() });
});

authRouter.post(
  "/email/verify",
  requireAuth,
  validateBody(emailCodeSchema),
  async (req, res) => {
    const verifiedAt = await verifyEmailCode(
      currentUserId(req),
      (req.body as { code: string }).code,
    );
    res.json({ emailVerified: true, emailVerifiedAt: verifiedAt.toISOString() });
  },
);

/** Смена адреса — только пока он не подтверждён.
 *
 *  Это не «настройки почты», а выход из ловушки: человек ошибся
 *  буквой при регистрации, письмо ушло в никуда, и без этой кнопки
 *  он заперт снаружи навсегда. Подтверждённый адрес так не меняется:
 *  там нужен другой разговор — со старым адресом, с письмом на оба,
 *  а это уже совсем другая история.
 *
 *  Пароль обязателен. Адрес — ключ к восстановлению доступа, и если
 *  менять его по одной открытой вкладке, то забытый в чужих руках
 *  телефон превращается в потерянную учётную запись.
 */
authRouter.post(
  "/email/change",
  requireAuth,
  authLimiter,
  validateBody(changeEmailSchema),
  async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };

    const user = await prisma.user.findUnique({ where: { id: currentUserId(req) } });
    if (!user) throw notFound("Пользователь не найден");
    if (user.emailVerifiedAt) {
      throw badRequest("EMAIL_VERIFIED", "Эта почта уже подтверждена");
    }

    if (!(await verifyPassword(user.passwordHash, password))) {
      throw unauthorized("Неверный пароль");
    }

    if (email !== user.email) {
      const занято = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (занято) {
        throw conflict("EMAIL_TAKEN", "Эта почта уже занята", {
          email: "Эта почта уже зарегистрирована",
        });
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        email,
        // Новый адрес — новое подтверждение. Старый код к нему
        // не подходит, иначе сменой адреса можно было бы подтвердить
        // чужой ящик кодом, пришедшим на свой.
        emailCodeHash: null,
        emailCodeExpires: null,
        emailCodeSentAt: null,
        emailCodeAttempts: 0,
      },
    });
    forgetVerified(user.id);

    const sent = await issueEmailCode(user.id, true);
    res.json({ email, sent, mailEnabled: isMailEnabled() });
  },
);

authRouter.post(
  "/login-code",
  authLimiter,
  validateBody(loginCodeSchema),
  async (req, res) => {
    ответНаВход(
      res,
      await authService.loginWithCode(req.body, req.headers["user-agent"], clientOf(req)),
    );
  },
);

/** Начало подключения кодов: секрет создаётся, но не включается.
 *  Включённым он станет только после того, как человек введёт код
 *  из приложения — иначе тот, кто не успел добавить ключ, остался бы
 *  со способом входа, которым не может воспользоваться. */
authRouter.post("/totp/setup", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: currentUserId(req) } });
  if (!user) throw notFound("Пользователь не найден");
  if (user.totpEnabledAt) throw badRequest("TOTP_ENABLED", "Коды уже подключены");

  const secret = generateSecret();
  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecret: secret, totpEnabledAt: null },
  });

  const url = otpauthUrl(user.username, secret);
  res.json({
    secret,
    qr: await toDataURL(url, { margin: 1, width: 240 }),
  });
});

authRouter.post(
  "/totp/enable",
  requireAuth,
  // Отдельный лимит: шестизначный код живёт тридцать секунд, и общего
  // потолка в триста запросов в минуту на подбор хватило бы слишком
  // хорошо. Здесь перебор должен упираться в стену сразу.
  authLimiter,
  validateBody(totpEnableSchema),
  async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: currentUserId(req) } });
    if (!user?.totpSecret) throw badRequest("TOTP_NOT_SET_UP", "Сначала получите ключ");
    if (user.totpEnabledAt) throw badRequest("TOTP_ENABLED", "Коды уже подключены");

    if (!verifyCode(user.totpSecret, (req.body as { code: string }).code)) {
      throw badRequest("TOTP_BAD_CODE", "Код не подошёл", { code: "Неверный код" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabledAt: new Date() },
    });
    res.json({ enabled: true, enabledAt: new Date().toISOString() });
  },
);

/** Отключение — только по паролю.
 *  Коды заменяют пароль при входе, поэтому отключать их кодом значило бы
 *  позволить снять защиту тому, кто и так вошёл по украденному коду. */
authRouter.post(
  "/totp/disable",
  requireAuth,
  validateBody(totpDisableSchema),
  async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: currentUserId(req) } });
    if (!user) throw notFound("Пользователь не найден");

    const ok = await verifyPassword(user.passwordHash, (req.body as { password: string }).password);
    if (!ok) throw unauthorized("Неверный пароль");

    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: null, totpEnabledAt: null },
    });
    res.status(204).end();
  },
);

authRouter.get("/totp", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: currentUserId(req) },
    select: { totpEnabledAt: true },
  });
  res.json({
    enabled: Boolean(user?.totpEnabledAt),
    enabledAt: user?.totpEnabledAt?.toISOString() ?? null,
  });
});

authRouter.post("/refresh", async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!token) throw unauthorized("Сессия не найдена");

  const { refreshToken, ...result } = await authService.refresh(
    token,
    req.headers["user-agent"],
    clientOf(req),
  );
  setRefreshCookie(res, refreshToken);
  res.json(result);
});

authRouter.post("/logout", async (req, res) => {
  await authService.logout(req.cookies?.[REFRESH_COOKIE] as string | undefined);
  clearRefreshCookie(res);
  res.status(204).end();
});

/** Активные сессии — по одной на каждое устройство, где выполнен вход.
 *
 *  Отзываем не удалением, а отметкой revokedAt: строка остаётся,
 *  и попытка воспользоваться отозванным токеном отличима от попытки
 *  воспользоваться выдуманным. */
authRouter.get("/sessions", requireAuth, async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  const currentHash = token ? hashRefreshToken(token) : null;

  const sessions = await prisma.refreshToken.findMany({
    where: { userId: currentUserId(req), revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      tokenHash: true,
      userAgent: true,
      client: true,
      createdAt: true,
      expiresAt: true,
    },
  });

  res.json({
    sessions: sessions.map((session) => ({
      id: session.id,
      userAgent: session.userAgent,
      client: session.client,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      current: session.tokenHash === currentHash,
    })),
  });
});

authRouter.delete("/sessions/:id", requireAuth, async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  const currentHash = token ? hashRefreshToken(token) : null;

  // Ищем строго среди своих: без этого условия по чужому
  // идентификатору можно было бы выкинуть чужую сессию.
  const session = await prisma.refreshToken.findFirst({
    where: { id: String(req.params.id), userId: currentUserId(req) },
    select: { id: true, tokenHash: true },
  });
  if (!session) throw notFound("Сессия не найдена");

  // Текущую закрывать этой кнопкой нельзя: получился бы выход,
  // замаскированный под управление устройствами.
  if (session.tokenHash === currentHash) {
    throw badRequest("CURRENT_SESSION", "Это текущая сессия — используйте «Выйти»");
  }

  await prisma.refreshToken.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });
  res.status(204).end();
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: currentUserId(req) },
  });
  if (!user) throw notFound("Пользователь не найден");
  res.json({ user: toPrivateUser(user) });
});
