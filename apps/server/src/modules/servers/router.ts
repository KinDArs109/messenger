import { Router } from "express";
import type { MemberRole } from "@messenger/shared";
import {
  EMOJI_LIMIT,
  EMOJI_NAME,
  boostLevel,
  createChannelSchema,
  createServerSchema,
  updateServerSchema,
} from "@messenger/shared";
import { room } from "@messenger/shared";
import { prisma } from "../../db/client.js";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { newId } from "../../lib/ids.js";
import { toPublicUser, toServerDto } from "../../lib/dto.js";
import { requireMembership, requirePermission } from "../../lib/access.js";
import { forgetPicture, requireOwnPicture } from "../../lib/pictures.js";
import { param } from "../../lib/params.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { realtime } from "../../realtime/emitter.js";

export const serversRouter: Router = Router();
serversRouter.use(requireAuth);

/** Серверы текущего пользователя вместе с каналами — это первый запрос
 *  клиента после входа, поэтому отдаём всё разом, чтобы не заставлять
 *  его делать N дополнительных обращений. */
serversRouter.get("/", async (req, res) => {
  const memberships = await prisma.serverMember.findMany({
    where: { userId: currentUserId(req) },
    include: {
      server: {
        include: {
          channels: { orderBy: { position: "asc" } },
          boosts: { select: { userId: true } },
          emoji: { select: { id: true, name: true, url: true }, orderBy: { name: "asc" } },
        },
      },
    },
    orderBy: { joinedAt: "asc" },
  });

  res.json({
    servers: memberships.map((m) =>
      toServerDto(m.server, m.role as MemberRole, m.server.boosts.map((b) => b.userId)),
    ),
  });
});

serversRouter.post("/", validateBody(createServerSchema), async (req, res) => {
  const userId = currentUserId(req);

  // Пустой сервер бесполезен: сразу заводим текстовый и голосовой канал,
  // иначе новый пользователь попадает на экран, где ничего нельзя сделать.
  const server = await prisma.server.create({
    data: {
      id: newId(),
      name: req.body.name,
      ownerId: userId,
      members: { create: { userId, role: "OWNER" } },
      channels: {
        create: [
          { id: newId(), type: "TEXT", name: "общий", position: 0 },
          { id: newId(), type: "VOICE", name: "Разговор", position: 1 },
        ],
      },
    },
    include: { channels: { orderBy: { position: "asc" } } },
  });

  // Отдаём тот же вид, что и в списке: клиент кладёт ответ в состояние
  // как есть, и объект без уровня или списка поддержавших ронял бы его.
  res.status(201).json({ server: toServerDto({ ...server, bannerUrl: null }, "OWNER", []) });
});

/** Настройки сервера: название и значок.
 *
 *  Правит владелец или администратор — тот, у кого есть server:edit.
 *  Участнику переименовывать общий сервер нельзя: это видят все. */
serversRouter.patch(
  "/:serverId",
  validateBody(updateServerSchema),
  async (req, res) => {
    const serverId = param(req, "serverId");
    const userId = currentUserId(req);
    const role = await requireMembership(userId, serverId);
    requirePermission(role, "server:edit");

    const { name, iconUrl, bannerUrl } = req.body as {
      name?: string;
      iconUrl?: string | null;
      bannerUrl?: string | null;
    };
    if (iconUrl) await requireOwnPicture(userId, iconUrl);
    if (bannerUrl) await requireOwnPicture(userId, bannerUrl);

    // Баннер — награда второго уровня. Проверяем здесь, а не только
    // в интерфейсе: кнопку можно не рисовать, а запрос — прислать.
    if (bannerUrl) {
      const boosts = await prisma.serverBoost.count({ where: { serverId } });
      if (boostLevel(boosts) < 2) {
        throw forbidden("Баннер открывается со второго уровня сервера");
      }
    }

    const before = await prisma.server.findUnique({
      where: { id: serverId },
      select: { iconUrl: true, bannerUrl: true },
    });

    const server = await prisma.server.update({
      where: { id: serverId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(iconUrl !== undefined ? { iconUrl } : {}),
        ...(bannerUrl !== undefined ? { bannerUrl } : {}),
      },
    });

    if (bannerUrl !== undefined && before?.bannerUrl !== server.bannerUrl) {
      await forgetPicture(before?.bannerUrl ?? null);
    }

    // Прежний значок убираем только после того, как записан новый.
    if (iconUrl !== undefined && before?.iconUrl !== server.iconUrl) {
      await forgetPicture(before?.iconUrl ?? null);
    }

    realtime().to(room.server(serverId)).emit("server:update", {
      id: server.id,
      name: server.name,
      iconUrl: server.iconUrl,
      bannerUrl: server.bannerUrl,
    });

    res.json({
      server: {
        id: server.id,
        name: server.name,
        iconUrl: server.iconUrl,
        bannerUrl: server.bannerUrl,
      },
    });
  },
);

