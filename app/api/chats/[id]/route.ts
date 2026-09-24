import { getChat } from "@/lib/agent/chats";
import { requirePatientSession } from "@/lib/auth/session";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requirePatientSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const chat = await getChat(session.patientId, id);
  if (!chat) return Response.json({ error: "Chat not found." }, { status: 404 });
  return Response.json(chat);
}
