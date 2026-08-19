-- Поддержка сервера участником — один буст на человека.
--
-- Денег здесь нет: это не покупка, а голос за то, чтобы сервер подрос.
-- Уникальность по паре (сервер, человек) и есть всё правило.
CREATE TABLE "ServerBoost" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerBoost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServerBoost_serverId_userId_key" ON "ServerBoost"("serverId", "userId");
CREATE INDEX "ServerBoost_serverId_idx" ON "ServerBoost"("serverId");

ALTER TABLE "ServerBoost" ADD CONSTRAINT "ServerBoost_serverId_fkey"
    FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServerBoost" ADD CONSTRAINT "ServerBoost_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Баннер над списком каналов: открывается со второго уровня.
ALTER TABLE "Server" ADD COLUMN "bannerUrl" TEXT;
