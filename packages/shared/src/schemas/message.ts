import { z } from "zod";
import { LIMITS } from "../constants.js";
import { ulidSchema } from "./common.js";

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

export const createChannelSchema = z.object({
  name: z
    .string()
    .trim()
    .min(LIMITS.channelName.min, "Укажите название")
    .max(LIMITS.channelName.max, `Максимум ${LIMITS.channelName.max} символов`),
  type: z.enum(["TEXT", "VOICE"]).default("TEXT"),
});
