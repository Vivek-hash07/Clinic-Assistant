import {
  bookManualAppointment,
  listOpenSlots,
  listPatientAppointments,
} from "@/lib/agent/tools";
import { requirePatientSession } from "@/lib/auth/session";

export async function GET(request: Request) {
  const session = await requirePatientSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const doctor = url.searchParams.get("doctor");
  const date = url.searchParams.get("date");
  if (doctor || date) {
    if (!doctor || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json(
        { ok: false, summary: "Choose a doctor and a date." },
        { status: 400 },
      );
    }
    const result = await listOpenSlots(doctor, date);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  }

  const result = await listPatientAppointments(session.patientId);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}

export async function POST(request: Request) {
  const session = await requirePatientSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, summary: "Expected a JSON object." }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const result = await bookManualAppointment(session.patientId, {
    doctor: typeof record.doctor === "string" ? record.doctor : "",
    datetime: typeof record.datetime === "string" ? record.datetime : "",
    reason: typeof record.reason === "string" ? record.reason : "",
  });
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
