import { addMemory, searchMemory } from "@/lib/agent/memory";
import { buildSystemPrompt } from "@/lib/agent/systemPrompt";
import { TOOL_DEFINITIONS, executeTool, type ToolResult } from "@/lib/agent/tools";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { completeWithTools, type ModelMessage } from "@/lib/openrouter";

const MAX_TOOL_ROUNDS = 4;

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
  tools: Array<{ name: string; ok: boolean; summary: string }>;
};

export async function runAgent(input: {
  patientId: string;
  patientName: string;
  history: ChatTurn[];
  message: string;
}): Promise<AgentTurnResult> {
  const memories = await loadMemories(input.patientId, input.message);
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
    const assistant = await completeWithTools({
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
      const result =
        args === undefined
          ? {
              ok: false,
              summary: "Tool arguments were not valid JSON. Nothing was changed.",
            }
          : await executeTool(call.function.name, args, {
              patientId: input.patientId,
              latestUserMessage: input.message,
              priorAssistantMessage,
            });
      toolTrace.push({
        name: call.function.name,
        arguments: args ?? call.function.arguments,
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
      input.patientId,
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
      ok: entry.result.ok,
      summary: entry.result.summary,
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
