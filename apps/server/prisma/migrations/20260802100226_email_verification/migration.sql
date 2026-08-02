-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailCodeAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "emailCodeExpires" TIMESTAMP(3),
ADD COLUMN     "emailCodeHash" TEXT,
ADD COLUMN     "emailCodeSentAt" TIMESTAMP(3),
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);
