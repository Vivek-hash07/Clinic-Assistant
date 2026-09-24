import { appendChatTurn } from "@/lib/agent/chats";
import { runAgent, type ChatTurn } from "@/lib/agent/runAgent";
import { requirePatientSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  const session = await requirePatientSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = parseBody(body);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        const result = await runAgent({
          patientId: session.patientId,
          patientName: session.name ?? "Patient",
          history: parsed.history,
          message: parsed.message,
          onDelta: (text) => send({ delta: text }),
        });
        let conversationId = parsed.conversationId;
        let title: string | undefined;
        try {
          const chat = await appendChatTurn(session.patientId, parsed.conversationId, [
            { role: "user", content: parsed.message },
            { role: "assistant", content: result.reply },
          ]);
          if (chat) {
            conversationId = chat.id;
            title = chat.title;
          }
        } catch (error) {
          console.error("Chat thread was not saved", error);
        }
        send({
          done: true,
          reply: result.reply,
          conversationId,
          title,
        });
      } catch (error) {
        console.error(error);
        send({ error: "The assistant is unavailable right now." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

function parseBody(
  value: unknown,
): { message: string; history: ChatTurn[]; conversationId: string | null } | { error: string } {
  if (!value || typeof value !== "object") return { error: "Expected a JSON object." };
  const body = value as Record<string, unknown>;
  if (typeof body.message !== "string" || body.message.trim().length === 0) {
    return { error: "Message is required." };
  }
  if (body.message.length > 4000) return { error: "Message is too long." };

  const history: ChatTurn[] = [];
  if (body.history !== undefined) {
    if (!Array.isArray(body.history) || body.history.length > 40) {
      return { error: "History must be an array of at most 40 messages." };
    }
    for (const item of body.history) {
      if (!item || typeof item !== "object") return { error: "Invalid history entry." };
      const entry = item as Record<string, unknown>;
      if (entry.role !== "user" && entry.role !== "assistant") {
        return { error: "History roles must be user or assistant." };
      }
      if (typeof entry.content !== "string" || entry.content.length > 8000) {
        return { error: "Invalid history content." };
      }
      history.push({ role: entry.role, content: entry.content });
    }
  }

  const conversationId =
    typeof body.conversationId === "string" && body.conversationId.trim()
      ? body.conversationId.trim()
      : null;
  if (conversationId && conversationId.length > 64) {
    return { error: "Invalid conversation." };
  }

  return { message: body.message.trim(), history, conversationId };
}
