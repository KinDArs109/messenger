import { Router } from "express";
import type { Attachment, Message, User } from "@prisma/client";
import type { MessageDto } from "@messenger/shared";
import { fileUrl, thumbUrlFor } from "../../lib/storage.js";
import {
  editMessageSchema,
  mentionedUsernames,
  paginationQuerySchema,
  room,
  sendMessageSchema,
} from "@messenger/shared";
import { prisma } from "../../db/client.js";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { messageLimiter } from "../../middleware/rateLimit.js";
import { newId } from "../../lib/ids.js";
import { toPublicUser } from "../../lib/dto.js";
import { requireChannelAccess } from "../../lib/access.js";
import { param } from "../../lib/params.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { realtime } from "../../realtime/emitter.js";
import { isOnline } from "../../realtime/index.js";
import { notify, pushEnabled } from "../push/service.js";
import { can } from "@messenger/shared";

type FullMessage = Message & {
  author: User;
  attachments: Attachment[];
  reactions: { emoji: string; userId: string }[];
  replyTo: (Message & { author: { displayName: string } }) | null;
};

/** Сводку реакций считаем относительно того, кто спрашивает:
 *  признак «я тоже нажал» у каждого свой. */
function groupReactions(
  reactions: { emoji: string; userId: string }[],
  viewerId: string,
): MessageDto["reactions"] {
  const grouped = new Map<string, { count: number; me: boolean }>();
  for (const reaction of reactions) {
    const entry = grouped.get(reaction.emoji) ?? { count: 0, me: false };
    entry.count += 1;
    if (reaction.userId === viewerId) entry.me = true;
    grouped.set(reaction.emoji, entry);
  }
  return [...grouped].map(([emoji, data]) => ({ emoji, ...data }));
}

function toDto(message: FullMessage, viewerId: string): MessageDto {
  return {
    id: message.id,
    channelId: message.channelId,
    content: message.content,
    author: toPublicUser(message.author),
    reactions: groupReactions(message.reactions, viewerId),
    replyTo: message.replyTo
      ? {
          id: message.replyTo.id,
          authorName: message.replyTo.author.displayName,
          // Удалённое сообщение остаётся в базе, поэтому цитата
          // не превращается в пустоту — она честно говорит, что было.
          deleted: message.replyTo.deletedAt !== null,
          content: message.replyTo.deletedAt
            ? "сообщение удалено"
            : message.replyTo.content.slice(0, 140),
        }
      : null,
    attachments: message.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      size: a.size,
      mimeType: a.mimeType,
      // Ссылку собираем здесь: в базе лежит только ключ хранилища,
      // поэтому переезд на S3 не потребует переписывать данные.
      url: fileUrl(a.storageKey),
      thumbUrl: thumbUrlFor(a.storageKey, a.width),
      width: a.width,
      height: a.height,
      // Длительность есть только у записи голоса; у остальных null
      // и клиенту не мешает.
      duration: a.duration,
    })),
    editedAt: message.editedAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
  };
}

const withRelations = {
  author: true,
  attachments: true,
  reactions: { select: { emoji: true, userId: true } },
  replyTo: { include: { author: { select: { displayName: true } } } },
} as const;

export const channelsRouter: Router = Router();
channelsRouter.use(requireAuth);

/** История канала. Курсорная пагинация, а не OFFSET.
 *
 *  OFFSET заставляет базу пересчитывать и выбрасывать все пропущенные
 *  строки, поэтому чем глубже прокрутка, тем медленнее. Курсор по ULID
 *  бьёт точно в индекс [channelId, id DESC] и стоит одинаково на любой
 *  глубине. Разница на 25 тысячах сообщений — 0.08 мс против 2.7 мс. */
