import type { User } from "@prisma/client";
import type { PublicUser, UserStatus } from "@messenger/shared";

/** Наружу отдаём только это. Пароль, почта и служебные поля
 *  не должны случайно уехать в ответ вместе со всей записью —
 *  поэтому объект собирается вручную, а не через spread. */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    status: user.status as UserStatus,
  };
}

/** Расширенная версия — только для самого пользователя.
 *  Признак подтверждённой почты нужен клиенту, чтобы показать
 *  напоминание; сама дата подтверждения ему ни к чему. */
export function toPrivateUser(
  user: User,
): PublicUser & { email: string; emailVerified: boolean } {
  return {
    ...toPublicUser(user),
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}
