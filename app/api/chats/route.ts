import { appendChatTurn, listChats } from "@/lib/agent/chats";
import { requirePatientSession } from "@/lib/auth/session";

export async function GET() {
  const session = await requirePatientSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const chats = await listChats(session.patientId);
  return Response.json({ chats });
}

export async function POST(request: Request) {
  const session = await requirePatientSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Expected a JSON object." }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const content = typeof record.content === "string" ? record.content.trim() : "";
  if (!content || content.length > 8000) {
    return Response.json({ error: "A message is required." }, { status: 400 });
  }
  const conversationId =
    typeof record.conversationId === "string" && record.conversationId.trim()
      ? record.conversationId.trim()
      : null;

  const chat = await appendChatTurn(session.patientId, conversationId, [
    { role: "assistant", content },
  ]);
  if (!chat) return Response.json({ error: "Chat not found." }, { status: 404 });
  return Response.json(chat);
}