channelsRouter.get("/:channelId/messages", async (req, res) => {
  const userId = currentUserId(req);
  const channelId = param(req, "channelId");
  await requireChannelAccess(userId, channelId);

  const query = paginationQuerySchema.parse(req.query);

  const messages = await prisma.message.findMany({
    where: {
      channelId,
      deletedAt: null,
      ...(query.before ? { id: { lt: query.before } } : {}),
    },
    orderBy: { id: "desc" },
    take: query.limit,
    include: withRelations,
  });

  res.json({
    messages: messages.map((m) => toDto(m, userId)),
    // Клиенту не нужно гадать, есть ли ещё: если пришла полная страница,
    // отдаём курсор для следующей.
    nextCursor: messages.length === query.limit ? messages.at(-1)!.id : null,
  });
});

channelsRouter.post(
  "/:channelId/messages",
  messageLimiter,
  validateBody(sendMessageSchema),
  async (req, res) => {
    const userId = currentUserId(req);
    const channelId = param(req, "channelId");
    const access = await requireChannelAccess(userId, channelId);

    if (access.type === "VOICE") {
      throw badRequest("VOICE_CHANNEL", "В голосовой канал нельзя писать");
    }
    if (access.role && !can(access.role, "message:send")) throw forbidden();

    // Ответ должен быть на сообщение из этого же канала, иначе через
    // replyToId можно подтянуть чужое сообщение в свою переписку.
    if (req.body.replyToId) {
      const parent = await prisma.message.findFirst({
        where: { id: req.body.replyToId, channelId, deletedAt: null },
        select: { id: true },
      });
      if (!parent) throw badRequest("REPLY_NOT_FOUND", "Сообщение для ответа не найдено");
    }

    // Вложение можно прикрепить, только если его загрузил ты сам
    // и оно ещё ни к чему не привязано. Иначе по чужому идентификатору
    // можно было бы подтянуть в свой канал чужой файл.
    const attachmentIds = req.body.attachmentIds as string[];
    if (attachmentIds.length > 0) {
      const owned = await prisma.attachment.count({
        where: { id: { in: attachmentIds }, uploaderId: userId, messageId: null },
      });
      if (owned !== attachmentIds.length) {
        throw badRequest("BAD_ATTACHMENT", "Вложение не найдено или уже отправлено");
      }
    }

    const message = await prisma.message.create({
      data: {
        id: newId(),
        channelId,
        authorId: userId,
        content: req.body.content,
        replyToId: req.body.replyToId ?? null,
        ...(attachmentIds.length > 0
          ? { attachments: { connect: attachmentIds.map((id) => ({ id })) } }
          : {}),
      },
      include: withRelations,
    });

    // Новое сообщение реакций ещё не имеет, поэтому сводка одинакова
    // для всех — можно смело рассылать один и тот же объект.
    await countMentions(message.id, channelId, userId, req.body.content as string);

    const dto = toDto(message, userId);
    realtime().to(room.channel(channelId)).emit("message:new", dto);

    // Отдельно — всем, кто вообще имеет отношение к каналу, включая
    // тех, кто его сейчас не открыл. Иначе непрочитанное было бы видно
    // только там, куда человек и так смотрит.
    await announceActivity(channelId, message.id, userId);

    // Тем, у кого мессенджер закрыт, — уведомление на телефон. Ответ
    // этого не ждёт: письма идут через чужую службу доставки, и её
    // задержка не должна становиться задержкой отправки.
    void pushToAbsent(channelId, dto).catch((error: unknown) => {
      console.warn("Уведомления не разосланы:", error);
    });

    res.status(201).json({ message: dto });
  },
);

/** Сообщает о движении в канале тем, кто на него не подписан.
 *
 *  Для канала сервера адресат — комната сервера: в ней состоят все
 *  участники. Для личной переписки комнаты нет, поэтому шлём в личные
 *  комнаты собеседников. */
async function announceActivity(
  channelId: string,
  messageId: string,
  authorId: string,
): Promise<void> {
  const channel = await prisma.channel.findUniqueOrThrow({
    where: { id: channelId },
    select: { serverId: true, participants: { select: { userId: true } } },
  });

  const payload = { channelId, messageId, authorId };

  if (channel.serverId) {
    realtime().to(room.server(channel.serverId)).emit("channel:activity", payload);
    return;
  }

  for (const participant of channel.participants) {
    realtime().to(room.user(participant.userId)).emit("channel:activity", payload);
  }
}

