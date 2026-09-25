import { clearPatientSession } from "@/lib/auth/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await clearPatientSession();
  return Response.json({ ok: true });
}
