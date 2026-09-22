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

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages }),
  });

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

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model || process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
      messages: input.messages,
      tools: input.tools,
    }),
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
