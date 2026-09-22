import { registerPatient } from "@/lib/auth/register";

export async function POST(request: Request) {
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

  return Response.json(
    { ok: true, email: result.email, patientId: result.patientId },
    { status: 201 },
  );
}
