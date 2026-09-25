import { signInWithPassword } from "@/lib/auth/credentials";
import { createPatientSession } from "@/lib/auth/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const result = await signInWithPassword(input.email, input.password);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  try {
    await createPatientSession(result.user);
  } catch (error) {
    console.error(
      "session cookie failed",
      error instanceof Error ? error.message : error,
    );
    return Response.json(
      { error: "Sign-in is unavailable right now. Try again in a moment." },
      { status: 503 },
    );
  }

  return Response.json({ ok: true });
}
