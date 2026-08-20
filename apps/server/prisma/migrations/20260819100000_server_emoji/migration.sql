-- Свои эмодзи сервера — награда третьего уровня буста.
--
-- Имя уникально внутри сервера: в сообщении эмодзи стоит как :название:,
-- и два одинаковых имени означали бы, что непонятно, какая картинка
-- нарисуется.
CREATE TABLE "Emoji" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Emoji_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Emoji_serverId_name_key" ON "Emoji"("serverId", "name");
CREATE INDEX "Emoji_serverId_idx" ON "Emoji"("serverId");

ALTER TABLE "Emoji" ADD CONSTRAINT "Emoji_serverId_fkey"
    FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Emoji" ADD CONSTRAINT "Emoji_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
