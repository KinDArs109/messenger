import { Router } from "express";
import { prisma } from "../../db/client.js";
import { env } from "../../config/env.js";
import { newInviteCode } from "../../lib/ids.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { ктоВСети } from "../../realtime/index.js";
import { currentUserId, requireAuth } from "../../middleware/auth.js";

/**
 * Хозяйская часть: то, за чем раньше приходилось лезть в базу руками.
 *
 * Список людей с почтами, удаление учётной записи, приглашения, состав
 * серверов — всё, что нужно тому, кто держит мессенджер, и не нужно
 * никому больше.
 *
 * Живёт отдельным разделом и отдельным приложением, а не вкладкой
 * в мессенджере. Причина простая: кнопка «удалить человека» не должна
 * находиться в двух нажатиях от переписки, даже если она невидима
 * остальным. Невидима — не значит недоступна: стоит ошибиться в одной
 * проверке, и она станет видна всем.
 *
 * Хозяин задаётся в настройках сервера, именем пользователя. Пока имя
 * не задано, раздела нет вовсе — не «есть, но пустой», а именно нет:
 * забытая настройка не должна оборачиваться открытой дверью.
 */

export const adminRouter: Router = Router();

/** Хозяин — один, и он назван в .env. Сравниваем по имени
 *  пользователя, а не по идентификатору: имя человек знает и может
 *  вписать сам, а идентификатор надо где-то подсмотреть. */
async function требуетсяХозяин(userId: string): Promise<void> {
  if (!env.ADMIN_USERNAME) throw notFound("Раздел не включён");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true },
  });

  if (!user || user.username !== env.ADMIN_USERNAME) {
    // Именно «не найдено», а не «нельзя»: чужому незачем знать,
    // что такой раздел вообще существует.
    throw notFound("Раздел не найден");
  }
}

adminRouter.use(requireAuth, async (req, _res, next) => {
  try {
    await требуетсяХозяин(currentUserId(req));
    next();
  } catch (error) {
    next(error);
  }
});

/** Всё хозяйство одним ответом: панель маленькая, и делить её на пять
 *  запросов значит показывать её кусками. */
adminRouter.get("/overview", async (_req, res) => {
  const [люди, серверы, приглашения] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        emailVerifiedAt: true,
        createdAt: true,
        totpEnabledAt: true,
        _count: { select: { messages: true, ownedServers: true, memberships: true } },
        // Последний живой вход: по нему видно, кто пользуется,
        // а кто завёл запись и пропал.
        refreshTokens: {
          where: { revokedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true, client: true },
        },
      },
    }),
    prisma.server.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        owner: { select: { username: true } },
        _count: { select: { members: true, channels: true } },
      },
    }),
    prisma.invite.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        code: true,
        uses: true,
        maxUses: true,
        expiresAt: true,
        createdAt: true,
        server: { select: { name: true } },
      },
    }),
  ]);

  res.json({
    // Регистрация: открыта или по коду. Меняется она в настройках
    // сервера, поэтому здесь только показываем — кнопки, которая
    // молча переписывает .env, тут не будет.
    регистрация: { поКоду: Boolean(env.SIGNUP_CODE) },
    люди: люди.map((кто) => ({
      id: кто.id,
      username: кто.username,
      displayName: кто.displayName,
      email: кто.email,
      почтаПодтверждена: Boolean(кто.emailVerifiedAt),
      кодыВключены: Boolean(кто.totpEnabledAt),
      создан: кто.createdAt.toISOString(),
      сообщений: кто._count.messages,
      серверов: кто._count.ownedServers,
      участвует: кто._count.memberships,
      последнийВход: кто.refreshTokens[0]?.createdAt.toISOString() ?? null,
      откуда: кто.refreshTokens[0]?.client ?? null,
    })),
    серверы: серверы.map((с) => ({
      id: с.id,
      name: с.name,
      хозяин: с.owner.username,
      людей: с._count.members,
      каналов: с._count.channels,
      создан: с.createdAt.toISOString(),
    })),
    приглашения: приглашения.map((и) => ({
      code: и.code,
      сервер: и.server.name,
      использовано: и.uses,
      лимит: и.maxUses,
      истекает: и.expiresAt?.toISOString() ?? null,
      годно:
        (и.expiresAt === null || и.expiresAt > new Date()) &&
        (и.maxUses === null || и.uses < и.maxUses),
    })),
  });
});

/**
 * Удалить учётную запись.
 *
 * Со всеми оговорками, потому что отменить это нельзя. Себя удалить
 * не даём — иначе одним нажатием можно остаться без хозяина. Того,
 * у кого есть свои серверы, тоже: вместе с ним исчезли бы каналы
 * и переписка людей, которые ни при чём.
 */
adminRouter.delete("/users/:id", async (req, res) => {
  const id = String(req.params.id);
  if (id === currentUserId(req)) {
    throw badRequest("SELF", "Себя удалить нельзя");
  }

  const кто = await prisma.user.findUnique({
    where: { id },
    select: { username: true, _count: { select: { ownedServers: true } } },
  });
  if (!кто) throw notFound("Такого человека нет");

  if (кто._count.ownedServers > 0) {
    throw badRequest(
      "OWNS_SERVERS",
      `У ${кто.username} свои серверы (${кто._count.ownedServers}) — вместе с ним пропадёт и переписка на них`,
    );
  }

  await prisma.user.delete({ where: { id } });
  res.json({ удалён: кто.username });
});

/** Выпустить приглашение — то же, что кнопка в мессенджере, но
 *  не требует заходить в мессенджер. */
adminRouter.post("/invites", async (req, res) => {
  const { serverId, дней = 7, входов = 5 } = req.body as {
    serverId?: string;
    дней?: number;
    входов?: number;
  };

  const сервер = await prisma.server.findUnique({
    where: { id: String(serverId ?? "") },
    select: { id: true, ownerId: true, name: true },
  });
  if (!сервер) throw notFound("Такого сервера нет");

  const приглашение = await prisma.invite.create({
    data: {
      code: newInviteCode(),
      serverId: сервер.id,
      // Создателем пишем хозяина сервера, а не себя: в мессенджере
      // рядом с приглашением показывают, кто позвал, и «позвал
      // администратор» выглядело бы странно для своих.
      creatorId: сервер.ownerId,
      expiresAt: дней > 0 ? new Date(Date.now() + дней * 24 * 3600_000) : null,
      maxUses: входов > 0 ? входов : null,
    },
  });

  res.status(201).json({ code: приглашение.code, сервер: сервер.name });
});

/** Отозвать приглашение: строку просто убираем, ссылка перестаёт
 *  работать в ту же секунду. */
adminRouter.delete("/invites/:code", async (req, res) => {
  const code = String(req.params.code).toLowerCase();
  const было = await prisma.invite.findUnique({ where: { code }, select: { code: true } });
  if (!было) throw notFound("Такого приглашения нет");

  await prisma.invite.delete({ where: { code } });
  res.json({ отозвано: code });
});

/**
 * Кто сейчас в сети — по живым сокетам, а не по последнему входу.
 *
 * Отдельным запросом, потому что панель обновляет его чаще
 * остального: список людей меняется раз в месяц, а «в сети» —
 * каждую минуту.
 */
adminRouter.get("/online", (_req, res) => {
  res.json({ вСети: ктоВСети() });
});

export function adminEnabled(): boolean {
  return Boolean(env.ADMIN_USERNAME);
}