/**
 * Поддержать сервер — или снять поддержку.
 *
 * Один буст на человека, поэтому не «сколько», а «да или нет»: PUT
 * ставит, DELETE снимает, повтор ничего не ломает. Денег здесь нет
 * и не предвидится — это голос за то, чтобы сервер подрос, а не покупка.
 */
serversRouter.put("/:serverId/boost", async (req, res) => {
  const serverId = param(req, "serverId");
  const userId = currentUserId(req);
  await requireMembership(userId, serverId);

  // Повторное нажатие не должно ни падать, ни удваивать: уникальный
  // индекс по паре и так не даст второй строки, а upsert превращает
  // это в обычное «уже поддержано».
  await prisma.serverBoost.upsert({
    where: { serverId_userId: { serverId, userId } },
    create: { id: newId(), serverId, userId },
    update: {},
  });

  res.json(await announceBoosts(serverId));
});

serversRouter.delete("/:serverId/boost", async (req, res) => {
  const serverId = param(req, "serverId");
  const userId = currentUserId(req);
  await requireMembership(userId, serverId);

  await prisma.serverBoost.deleteMany({ where: { serverId, userId } });

  res.json(await announceBoosts(serverId));
});

/** Пересчитать уровень и сказать всем. Возвращает то же, что уходит
 *  в событие: у нажавшего цифры меняются от ответа, у остальных —
 *  от события, и расходиться они не должны. */
async function announceBoosts(serverId: string) {
  const boosts = await prisma.serverBoost.findMany({
    where: { serverId },
    select: { userId: true },
  });
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { bannerUrl: true },
  });

  const level = boostLevel(boosts.length);
  const payload = {
    serverId,
    boostedBy: boosts.map((b) => b.userId),
    level,
    // Баннер появляется и исчезает вместе с уровнем — иначе снятие
    // буста оставляло бы награду висеть.
    bannerUrl: level >= 2 ? (server?.bannerUrl ?? null) : null,
  };

  realtime().to(room.server(serverId)).emit("server:boost", payload);
  return payload;
}

/**
 * Свои эмодзи сервера — награда третьего уровня.
 *
 * Заводит любой участник, а не только владелец: эмодзи — общая шутка,
 * а не настройка сервера, и просить разрешения ради картинки странно.
 * Убрать может тот, кто завёл, — или тот, кому позволено править
 * сервер: иначе неудачное эмодзи останется навсегда, если автор ушёл.
 */
