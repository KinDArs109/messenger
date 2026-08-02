import { PrismaClient } from "@prisma/client";
import { isProduction } from "../config/env.js";

/** Один экземпляр на процесс. При горячей перезагрузке через tsx watch
 *  модуль перевычисляется, и без кеша в globalThis мы бы открывали
 *  новый пул соединений на каждое сохранение файла — Postgres быстро
 *  упёрся бы в лимит подключений. */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ["error"] : ["warn", "error"],
  });

if (!isProduction) globalForPrisma.prisma = prisma;
