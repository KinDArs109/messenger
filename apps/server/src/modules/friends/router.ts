import { Router } from "express";
import type { Friendship, User } from "@prisma/client";
import { friendRequestSchema, room, type FriendshipDto } from "@messenger/shared";
import { validateBody } from "../../middleware/validate.js";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { prisma } from "../../db/client.js";
import { toPublicUser } from "../../lib/dto.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { realtime } from "../../realtime/emitter.js";

export const friendsRouter: Router = Router();

type WithUsers = Friendship & { requester: User; addressee: User };

/** Одна строка на пару, но показывать её надо с точки зрения
 *  смотрящего: собеседник — это всегда «другой», а заявка бывает
 *  входящей или исходящей в зависимости от того, кто её начал. */
function toDto(friendship: WithUsers, viewerId: string): FriendshipDto {
  const outgoing = friendship.requesterId === viewerId;
  return {
    id: friendship.id,
    user: toPublicUser(outgoing ? friendship.addressee : friendship.requester),
    status: friendship.status as "PENDING" | "ACCEPTED",
    direction: outgoing ? "outgoing" : "incoming",
    createdAt: friendship.createdAt.toISOString(),
  };
}

const withUsers = { include: { requester: true, addressee: true } } as const;

const involving = (userId: string) => ({
  OR: [{ requesterId: userId }, { addresseeId: userId }],
});

friendsRouter.get("/", requireAuth, async (req, res) => {
  const userId = currentUserId(req);
  const rows = await prisma.friendship.findMany({
    where: involving(userId),
    orderBy: { createdAt: "desc" },
    ...withUsers,
  });
  res.json({ friendships: rows.map((row) => toDto(row, userId)) });
});

friendsRouter.post("/", requireAuth, validateBody(friendRequestSchema), async (req, res) => {
  const userId = currentUserId(req);
  const { username } = req.body as { username: string };

  const target = await prisma.user.findUnique({ where: { username } });
  if (!target) throw notFound("Такого пользователя нет");
  if (target.id === userId) throw badRequest("SELF_FRIEND", "Себя добавить нельзя");

  // Ищем в обе стороны: индекс уникальности ловит только один
  // порядок, а заявка могла прийти навстречу.
  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: userId, addresseeId: target.id },
        { requesterId: target.id, addresseeId: userId },
      ],
    },
    ...withUsers,
  });

  if (existing) {
    if (existing.status === "ACCEPTED") throw conflict("ALREADY_FRIENDS", "Вы уже друзья");

    // Встречная заявка — это согласие. Заставлять двоих, которые
    // одновременно добавили друг друга, ещё и жать «принять» —
    // бессмысленная церемония.
    if (existing.requesterId === target.id) {
      const accepted = await prisma.friendship.update({
        where: { id: existing.id },
        data: { status: "ACCEPTED", acceptedAt: new Date() },
        ...withUsers,
      });
      const io = realtime();
      io.to(room.user(userId)).emit("friend:update", toDto(accepted, userId));
      io.to(room.user(target.id)).emit("friend:update", toDto(accepted, target.id));
      res.status(201).json({ friendship: toDto(accepted, userId) });
      return;
    }

    throw conflict("REQUEST_PENDING", "Заявка уже отправлена");
  }

  const created = await prisma.friendship.create({
    data: { id: newId(), requesterId: userId, addresseeId: target.id },
    ...withUsers,
  });

  const io = realtime();
  io.to(room.user(target.id)).emit("friend:update", toDto(created, target.id));
  res.status(201).json({ friendship: toDto(created, userId) });
});

friendsRouter.post("/:id/accept", requireAuth, async (req, res) => {
  const userId = currentUserId(req);

  // Принять может только адресат: иначе отправитель принимал бы
  // собственную заявку и заводил дружбу в одностороннем порядке.
  const friendship = await prisma.friendship.findFirst({
    where: { id: String(req.params.id), addresseeId: userId, status: "PENDING" },
  });
  if (!friendship) throw notFound("Заявка не найдена");

  const accepted = await prisma.friendship.update({
    where: { id: friendship.id },
    data: { status: "ACCEPTED", acceptedAt: new Date() },
    ...withUsers,
  });

  const io = realtime();
  io.to(room.user(userId)).emit("friend:update", toDto(accepted, userId));
  io.to(room.user(friendship.requesterId)).emit(
    "friend:update",
    toDto(accepted, friendship.requesterId),
  );

  res.json({ friendship: toDto(accepted, userId) });
});

/** Один метод на три действия: отклонить заявку, отменить свою
 *  и удалить из друзей. Все три — это исчезновение той же строки,
 *  и разводить их по разным маршрутам значило бы трижды написать
 *  одну и ту же проверку доступа. */
friendsRouter.delete("/:id", requireAuth, async (req, res) => {
  const userId = currentUserId(req);

  const friendship = await prisma.friendship.findFirst({
    where: { id: String(req.params.id), ...involving(userId) },
  });
  if (!friendship) throw notFound("Не найдено");

  await prisma.friendship.delete({ where: { id: friendship.id } });

  const other =
    friendship.requesterId === userId ? friendship.addresseeId : friendship.requesterId;

  const io = realtime();
  io.to(room.user(userId)).emit("friend:remove", { id: friendship.id });
  io.to(room.user(other)).emit("friend:remove", { id: friendship.id });

  res.status(204).end();
});
