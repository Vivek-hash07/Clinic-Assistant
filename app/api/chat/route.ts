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

  try {
    const result = await runAgent({
      patientId: session.patientId,
      patientName: session.name ?? "Patient",
      history: parsed.history,
      message: parsed.message,
    });
    return Response.json(result);
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: "The assistant is unavailable right now." },
      { status: 500 },
    );
  }
}

function parseBody(
  value: unknown,
): { message: string; history: ChatTurn[] } | { error: string } {
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

  return { message: body.message.trim(), history };
}
