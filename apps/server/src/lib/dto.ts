import type { User } from "@prisma/client";
import { boostLevel } from "@messenger/shared";
import type {
  ChannelType,
  ChosenStatus,
  MemberRole,
  PrivateUser,
  PublicUser,
  ServerDto,
  UserStatus,
} from "@messenger/shared";

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
export function toPrivateUser(user: User): PrivateUser {
  return {
    ...toPublicUser(user),
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    chosenStatus: user.chosenStatus as ChosenStatus,
  };
}

/**
 * Сервер в том виде, в каком его ждёт клиент.
 *
 * Собирается в одном месте намеренно. Раньше он собирался в трёх —
 * в списке серверов, при создании и при входе по приглашению, — и как
 * только у сервера появились уровень и список поддержавших, два места
 * из трёх стали отдавать объект без них. Приложение падало на первом
 * же обращении к длине несуществующего списка, причём не там, где
 * ошиблись, а в списке участников.
 */
export function toServerDto(
  server: {
    id: string;
    name: string;
    iconUrl: string | null;
    bannerUrl: string | null;
    channels: {
      id: string;
      serverId: string | null;
      type: string;
      name: string | null;
      topic: string | null;
      position: number;
    }[];
  },
  role: MemberRole,
  boostedBy: string[],
): ServerDto {
  const level = boostLevel(boostedBy.length);

  return {
    id: server.id,
    name: server.name,
    iconUrl: server.iconUrl,
    // Баннер — награда второго уровня, и отдаём мы его только вместе
    // с уровнем: иначе снятый буст оставлял бы картинку висеть.
    bannerUrl: level >= 2 ? server.bannerUrl : null,
    role,
    boostedBy,
    level,
    channels: server.channels.map((c) => ({
      id: c.id,
      serverId: c.serverId ?? server.id,
      type: c.type as ChannelType,
      name: c.name ?? "",
      topic: c.topic,
      position: c.position,
    })),
  };
}
