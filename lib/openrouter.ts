export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

const DEFAULT_MODEL = "openai/gpt-4o-mini";

export async function completeChat(
  messages: ChatMessage[],
  model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const response = await postChat({ model, messages });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter request failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as OpenRouterResponse;
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenRouter returned an empty completion");
  }

  return content;
}

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ModelMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type ToolCompletion = {
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: unknown };
      }>;
    };
  }>;
};

export async function completeWithTools(input: {
  messages: ModelMessage[];
  tools: ToolDefinition[];
  model?: string;
}): Promise<{ role: "assistant"; content: string | null; tool_calls?: ToolCall[] }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const response = await postChat({
    model: input.model || process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    messages: input.messages,
    tools: input.tools,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `OpenRouter request failed (${response.status}): ${body.slice(0, 500)}`,
    );
  }

  const data = (await response.json()) as ToolCompletion;
  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new Error("OpenRouter returned no assistant message");
  }

  const toolCalls = (message.tool_calls ?? [])
    .map((call, index): ToolCall | null => {
      const name = call.function?.name;
      if (!name) return null;
      const args = call.function?.arguments;
      return {
        id: call.id || `call_${index}`,
        type: "function",
        function: {
          name,
          arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
        },
      };
    })
    .filter((call): call is ToolCall => call !== null);

  return {
    role: "assistant",
    content: readContent(message.content),
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

type StreamChunk = {
  choices?: Array<{
    delta?: {
      content?: unknown;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
};

/** Streams the final text. Tool-call rounds are assembled and not forwarded. */
export async function completeWithToolsStream(input: {
  messages: ModelMessage[];
  tools: ToolDefinition[];
  model?: string;
  onDelta?: (text: string) => void;
}): Promise<{ role: "assistant"; content: string | null; tool_calls?: ToolCall[] }> {
  const response = await postChat({
    model: input.model || process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    messages: input.messages,
    tools: input.tools,
    stream: true,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `OpenRouter request failed (${response.status}): ${body.slice(0, 500)}`,
    );
  }
  if (!response.body) {
    throw new Error("OpenRouter returned no stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let sawTool = false;
  const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let chunk: StreamChunk;
      try {
        chunk = JSON.parse(data) as StreamChunk;
      } catch {
        continue;
      }
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.tool_calls?.length) {
        sawTool = true;
        for (const call of delta.tool_calls) {
          const index = call.index ?? 0;
          const current = toolCalls[index] ?? { id: "", name: "", arguments: "" };
          if (call.id) current.id = call.id;
          if (call.function?.name) current.name += call.function.name;
          if (typeof call.function?.arguments === "string") {
            current.arguments += call.function.arguments;
          }
          toolCalls[index] = current;
        }
      }
      if (typeof delta.content === "string" && delta.content && !sawTool) {
        content += delta.content;
        input.onDelta?.(delta.content);
      }
    }
  }

  const calls = toolCalls
    .filter((call) => call.name)
    .map((call, index): ToolCall => ({
      id: call.id || `call_${index}`,
      type: "function",
      function: { name: call.name, arguments: call.arguments || "{}" },
    }));

  return {
    role: "assistant",
    content: content.trim() || null,
    tool_calls: calls.length > 0 ? calls : undefined,
  };
}

async function postChat(body: unknown): Promise<Response> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`OpenRouter request failed (${response.status})`);
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OpenRouter request failed");
}

function readContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return String(part.text);
      }
      return "";
    })
    .join("")
    .trim();
  return text || null;
}
