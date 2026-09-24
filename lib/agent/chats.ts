import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/lib/generated/prisma/client";

export type StoredMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

const TITLE_LIMIT = 48;

export function summarizeChat(message: string): string {
  const text = message.replace(/\s+/g, " ").trim();
  const sentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  if (sentence.length <= TITLE_LIMIT) return sentence || "New chat";
  const cut = sentence.slice(0, TITLE_LIMIT);
  const lastSpace = cut.lastIndexOf(" ");
  const shortened = (lastSpace > 24 ? cut.slice(0, lastSpace) : cut).trimEnd();
  return `${shortened}…`;
}

function readMessages(value: unknown): StoredMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (record.role !== "user" && record.role !== "assistant") return [];
    if (typeof record.content !== "string") return [];
    return [{ role: record.role, content: record.content }];
  });
}

const SESSION_GAP_MS = 30 * 60 * 1000;

/** Turns that failed to save still sit in ConversationLog. Group them into sidebar chats. */
async function backfillThreads(patientId: string) {
  const existing = await prisma.chatThread.count({ where: { patientId } });
  if (existing > 0) return;

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { user: { select: { email: true } } },
  });
  if (!patient || patient.user.email.endsWith("@clinic.example")) return;

  const logs = await prisma.conversationLog.findMany({
    where: { patientId },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, userMessage: true, assistantMessage: true },
  });

  let messages: StoredMessage[] = [];
  let title = "New chat";
  let startedAt: Date | null = null;
  let updatedAt: Date | null = null;

  async function flush() {
    if (!startedAt || !updatedAt || messages.length === 0) return;
    await prisma.chatThread.create({
      data: {
        patientId,
        title,
        messages: messages as unknown as Prisma.InputJsonValue,
        createdAt: startedAt,
        updatedAt,
      },
    });
    messages = [];
    startedAt = null;
    updatedAt = null;
  }

  for (const log of logs) {
    if (updatedAt && log.createdAt.getTime() - updatedAt.getTime() > SESSION_GAP_MS) {
      await flush();
    }
    if (!startedAt) {
      startedAt = log.createdAt;
      title = summarizeChat(log.userMessage);
    }
    messages.push({ role: "user", content: log.userMessage });
    if (log.assistantMessage.trim()) {
      messages.push({ role: "assistant", content: log.assistantMessage });
    }
    updatedAt = log.createdAt;
  }
  await flush();
}

export async function listChats(patientId: string): Promise<ChatSummary[]> {
  await backfillThreads(patientId);
  const rows = await prisma.chatThread.findMany({
    where: { patientId },
    orderBy: { updatedAt: "desc" },
    take: 40,
    select: { id: true, title: true, updatedAt: true },
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function getChat(patientId: string, id: string) {
  const row = await prisma.chatThread.findFirst({
    where: { id, patientId },
  });
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    messages: readMessages(row.messages),
  };
}

export async function appendChatTurn(
  patientId: string,
  conversationId: string | null,
  turns: StoredMessage[],
): Promise<ChatSummary | null> {
  const existing = conversationId
    ? await prisma.chatThread.findFirst({ where: { id: conversationId, patientId } })
    : null;
  if (conversationId && !existing) return null;
  const prior = existing ? readMessages(existing.messages) : [];
  const messages = [...prior, ...turns];
  const title =
    existing && existing.title !== "New chat"
      ? existing.title
      : summarizeChat(messages.find((turn) => turn.role === "user")?.content ?? turns[0]?.content ?? "");

  if (existing) {
    const row = await prisma.chatThread.update({
      where: { id: existing.id },
      data: { title, messages: messages as unknown as Prisma.InputJsonValue },
    });
    return { id: row.id, title: row.title, updatedAt: row.updatedAt.toISOString() };
  }

  const row = await prisma.chatThread.create({
    data: {
      patientId,
      title,
      messages: messages as unknown as Prisma.InputJsonValue,
    },
  });
  return { id: row.id, title: row.title, updatedAt: row.updatedAt.toISOString() };
}
