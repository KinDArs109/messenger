import { z } from "zod";

/** Причина бана необязательна: чаще всего она очевидна обоим,
 *  а требовать формулировку — лишний шаг в неприятный момент. */
export const banSchema = z.object({
  reason: z.string().trim().max(200, "Максимум 200 символов").optional(),
});

export interface BanDto {
  user: { id: string; username: string; displayName: string; avatarUrl: string | null };
  reason: string | null;
  createdAt: string;
}

export const createInviteSchema = z.object({
  /** null — бессрочная ссылка. По умолчанию неделя: ссылка, живущая
   *  вечно, однажды утекает в переписку, и её уже не отозвать. */
  expiresInHours: z.number().int().min(1).max(24 * 30).nullable().default(24 * 7),
  /** null — без ограничения по числу входов. */
  maxUses: z.number().int().min(1).max(1000).nullable().default(null),
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export interface InvitePreview {
  code: string;
  server: { id: string; name: string; iconUrl: string | null };
  memberCount: number;
  inviter: string;
  /** Уже состоит на сервере — тогда вместо «Принять» показываем «Открыть». */
  alreadyMember: boolean;
}
