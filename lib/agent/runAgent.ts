import { addMemory, searchMemory } from "@/lib/agent/memory";
import { buildSystemPrompt } from "@/lib/agent/systemPrompt";
import { TOOL_DEFINITIONS, executeTool, hasConfirmedChange, type ToolResult } from "@/lib/agent/tools";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { completeWithTools, completeWithToolsStream, type ModelMessage } from "@/lib/openrouter";

const MAX_TOOL_ROUNDS = 4;
const MUTATING_TOOLS = new Set(["bookAppointment", "cancelAppointment", "rescheduleAppointment"]);

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type ToolTraceEntry = {
  name: string;
  arguments: unknown;
  result: ToolResult;
};

export type AgentTurnResult = {
  reply: string;
  tools: Array<{
    name: string;
    arguments: unknown;
    ok: boolean;
    summary: string;
    data?: unknown;
  }>;
};

export async function runAgent(input: {
  patientId: string;
  patientName: string;
  history: ChatTurn[];
  message: string;
  /** Eval-only. Replaces that tool's result and writes nothing. */
  toolFault?: { tool: string; summary: string };
  /** Eval-only. Keeps one scenario's Mem0 notes off the real chart. */
  memoryUserId?: string;
  /** Chat UI. Receives text tokens from the final reply only. */
  onDelta?: (text: string) => void;
}): Promise<AgentTurnResult> {
  const memoryUserId = input.memoryUserId ?? input.patientId;
  const memories = await loadMemories(memoryUserId, input.message);
  const priorAssistantMessage = lastAssistantText(input.history);
  const messages: ModelMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt({
        patientName: input.patientName,
        memories,
        now: new Date(),
      }),
    },
    ...input.history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user", content: input.message },
  ];

  const toolTrace: ToolTraceEntry[] = [];
  let reply = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const assistant = input.onDelta
      ? await completeWithToolsStream({
          messages,
          tools: TOOL_DEFINITIONS,
          onDelta: input.onDelta,
        })
      : await completeWithTools({
          messages,
          tools: TOOL_DEFINITIONS,
        });
    messages.push(assistant);

    if (!assistant.tool_calls?.length) {
      reply = assistant.content?.trim() ?? "";
      break;
    }

    for (const call of assistant.tool_calls) {
      const args = parseArguments(call.function.arguments);
      const fault =
        input.toolFault && input.toolFault.tool === call.function.name
          ? input.toolFault
          : undefined;
      const premature =
        !fault &&
        MUTATING_TOOLS.has(call.function.name) &&
        !hasConfirmedChange(priorAssistantMessage, input.message);
      const result = premature
        ? {
            ok: false as const,
            summary:
              "Not called. Ask the patient to confirm the exact details, including the appointment id if they named one. Call this tool only after their next message agrees. Nothing was changed.",
          }
        : fault
        ? { ok: false as const, summary: fault.summary }
        : args === undefined
          ? {
              ok: false as const,
              summary: "Tool arguments were not valid JSON. Nothing was changed.",
            }
          : await executeTool(call.function.name, args, {
              patientId: input.patientId,
              latestUserMessage: input.message,
              priorAssistantMessage,
              userMessages: [
                ...input.history.filter((turn) => turn.role === "user").map((turn) => turn.content),
                input.message,
              ],
            });
      if (premature) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
        continue;
      }
      toolTrace.push({
        name: call.function.name,
        arguments: result.appliedArguments ?? args ?? call.function.arguments,
        result,
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  if (!reply) {
    reply =
      "I couldn't finish that request. Please ask about one appointment at a time. Nothing was changed unless a tool already reported success.";
  }

  const transcript: Prisma.InputJsonObject = {
    memories,
    history: input.history,
    toolTrace: JSON.parse(JSON.stringify(toolTrace)) as Prisma.InputJsonValue,
    messages: JSON.parse(JSON.stringify(messages)) as Prisma.InputJsonValue,
  };

  const log = await prisma.conversationLog.create({
    data: {
      patientId: input.patientId,
      userMessage: input.message,
      assistantMessage: reply,
      transcript,
    },
  });

  try {
    await addMemory(
      [
        { role: "user", content: input.message },
        { role: "assistant", content: reply },
      ],
      memoryUserId,
    );
  } catch (error) {
    const memoryError = error instanceof Error ? error.message : String(error);
    console.error("Mem0 add failed", error);
    await prisma.conversationLog.update({
      where: { id: log.id },
      data: { transcript: { ...transcript, memoryError } },
    });
  }

  return {
    reply,
    tools: toolTrace.map((entry) => ({
      name: entry.name,
      arguments: entry.arguments,
      ok: entry.result.ok,
      summary: entry.result.summary,
      data: entry.result.data,
    })),
  };
}

async function loadMemories(patientId: string, query: string): Promise<string[]> {
  try {
    const found = await searchMemory(query, patientId, 5);
    return readMemories(found);
  } catch (error) {
    console.error("Mem0 search failed", error);
    return [];
  }
}

function readMemories(value: unknown): string[] {
  const results = Array.isArray(value)
    ? value
    : value && typeof value === "object" && "results" in value
      ? value.results
      : [];
  if (!Array.isArray(results)) return [];
  return results
    .map((item) => {
      if (!item || typeof item !== "object" || !("memory" in item)) return "";
      const memory = item.memory;
      return typeof memory === "string" ? memory.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    })
    .filter((memory) => memory.length > 0)
    .slice(0, 5);
}

function lastAssistantText(history: ChatTurn[]): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index];
    if (turn.role === "assistant" && turn.content.trim()) return turn.content;
  }
  return null;
}

function parseArguments(raw: string): unknown | undefined {
  const text = raw.trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