/**
 * Постучаться в телефон тому, кого сейчас нет в сети.
 *
 * Кого нет — знает realtime: нет ни одного открытого соединения,
 * значит мессенджер закрыт и живое событие человеку никуда не придёт.
 * Тем, кто в сети, писать не надо ни в коем случае: у них сообщение
 * и так уже на экране, а второе уведомление поверх — это ровно то,
 * из-за чего уведомления и выключают.
 *
 * Молча и в стороне от ответа: сообщение уже создано и разослано,
 * и падать из-за недоставленного письма ему нельзя.
 */
async function pushToAbsent(channelId: string, message: MessageDto): Promise<void> {
  if (!pushEnabled) return;

  const channel = await prisma.channel.findUniqueOrThrow({
    where: { id: channelId },
    select: {
      name: true,
      serverId: true,
      server: { select: { name: true } },
      participants: { select: { userId: true } },
    },
  });

  // В канале сервера адресаты — все его участники, а не участники
  // канала: у канала сервера своего списка нет.
  const recipients = channel.serverId
    ? (
        await prisma.serverMember.findMany({
          where: { serverId: channel.serverId },
          select: { userId: true },
        })
      ).map((member) => member.userId)
    : channel.participants.map((participant) => participant.userId);

  const author = message.author.displayName;
  // В личной переписке имени достаточно: канал и есть человек.
  // В канале сервера без «где» уведомление бесполезно — их много.
  const title = channel.serverId ? `${author} · #${channel.name ?? "канал"}` : author;

  await Promise.all(
    recipients
      .filter((userId) => userId !== message.author.id && !isOnline(userId))
      .map((userId) =>
        notify(userId, {
          title,
          body: preview(message),
          channelId,
          // Один канал — одно уведомление: пять сообщений подряд
          // заменяют друг друга, а не выстраиваются столбиком.
          tag: channelId,
        }),
      ),
  );
}

/** Что показать в уведомлении. Длинное режем: в шторке всё равно
 *  видно две строки, а везти килобайт текста через службу доставки
 *  незачем. */
function preview(message: MessageDto): string {
  const text = message.content?.trim() ?? "";
  if (text) return text.length > 140 ? `${text.slice(0, 139)}…` : text;
  if (message.attachments.length > 0) {
    return message.attachments.length === 1 ? "Вложение" : `Вложений: ${message.attachments.length}`;
  }
  return "Новое сообщение";
}

/** Упоминания считаем на сервере, а не доверяем клиенту: иначе любой
 *  мог бы наставить себе или другим любые счётчики.
 *
 *  Упомянуть можно только того, кто и так видит канал. Иначе @admin
 *  в чужой переписке зажигал бы человеку счётчик у канала, куда он
 *  всё равно не попадёт. */
async function countMentions(
  messageId: string,
  channelId: string,
  authorId: string,
  content: string,
): Promise<void> {
  const usernames = mentionedUsernames(content);
  if (usernames.length === 0) return;

  const channel = await prisma.channel.findUniqueOrThrow({
    where: { id: channelId },
    select: { serverId: true },
  });

  const mentioned = await prisma.user.findMany({
    where: {
      username: { in: usernames },
      // Себя упомянуть можно, но счётчик от этого зажигать незачем.
      id: { not: authorId },
      ...(channel.serverId
        ? { memberships: { some: { serverId: channel.serverId } } }
        : { channelMemberships: { some: { channelId } } }),
    },
    select: { id: true },
  });

  await Promise.all(
    mentioned.map((user) =>
      prisma.readState.upsert({
        where: { userId_channelId: { userId: user.id, channelId } },
        create: { userId: user.id, channelId, mentionCount: 1 },
        update: { mentionCount: { increment: 1 } },
      }),
    ),
  );

  if (mentioned.length > 0) {
    for (const user of mentioned) {
      realtime()
        .to(room.user(user.id))
        .emit("mention", { channelId, messageId, serverId: channel.serverId });
    }
  }
}

export const messagesRouter: Router = Router();
messagesRouter.use(requireAuth);

