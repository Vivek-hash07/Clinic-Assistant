import { requirePatientSession } from "@/lib/auth/session";

export async function GET() {
  return handle();
}

export async function POST(request: Request) {
  // Read the body so a client-supplied patientId cannot sit unused as an
  // implicit input. The id below comes only from the server session.
  await request.json().catch(() => null);
  return handle();
}

async function handle() {
  const session = await requirePatientSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return Response.json({
    ok: true,
    patientId: session.patientId,
  });
}
