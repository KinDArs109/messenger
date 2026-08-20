-- Второй шаг входа: код, который приходит письмом.
ALTER TABLE "User" ADD COLUMN "loginCodeHash" TEXT;
ALTER TABLE "User" ADD COLUMN "loginCodeExpires" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "loginCodeSentAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "loginCodeAttempts" INTEGER NOT NULL DEFAULT 0;
