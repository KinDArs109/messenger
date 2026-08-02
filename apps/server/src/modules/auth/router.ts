import { Router } from "express";
import { toDataURL } from "qrcode";
import {
  loginCodeSchema,
  loginSchema,
  registerSchema,
  totpDisableSchema,
  totpEnableSchema,
  emailCodeSchema,
} from "@messenger/shared";
import { generateSecret, otpauthUrl, verifyCode } from "../../lib/totp.js";
import { verifyPassword } from "../../lib/password.js";
import { isMailEnabled } from "../../lib/mailer.js";
import { env } from "../../config/env.js";
import { issueEmailCode, verifyEmailCode } from "./email.js";
import { validateBody } from "../../middleware/validate.js";
import { authLimiter } from "../../middleware/rateLimit.js";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { prisma } from "../../db/client.js";
import { toPrivateUser } from "../../lib/dto.js";
import { badRequest, notFound, unauthorized } from "../../lib/errors.js";
import { hashRefreshToken } from "../../lib/tokens.js";
import * as authService from "./service.js";
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  setRefreshCookie,
} from "./cookies.js";

export const authRouter: Router = Router();

authRouter.post(
  "/register",
  authLimiter,
  validateBody(registerSchema),
  async (req, res) => {
    const { refreshToken, ...result } = await authService.register(
      req.body,
      req.headers["user-agent"],
    );
    setRefreshCookie(res, refreshToken);
    res.status(201).json(result);
  },
);

authRouter.post(
  "/login",
  authLimiter,
  validateBody(loginSchema),
  async (req, res) => {
    const { refreshToken, ...result } = await authService.login(
      req.body,
      req.headers["user-agent"],
    );
    setRefreshCookie(res, refreshToken);
    res.json(result);
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
 *  Мягкий режим: без подтверждения мессенджер работает, но клиент
 *  показывает полоску-напоминание. Жёсткая блокировка на компанию
 *  друзей била бы по своим же — человек, у которого письмо ушло
 *  в спам, оказался бы заперт снаружи.
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

authRouter.post(
  "/login-code",
  authLimiter,
  validateBody(loginCodeSchema),
  async (req, res) => {
    const { refreshToken, ...result } = await authService.loginWithCode(
      req.body,
      req.headers["user-agent"],
    );
    setRefreshCookie(res, refreshToken);
    res.json(result);
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
    select: { id: true, tokenHash: true, userAgent: true, createdAt: true, expiresAt: true },
  });

  res.json({
    sessions: sessions.map((session) => ({
      id: session.id,
      userAgent: session.userAgent,
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
