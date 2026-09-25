import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function hasChatThreads(client: PrismaClient): boolean {
  return typeof (client as { chatThread?: { findMany?: unknown } }).chatThread?.findMany === "function";
}

/** Neon appends libpq-only params. node-postgres forwards them and the pooler rejects the connection on Vercel. */
function serverlessConnectionString(raw: string): string {
  const url = new URL(raw);
  url.searchParams.delete("channel_binding");
  url.searchParams.delete("sslmode");
  return url.toString();
}

function createPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const adapter = new PrismaPg({
    connectionString: serverlessConnectionString(connectionString),
    max: 1,
    connectionTimeoutMillis: 15_000,
    ssl: { rejectUnauthorized: false },
  });
  return new PrismaClient({ adapter });
}

const cached = globalForPrisma.prisma;
export const prisma = cached && hasChatThreads(cached) ? cached : createPrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
