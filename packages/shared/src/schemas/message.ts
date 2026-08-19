import { z } from "zod";
import { LIMITS } from "../constants.js";
import { ulidSchema, uploadUrlSchema } from "./common.js";

export const sendMessageSchema = z
  .object({
    content: z
      .string()
      .trim()
      .max(LIMITS.messageContent.max, `Максимум ${LIMITS.messageContent.max} символов`)
      .default(""),
    replyToId: ulidSchema.optional(),
    attachmentIds: z.array(ulidSchema).max(10).default([]),
  })
  // Сообщение из одной картинки без текста — обычное дело,
  // поэтому пустым считается только то, где нет ни того, ни другого.
  .refine((v) => v.content.length > 0 || v.attachmentIds.length > 0, {
    message: "Сообщение не может быть пустым",
    path: ["content"],
  });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Сообщение не может быть пустым")
    .max(LIMITS.messageContent.max),
});
export type EditMessageInput = z.infer<typeof editMessageSchema>;

export const createServerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(LIMITS.serverName.min, "Слишком короткое название")
    .max(LIMITS.serverName.max, `Максимум ${LIMITS.serverName.max} символов`),
});

/** Правка сервера. Оба поля необязательны и меняются порознь:
 *  переименование и смена значка — разные действия в разных местах
 *  окна, и присылать одно вместе с другим только чтобы «ничего не
 *  затереть» — верный способ однажды затереть. */
export const updateServerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(LIMITS.serverName.min, "Слишком короткое название")
      .max(LIMITS.serverName.max, `Максимум ${LIMITS.serverName.max} символов`)
      .optional(),
    // null — убрать значок и вернуться к буквам.
    iconUrl: uploadUrlSchema.nullable().optional(),
    // Баннер над списком каналов. Открывается со второго уровня буста —
    // проверяет это сервер, схема лишь следит за формой ссылки.
    bannerUrl: uploadUrlSchema.nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.iconUrl !== undefined, {
    message: "Менять нечего",
    path: ["name"],
  });
export type UpdateServerInput = z.infer<typeof updateServerSchema>;

export const createChannelSchema = z.object({
  name: z
    .string()
    .trim()
    .min(LIMITS.channelName.min, "Укажите название")
    .max(LIMITS.channelName.max, `Максимум ${LIMITS.channelName.max} символов`),
  type: z.enum(["TEXT", "VOICE"]).default("TEXT"),
});
