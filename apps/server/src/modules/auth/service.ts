import { Prisma } from "@prisma/client";
import type { LoginInput, RegisterInput } from "@messenger/shared";
import { prisma } from "../../db/client.js";
import { newId } from "../../lib/ids.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import {
  accessTokenSeconds,
  createRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from "../../lib/tokens.js";
import { toPrivateUser } from "../../lib/dto.js";
import { verifyCode } from "../../lib/totp.js";
import { issueEmailCode } from "./email.js";
import { conflict, forbidden, unauthorized } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import { timingSafeEqual } from "node:crypto";

/** Хеш несуществующего пароля. Нужен, чтобы вход с незарегистрированной
 *  почтой занимал столько же времени, сколько вход с неверным паролем.
 *  Иначе по времени ответа можно перебрать, какие адреса есть в базе. */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000";

async function issueSession(userId: string, userAgent?: string, client?: string) {
  const { token, tokenHash } = createRefreshToken();

  await prisma.refreshToken.create({
    data: {
      id: newId(),
      userId,
      tokenHash,
      expiresAt: refreshTokenExpiry(),
      userAgent: userAgent?.slice(0, 255),
      // Обрезаем коротко: это чужая строка из заголовка, и ничего,
      // кроме пары известных слов, в ней быть не должно.
      client: client?.slice(0, 32),
    },
  });

  return {
    accessToken: await signAccessToken(userId),
    refreshToken: token,
    expiresIn: accessTokenSeconds(),
  };
}

/** Пропуск на регистрацию.
 *
 *  Годится либо общий код из .env, либо код действующего приглашения:
 *  человек, которому прислали ссылку на сервер, и так зван, и требовать
 *  с него ещё один секрет — лишняя ступенька.
 *
 *  Приглашение здесь только проверяется, но не расходуется: счётчик
 *  использований уменьшится, когда человек по нему реально вступит. */
async function checkSignupCode(given: string | undefined): Promise<void> {
  const expected = env.SIGNUP_CODE;
  if (!expected) return;

  const code = given?.trim();
  if (!code) throw forbidden("Регистрация только по коду приглашения");

  if (code.length === expected.length) {
    const a = Buffer.from(code);
    const b = Buffer.from(expected);
    // timingSafeEqual: по времени обычного сравнения короткий код
    // подбирается посимвольно.
    if (timingSafeEqual(a, b)) return;
  }

  const invite = await prisma.invite.findUnique({
    where: { code },
    select: { expiresAt: true, maxUses: true, uses: true },
  });
  const valid =
    invite !== null &&
    (invite.expiresAt === null || invite.expiresAt > new Date()) &&
    (invite.maxUses === null || invite.uses < invite.maxUses);

  if (!valid) throw forbidden("Код не подошёл");
}

export async function register(input: RegisterInput, userAgent?: string, client?: string) {
  await checkSignupCode(input.signupCode);

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: input.email }, { username: input.username }] },
    select: { email: true, username: true },
  });

  if (existing) {
    throw existing.email === input.email
      ? conflict("EMAIL_TAKEN", "Эта почта уже занята", {
          email: "Эта почта уже зарегистрирована",
        })
      : conflict("USERNAME_TAKEN", "Этот логин уже занят", {
          username: "Этот логин уже занят",
        });
  }

  try {
    const user = await prisma.user.create({
      data: {
        id: newId(),
        email: input.email,
        username: input.username,
        displayName: input.displayName,
        passwordHash: await hashPassword(input.password),
      },
    });

    // Код уходит сразу после регистрации и не ждёт отправки: письмо
    // может идти секунды, а человек в этот момент смотрит на форму.
    void issueEmailCode(user.id, true).catch((error) =>
      console.error("Не удалось отправить код подтверждения:", error),
    );

    return { user: toPrivateUser(user), ...(await issueSession(user.id, userAgent, client)) };
  } catch (error) {
    // Между проверкой выше и вставкой мог вклиниться другой запрос.
    // Уникальный индекс — последний рубеж, и он не подводит.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw conflict("ALREADY_EXISTS", "Такой пользователь уже существует");
    }
    throw error;
  }
}

/** Поиск по почте или логину.
 *
 *  Различаем по собаке: в логине её быть не может по правилам
 *  usernameSchema, а в почте она есть всегда. Искать «или там, или
 *  тут» одним запросом было бы проще, но тогда человек с логином,
 *  совпадающим с чужой почтой, попадал бы не туда. */
function findByLogin(login: string) {
  return login.includes("@")
    ? prisma.user.findUnique({ where: { email: login } })
    : prisma.user.findUnique({ where: { username: login } });
}

export async function login(input: LoginInput, userAgent?: string, client?: string) {
  const user = await findByLogin(input.login);

  const ok = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, input.password);

  // Один и тот же текст для «нет такого пользователя» и «неверный
  // пароль»: не подсказываем, какие учётные записи существуют.
  if (!user || !ok) {
    throw unauthorized("Неверный логин или пароль");
  }

  // Не подтвердил почту — код уходит сразу, вместе со входом.
  // Иначе человек упирается в экран «введите код», нажимает
  // «отправить», ждёт письмо — три действия там, где хватает одного.
  //
  // Пауза между письмами соблюдается (false), а отказ по ней —
  // не ошибка входа: письмо и так уже в пути.
  if (!user.emailVerifiedAt) {
    void issueEmailCode(user.id, false).catch(() => undefined);
  }

  return { user: toPrivateUser(user), ...(await issueSession(user.id, userAgent, client)) };
}

/** Вход по одноразовому коду вместо пароля.
 *
 *  Это не второй фактор, а замена первого: способ войти, когда пароль
 *  забыт. Поэтому он доступен, только если человек заранее подключил
 *  коды — то есть сам согласился, что доступ к его телефону равен
 *  доступу к учётной записи. */
export async function loginWithCode(
  input: { login: string; code: string },
  userAgent?: string,
  client?: string,
) {
  const user = await findByLogin(input.login);

  if (!user?.totpSecret || !user.totpEnabledAt || !verifyCode(user.totpSecret, input.code)) {
    throw unauthorized("Неверный логин или код");
  }

  return { user: toPrivateUser(user), ...(await issueSession(user.id, userAgent, client)) };
}

/** Ротация: старый токен отзывается, выдаётся новый.
 *  Если refresh утёк, окно его полезности — до ближайшего обновления. */
export async function refresh(token: string, userAgent?: string, client?: string) {
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(token) },
    include: { user: true },
  });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw unauthorized("Сессия истекла, войдите заново");
  }

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  return {
    user: toPrivateUser(stored.user),
    ...(await issueSession(stored.userId, userAgent, client)),
  };
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Разлогинить все устройства — понадобится при смене пароля. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
