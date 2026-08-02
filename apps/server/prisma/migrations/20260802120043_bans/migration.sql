-- CreateTable
CREATE TABLE "Ban" (
    "serverId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "bannedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ban_pkey" PRIMARY KEY ("serverId","userId")
);

-- CreateIndex
CREATE INDEX "Ban_userId_idx" ON "Ban"("userId");

-- AddForeignKey
ALTER TABLE "Ban" ADD CONSTRAINT "Ban_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ban" ADD CONSTRAINT "Ban_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ban" ADD CONSTRAINT "Ban_bannedById_fkey" FOREIGN KEY ("bannedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