messagesRouter.patch("/:messageId", validateBody(editMessageSchema), async (req, res) => {
  const userId = currentUserId(req);
  const existing = await prisma.message.findFirst({
    where: { id: param(req, "messageId"), deletedAt: null },
  });
  if (!existing) throw notFound("Сообщение не найдено");

  await requireChannelAccess(userId, existing.channelId);
  // Редактировать чужое нельзя никому, включая владельца сервера:
  // подменённые чужие слова — это другой класс проблемы, чем модерация.
  if (existing.authorId !== userId) throw forbidden("Можно править только свои сообщения");

  const updated = await prisma.message.update({
    where: { id: existing.id },
    data: { content: req.body.content, editedAt: new Date() },
  });

  realtime().to(room.channel(existing.channelId)).emit("message:update", {
    id: updated.id,
    channelId: updated.channelId,
    content: updated.content,
    editedAt: updated.editedAt!.toISOString(),
  });

  res.json({ message: { id: updated.id, content: updated.content } });
});

/** Реакция — не произвольная строка: без ограничения сюда пришлют
 *  пару килобайт текста и получат «реакцию» во всю ленту. */
const MAX_EMOJI_LENGTH = 12;

function readEmoji(raw: string): string {
  const emoji = decodeURIComponent(raw);
  if (emoji.length === 0 || emoji.length > MAX_EMOJI_LENGTH || /[\s\p{C}]/u.test(emoji)) {
    throw badRequest("BAD_EMOJI", "Недопустимая реакция");
  }
  return emoji;
}

async function loadForReaction(userId: string, messageId: string) {
  const message = await prisma.message.findFirst({
    where: { id: messageId, deletedAt: null },
    select: { id: true, channelId: true },
  });
  if (!message) throw notFound("Сообщение не найдено");
  await requireChannelAccess(userId, message.channelId);
  return message;
}

messagesRouter.put("/:messageId/reactions/:emoji", async (req, res) => {
  const userId = currentUserId(req);
  const emoji = readEmoji(param(req, "emoji"));
  const message = await loadForReaction(userId, param(req, "messageId"));

  // Повторное нажатие не должно падать: клиент мог не дождаться ответа
  // и отправить дважды. Составной ключ делает операцию идемпотентной.
  await prisma.reaction.upsert({
    where: { messageId_userId_emoji: { messageId: message.id, userId, emoji } },
    create: { messageId: message.id, userId, emoji },
    update: {},
  });

  realtime().to(room.channel(message.channelId)).emit("reaction:add", {
    channelId: message.channelId,
    messageId: message.id,
    userId,
    emoji,
  });

  res.status(204).end();
});

messagesRouter.delete("/:messageId/reactions/:emoji", async (req, res) => {
  const userId = currentUserId(req);
  const emoji = readEmoji(param(req, "emoji"));
  const message = await loadForReaction(userId, param(req, "messageId"));

  await prisma.reaction.deleteMany({ where: { messageId: message.id, userId, emoji } });

  realtime().to(room.channel(message.channelId)).emit("reaction:remove", {
    channelId: message.channelId,
    messageId: message.id,
    userId,
    emoji,
  });

  res.status(204).end();
});

messagesRouter.delete("/:messageId", async (req, res) => {
  const userId = currentUserId(req);
  const existing = await prisma.message.findFirst({
    where: { id: param(req, "messageId"), deletedAt: null },
  });
  if (!existing) throw notFound("Сообщение не найдено");

  const access = await requireChannelAccess(userId, existing.channelId);

  // Своё — всегда; чужое — только модератору сервера.
  const isAuthor = existing.authorId === userId;
  const isModerator = access.role ? can(access.role, "message:deleteAny") : false;
  if (!isAuthor && !isModerator) throw forbidden();

  // Мягкое удаление: строка остаётся, поэтому ответы на неё не ломаются,
  // а модератор при жалобе может увидеть, что именно было написано.
  await prisma.message.update({
    where: { id: existing.id },
    data: { deletedAt: new Date() },
  });

  realtime()
    .to(room.channel(existing.channelId))
    .emit("message:delete", { id: existing.id, channelId: existing.channelId });

  res.status(204).end();
});