serversRouter.post("/:serverId/emoji", async (req, res) => {
  const serverId = param(req, "serverId");
  const userId = currentUserId(req);
  await requireMembership(userId, serverId);

  const { name, url } = req.body as { name?: string; url?: string };
  const clean = String(name ?? "").trim().toLowerCase();

  if (!EMOJI_NAME.test(clean)) {
    throw badRequest(
      "BAD_NAME",
      "Имя — латиница, цифры и подчёркивание, от двух до тридцати двух символов",
    );
  }
  if (!url) throw badRequest("NO_IMAGE", "Сначала нужна картинка");

  // Уровень — первым делом, до всего остального. Проверять его здесь,
  // а не только в интерфейсе, обязательно: кнопку можно не рисовать,
  // а запрос — прислать.
  //
  // И именно первым: сначала стояла проверка картинки, и человек без
  // уровня получал «картинка не ваша» — ответ про другое, по которому
  // настоящую причину не угадать. Поймано проверкой.
  const boosts = await prisma.serverBoost.count({ where: { serverId } });
  if (boostLevel(boosts) < 3) {
    throw forbidden("Свои эмодзи открываются на третьем уровне сервера");
  }

  await requireOwnPicture(userId, url);

  const сколько = await prisma.emoji.count({ where: { serverId } });
  if (сколько >= EMOJI_LIMIT) {
    throw badRequest("TOO_MANY", `Больше ${EMOJI_LIMIT} эмодзи на сервер не поместится`);
  }

  const занято = await prisma.emoji.findUnique({
    where: { serverId_name: { serverId, name: clean } },
    select: { id: true },
  });
  if (занято) throw badRequest("NAME_TAKEN", "Эмодзи с таким именем уже есть");

  await prisma.emoji.create({
    data: { id: newId(), serverId, name: clean, url, createdBy: userId },
  });

  res.status(201).json(await announceEmoji(serverId));
});

serversRouter.delete("/:serverId/emoji/:emojiId", async (req, res) => {
  const serverId = param(req, "serverId");
  const emojiId = param(req, "emojiId");
  const userId = currentUserId(req);
  const role = await requireMembership(userId, serverId);

  const emoji = await prisma.emoji.findUnique({
    where: { id: emojiId },
    select: { serverId: true, createdBy: true, url: true },
  });
  if (!emoji || emoji.serverId !== serverId) throw notFound("Эмодзи не найдено");

  const своё = emoji.createdBy === userId;
  if (!своё) requirePermission(role, "server:edit");

  await prisma.emoji.delete({ where: { id: emojiId } });
  // Картинку убираем следом: она больше нигде не показывается,
  // а лежать сотнями килобайт годами ей незачем.
  await forgetPicture(emoji.url);

  res.json(await announceEmoji(serverId));
});

/** Разослать состав эмодзи всем на сервере. Целиком списком: их
 *  десятки, и разница между «добавили одно» и «вот все» здесь
 *  меньше, чем риск, что состояния разойдутся. */
async function announceEmoji(serverId: string) {
  const emoji = await prisma.emoji.findMany({
    where: { serverId },
    select: { id: true, name: true, url: true },
    orderBy: { name: "asc" },
  });

  realtime().to(room.server(serverId)).emit("server:emoji", { serverId, emoji });
  return { emoji };
}

serversRouter.get("/:serverId/members", async (req, res) => {
  const serverId = param(req, "serverId");
  await requireMembership(currentUserId(req), serverId);

  const members = await prisma.serverMember.findMany({
    where: { serverId },
    include: { user: true },
  });

  res.json({
    members: members.map((m) => ({ ...toPublicUser(m.user), role: m.role })),
  });
});

serversRouter.post(
  "/:serverId/channels",
  validateBody(createChannelSchema),
  async (req, res) => {
    const serverId = param(req, "serverId");
    const role = await requireMembership(currentUserId(req), serverId);
    requirePermission(role, "channel:create");

    const last = await prisma.channel.findFirst({
      where: { serverId },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    const channel = await prisma.channel.create({
      data: {
        id: newId(),
        serverId,
        type: req.body.type,
        name: req.body.name,
        position: (last?.position ?? -1) + 1,
      },
    });

    realtime().to(room.server(serverId)).emit("channel:create", {
      id: channel.id,
      serverId: channel.serverId,
      type: channel.type as "TEXT" | "VOICE",
      name: channel.name,
      topic: channel.topic,
      position: channel.position,
    });

    res.status(201).json({ channel });
  },
);
