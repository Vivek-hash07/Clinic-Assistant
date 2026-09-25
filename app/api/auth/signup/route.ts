import { registerPatient } from "@/lib/auth/register";
import { createPatientSession } from "@/lib/auth/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    return await createAccount(request);
  } catch (error) {
    console.error(
      "signup failed",
      error instanceof Error ? error.message : error,
    );
    return Response.json(
      { error: "Could not create the account." },
      { status: 500 },
    );
  }
}

async function createAccount(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const input =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

  const result = await registerPatient({
    name: input.name,
    email: input.email,
    password: input.password,
    dob: input.dob,
  });

  if (!result.ok) {
    return Response.json(
      { error: result.error, fieldErrors: result.fieldErrors },
      { status: result.status },
    );
  }

  await createPatientSession({
    id: result.userId,
    email: result.email,
    name: result.name,
    patientId: result.patientId,
  });

  return Response.json(
    { ok: true, email: result.email, patientId: result.patientId },
    { status: 201 },
  );
}
