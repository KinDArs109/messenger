-- AlterTable
ALTER TABLE "User" ADD COLUMN     "resetCodeAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "resetCodeExpires" TIMESTAMP(3),
ADD COLUMN     "resetCodeHash" TEXT,
ADD COLUMN     "resetCodeSentAt" TIMESTAMP(3);
