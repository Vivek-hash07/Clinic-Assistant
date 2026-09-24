import { PrismaClient } from "@/lib/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function hasChatThreads(client: PrismaClient): boolean {
  return typeof (client as { chatThread?: { findMany?: unknown } }).chatThread?.findMany === "function";
}

const cached = globalForPrisma.prisma;
export const prisma = cached && hasChatThreads(cached) ? cached : new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
