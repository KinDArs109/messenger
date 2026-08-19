import { Router } from "express";
import { room, updateProfileSchema } from "@messenger/shared";
import { validateBody } from "../../middleware/validate.js";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { prisma } from "../../db/client.js";
import { toPrivateUser, toPublicUser } from "../../lib/dto.js";
import { notFound } from "../../lib/errors.js";
import { forgetPicture, requireOwnPicture } from "../../lib/pictures.js";
import { realtime } from "../../realtime/emitter.js";

export const usersRouter: Router = Router();

usersRouter.patch("/me", requireAuth, validateBody(updateProfileSchema), async (req, res) => {
  const userId = currentUserId(req);
  const { displayName, avatarUrl } = req.body as {
    displayName?: string;
    avatarUrl?: string | null;
  };

  if (avatarUrl) await requireOwnPicture(userId, avatarUrl);

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true },
  });

  // Имя пользователя не меняется — ни здесь, ни где-либо ещё.
  // По нему упоминают, находят в друзьях и входят; смена рвала бы
  // всё это разом, а освободившийся логин мог бы занять кто угодно
  // и начать получать чужие упоминания.
  const user = await prisma.user
    .update({
      where: { id: userId },
      data: {
        ...(displayName !== undefined ? { displayName } : {}),
        ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      },
    })
    .catch(() => null);

  if (!user) throw notFound("Пользователь не найден");

  // Прежний аватар — уже после того, как записан новый: сначала
  // человек должен остаться с картинкой, и только потом старая
  // перестаёт быть нужной.
  if (avatarUrl !== undefined && before?.avatarUrl !== user.avatarUrl) {
    await forgetPicture(before?.avatarUrl ?? null);
  }

  // Имя видно в каждом сообщении и в списке участников. Без рассылки
  // собеседники видели бы старое до перезагрузки страницы.
  const io = realtime();
  const memberships = await prisma.serverMember.findMany({
    where: { userId },
    select: { serverId: true },
  });
  const payload = toPublicUser(user);
  for (const { serverId } of memberships) {
    io.to(room.server(serverId)).emit("user:update", payload);
  }
  io.to(room.user(userId)).emit("user:update", payload);

  res.json({ user: toPrivateUser(user) });
});
