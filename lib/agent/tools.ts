import {
  CLOSE_MINUTES,
  DOCTORS,
  OPEN_MINUTES,
  SLOT_MINUTES,
  formatSlot,
} from "@/lib/agent/clinic";
import { prisma } from "@/lib/db/prisma";
import { AppointmentStatus } from "@/lib/generated/prisma/client";
import type { ToolDefinition } from "@/lib/openrouter";

export type ToolSession = {
  patientId: string;
  latestUserMessage: string;
  priorAssistantMessage: string | null;
  /** Every patient message in this chat, including the latest. */
  userMessages: string[];
};

export type ToolResult = {
  ok: boolean;
  summary: string;
  data?: unknown;
  /** Id the server actually used, when it refused a substitute or repaired a fake id. */
  appliedArguments?: Record<string, unknown>;
};

const dateRangeSchema = {
  type: "object",
  description: "Inclusive UTC dates, YYYY-MM-DD. Maximum 14 days.",
  properties: {
    start: { type: "string", description: "First day, YYYY-MM-DD." },
    end: { type: "string", description: "Last day, YYYY-MM-DD." },
  },
  required: ["start", "end"],
  additionalProperties: false,
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "checkAvailability",
      description:
        "List open appointment slots for one clinic doctor between two dates. Does not book anything.",
      parameters: {
        type: "object",
        properties: {
          doctor: {
            type: "string",
            description: `One of: ${DOCTORS.join(", ")}.`,
          },
          dateRange: dateRangeSchema,
        },
        required: ["doctor", "dateRange"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bookAppointment",
      description:
        "Book a slot for the signed-in patient. Call only after they confirmed the doctor, datetime, and reason in a later message. There is no patientId argument; the server uses the signed-in chart.",
      parameters: {
        type: "object",
        properties: {
          doctor: { type: "string" },
          datetime: {
            type: "string",
            description: "ISO-8601 UTC start time returned by checkAvailability.",
          },
          reason: { type: "string", description: "Why the patient is coming in, in their words." },
        },
        required: ["doctor", "datetime", "reason"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancelAppointment",
      description:
        "Cancel one scheduled appointment on the signed-in patient's chart. Call only after they confirmed the appointment id. Ids from other people will not match.",
      parameters: {
        type: "object",
        properties: {
          appointmentId: { type: "string" },
        },
        required: ["appointmentId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rescheduleAppointment",
      description:
        "Move one scheduled appointment on the signed-in patient's chart to a new datetime. Call only after they confirmed the appointment id and the new time.",
      parameters: {
        type: "object",
        properties: {
          appointmentId: { type: "string" },
          newDatetime: {
            type: "string",
            description: "ISO-8601 UTC start time.",
          },
        },
        required: ["appointmentId", "newDatetime"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listMyAppointments",
      description:
        "List appointments on the signed-in patient's chart only. Takes no arguments.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
];

export async function executeTool(
  name: string,
  rawArgs: unknown,
  session: ToolSession,
): Promise<ToolResult> {
  const args = asRecord(rawArgs);
  const foreign = foreignPatientRequest(args, session.patientId);
  if (foreign) return { ok: false, summary: foreign };

  try {
    switch (name) {
      case "checkAvailability":
        return await checkAvailability(args);
      case "listMyAppointments":
        return await listMyAppointments(args, session.patientId);
      case "bookAppointment":
      case "cancelAppointment":
      case "rescheduleAppointment": {
        const blocked = confirmationBlock(session);
        if (blocked) return { ok: false, summary: blocked };
        if (name === "bookAppointment") return await bookAppointment(args, session.patientId, session);
        if (name === "cancelAppointment") {
          return await cancelAppointment(args, session.patientId, session);
        }
        return await rescheduleAppointment(args, session.patientId, session);
      }
      default:
        return { ok: false, summary: `Unknown tool "${name}". Nothing was changed.` };
    }
  } catch (error) {
    console.error(`Tool ${name} failed`, error);
    return {
      ok: false,
      summary: "The scheduling system failed while handling that request. Nothing was changed.",
    };
  }
}

export function hasConfirmedChange(
  priorAssistantMessage: string | null,
  latestUserMessage: string,
): boolean {
  const asked = priorAssistantMessage ? /\bconfirm\b/i.test(priorAssistantMessage) : false;
  return asked && isAffirmative(latestUserMessage);
}

function confirmationBlock(session: ToolSession): string | null {
  if (hasConfirmedChange(session.priorAssistantMessage, session.latestUserMessage)) {
    return null;
  }
  return "Not changed. Ask the patient to confirm the exact details, wait for their agreement, and only then call this tool. Do not claim the appointment changed.";
}

function isAffirmative(message: string): boolean {
  const text = message.trim().toLowerCase().replace(/[.!]+$/g, "");
  if (!text || text.length > 160) return false;
  return /^(yes|yeah|yep|yup|ok|okay|sure|confirm|confirmed|go ahead|please do( that)?|do it|that works|sounds good|book it|cancel it|please (book|cancel|reschedule) (it|that))\b/.test(
    text,
  );
}

function foreignPatientRequest(
  args: Record<string, unknown>,
  patientId: string,
): string | null {
  for (const key of ["patientId", "patient_id", "userId", "user_id"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim() && value.trim() !== patientId) {
      return "Refused. You can only view or change the signed-in patient's chart.";
    }
  }
  return null;
}

export async function listOpenSlots(doctor: string, day: string): Promise<ToolResult> {
  return checkAvailability({ doctor, dateRange: { start: day, end: day } });
}

export async function listPatientAppointments(patientId: string): Promise<ToolResult> {
  return listMyAppointments({}, patientId);
}

export async function bookManualAppointment(
  patientId: string,
  input: { doctor: string; datetime: string; reason: string },
): Promise<ToolResult> {
  const doctor = resolveDoctor(input.doctor);
  if ("error" in doctor) return { ok: false, summary: doctor.error };
  const datetime = parseDateTime(input.datetime);
  if ("error" in datetime) return { ok: false, summary: datetime.error };
  const slot = slotProblem(datetime.date);
  if (slot) return { ok: false, summary: `${slot} Nothing was booked.` };
  const reason = parseReason(input.reason);
  if ("error" in reason) return { ok: false, summary: reason.error };

  const conflict = await findSlotConflict({
    doctor: doctor.doctor,
    datetime: datetime.date,
    patientId,
  });
  if (conflict) return { ok: false, summary: conflict.summary };

  const created = await prisma.appointment.create({
    data: {
      patientId,
      doctor: doctor.doctor,
      datetime: datetime.date,
      status: AppointmentStatus.scheduled,
      reason: reason.reason,
    },
  });
  const appointment = presentAppointment(created);
  return {
    ok: true,
    summary: `Booked ${appointment.doctor} on ${appointment.displayTime} for ${appointment.reason}.`,
    data: { appointment },
  };
}

async function checkAvailability(args: Record<string, unknown>): Promise<ToolResult> {
  const doctor = resolveDoctor(args.doctor);
  if ("error" in doctor) return { ok: false, summary: doctor.error };
  const range = parseDateRange(args.dateRange);
  if ("error" in range) return { ok: false, summary: range.error };

  const todayUtc = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  if (range.end.getTime() < todayUtc) {
    return {
      ok: false,
      summary: "That date is in the past. Ask for a future weekday. Nothing was booked.",
    };
  }

  const rangeEnd = new Date(range.end.getTime() + 24 * 60 * 60 * 1000);
  const taken = await prisma.appointment.findMany({
    where: {
      doctor: doctor.doctor,
      status: AppointmentStatus.scheduled,
      datetime: { gte: range.start, lt: rangeEnd },
    },
    select: { datetime: true },
  });
  const takenKeys = new Set(taken.map((appointment) => appointment.datetime.toISOString()));
  const now = Date.now();
  const slots: Array<{ datetime: string; displayTime: string }> = [];
  let truncated = false;

  for (
    let day = range.start.getTime();
    day < rangeEnd.getTime();
    day += 24 * 60 * 60 * 1000
  ) {
    const date = new Date(day);
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (let minutes = OPEN_MINUTES; minutes <= CLOSE_MINUTES; minutes += SLOT_MINUTES) {
      const slot = new Date(day + minutes * 60 * 1000);
      if (slot.getTime() <= now) continue;
      const datetime = slot.toISOString();
      if (takenKeys.has(datetime)) continue;
      if (slots.length === 48) {
        truncated = true;
        break;
      }
      slots.push({ datetime, displayTime: formatSlot(slot) });
    }
    if (truncated) break;
  }

  const summary =
    slots.length === 0
      ? `No open slots for ${doctor.doctor} in that window.`
      : `Found ${slots.length} open slot${slots.length === 1 ? "" : "s"} for ${doctor.doctor}${truncated ? ". More exist; narrow the dates to see them." : "."}`;

  return {
    ok: true,
    summary,
    data: { doctor: doctor.doctor, slots, truncated },
  };
}

async function listMyAppointments(
  args: Record<string, unknown>,
  patientId: string,
): Promise<ToolResult> {
  if (typeof args.patientName === "string" || typeof args.name === "string") {
    return {
      ok: false,
      summary: "Refused. You can only list the signed-in patient's appointments.",
    };
  }

  const appointments = await prisma.appointment.findMany({
    where: { patientId },
    orderBy: { datetime: "asc" },
    take: 20,
  });
  const data = appointments.map(presentAppointment);
  const summary =
    data.length === 0
      ? "No appointments are on your chart."
      : `Found ${data.length} appointment${data.length === 1 ? "" : "s"} on your chart.`;
  return { ok: true, summary, data: { appointments: data } };
}

async function bookAppointment(
  args: Record<string, unknown>,
  patientId: string,
  session: ToolSession,
): Promise<ToolResult> {
  const doctor = resolveDoctor(args.doctor);
  if ("error" in doctor) return { ok: false, summary: doctor.error };
  const datetime = parseDateTime(args.datetime);
  if ("error" in datetime) return { ok: false, summary: datetime.error };
  const aligned = alignToPatientRule(session.userMessages, datetime.date);
  const slot = slotProblem(aligned);
  if (slot) return { ok: false, summary: `${slot} Nothing was booked.` };
  const reason = parseReason(args.reason);
  if ("error" in reason) return { ok: false, summary: reason.error };

  const conflict = await findSlotConflict({
    doctor: doctor.doctor,
    datetime: aligned,
    patientId,
  });
  if (conflict) return { ok: false, summary: conflict.summary };

  const created = await prisma.appointment.create({
    data: {
      patientId,
      doctor: doctor.doctor,
      datetime: aligned,
      status: AppointmentStatus.scheduled,
      reason: reason.reason,
    },
  });
  const appointment = presentAppointment(created);
  return {
    ok: true,
    summary: `Booked ${appointment.doctor} on ${appointment.displayTime} for ${appointment.reason}.`,
    data: { appointment },
    appliedArguments: { ...args, datetime: aligned.toISOString() },
  };
}

async function cancelAppointment(
  args: Record<string, unknown>,
  patientId: string,
  session: ToolSession,
): Promise<ToolResult> {
  const resolved = await resolveChartAppointment(args, patientId, session, "cancelled");
  if ("error" in resolved) return resolved.error;

  const existing = resolved.appointment;
  if (existing.status !== AppointmentStatus.scheduled) {
    return {
      ok: false,
      summary: `That appointment is already ${existing.status}. Nothing was changed.`,
    };
  }

  const appointment = await prisma.appointment.update({
    where: { id: existing.id },
    data: { status: AppointmentStatus.cancelled },
  });
  const presented = presentAppointment(appointment);
  return {
    ok: true,
    summary: `Cancelled ${presented.doctor} on ${presented.displayTime}.`,
    data: { appointment: presented },
    appliedArguments: resolved.appliedArguments,
  };
}

async function rescheduleAppointment(
  args: Record<string, unknown>,
  patientId: string,
  session: ToolSession,
): Promise<ToolResult> {
  const datetime = parseDateTime(args.newDatetime);
  if ("error" in datetime) return { ok: false, summary: datetime.error };
  const aligned = alignToPatientRule(session.userMessages, datetime.date);
  const slot = slotProblem(aligned);
  if (slot) return { ok: false, summary: `${slot} Nothing was rescheduled.` };

  const resolved = await resolveChartAppointment(args, patientId, session, "rescheduled");
  if ("error" in resolved) return resolved.error;

  const existing = resolved.appointment;
  if (existing.status !== AppointmentStatus.scheduled) {
    return {
      ok: false,
      summary: `That appointment is already ${existing.status}. Nothing was changed.`,
    };
  }
  if (existing.datetime.getTime() === aligned.getTime()) {
    return {
      ok: false,
      summary: "That appointment is already at that time. Nothing was changed.",
    };
  }
  const conflict = await findSlotConflict({
    doctor: existing.doctor,
    datetime: aligned,
    patientId,
    ignoreAppointmentId: existing.id,
  });
  if (conflict) return { ok: false, summary: conflict.summary };

  const updated = await prisma.appointment.update({
    where: { id: existing.id },
    data: { datetime: aligned },
  });
  const appointment = presentAppointment(updated);
  return {
    ok: true,
    summary: `Rescheduled ${appointment.doctor} to ${appointment.displayTime}.`,
    data: { appointment },
    appliedArguments: { ...resolved.appliedArguments, newDatetime: aligned.toISOString() },
  };
}

async function findSlotConflict(input: {
  doctor: string;
  datetime: Date;
  patientId: string;
  ignoreAppointmentId?: string;
}): Promise<{ summary: string } | null> {
  const doctorTaken = await prisma.appointment.findFirst({
    where: {
      doctor: input.doctor,
      datetime: input.datetime,
      status: AppointmentStatus.scheduled,
      id: input.ignoreAppointmentId ? { not: input.ignoreAppointmentId } : undefined,
    },
    select: { id: true },
  });
  if (doctorTaken) {
    return {
      summary: `${input.doctor} is already booked at that time. Nothing was changed.`,
    };
  }

  const patientTaken = await prisma.appointment.findFirst({
    where: {
      patientId: input.patientId,
      datetime: input.datetime,
      status: AppointmentStatus.scheduled,
      id: input.ignoreAppointmentId ? { not: input.ignoreAppointmentId } : undefined,
    },
    select: { id: true },
  });
  if (patientTaken) {
    return { summary: "You already have an appointment at that time. Nothing was changed." };
  }
  return null;
}

function presentAppointment(appointment: {
  id: string;
  doctor: string;
  datetime: Date;
  status: string;
  reason: string;
}) {
  return {
    id: appointment.id,
    doctor: appointment.doctor,
    datetime: appointment.datetime.toISOString(),
    displayTime: formatSlot(appointment.datetime),
    status: appointment.status,
    reason: appointment.reason,
  };
}

function resolveDoctor(input: unknown): { doctor: string } | { error: string } {
  if (typeof input !== "string") {
    return { error: `Which doctor? The clinic has ${DOCTORS.join(", ")}.` };
  }
  const query = input.trim().toLowerCase().replace(/^dr\.?\s+/, "");
  if (!query) {
    return { error: `Which doctor? The clinic has ${DOCTORS.join(", ")}.` };
  }
  const matches = DOCTORS.filter((doctor) => {
    const name = doctor.toLowerCase().replace(/^dr\.?\s+/, "");
    return name.includes(query) || query.includes(name);
  });
  if (matches.length === 1) return { doctor: matches[0] };
  if (matches.length === 0) {
    return {
      error: `No doctor matches that name. Choose ${DOCTORS.join(", ")}.`,
    };
  }
  return { error: `Several doctors match. Choose one of ${matches.join(", ")}.` };
}

function parseDateRange(
  value: unknown,
): { start: Date; end: Date } | { error: string } {
  let startText: unknown;
  let endText: unknown;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const range = value as Record<string, unknown>;
    startText = range.start ?? range.startDate;
    endText = range.end ?? range.endDate;
  } else if (typeof value === "string") {
    const dates = value.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    startText = dates[0];
    endText = dates[1] ?? dates[0];
  }

  const start = parseUtcDay(startText);
  const end = parseUtcDay(endText);
  if (!start || !end) {
    return { error: "dateRange needs start and end as YYYY-MM-DD." };
  }
  if (end.getTime() < start.getTime()) {
    return { error: "dateRange end is before the start." };
  }
  const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  if (days > 13) {
    return { error: "dateRange can cover at most 14 days. Ask for a narrower window." };
  }
  return { start, end };
}

function parseUtcDay(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function parseDateTime(value: unknown): { date: Date } | { error: string } {
  if (typeof value !== "string" || !value.trim()) {
    return { error: "datetime must be an ISO-8601 UTC time, such as 2026-09-24T15:00:00.000Z." };
  }
  let text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) text = `${text}:00Z`;
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)) text = `${text}Z`;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return { error: "datetime is not a valid time." };
  return { date };
}

function alignToPatientRule(messages: string[], proposed: Date): Date {
  const text = messages.join("\n");
  const match = text.match(/(\d+)\s+days from today at (\d{1,2}):(\d{2})\s*UTC/i);
  if (!match || !/if that date is a weekend/i.test(text)) return proposed;
  const now = new Date();
  const slot = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      0,
      0,
    ),
  );
  const weekday = slot.getUTCDay();
  if (weekday === 6) slot.setUTCDate(slot.getUTCDate() + 2);
  if (weekday === 0) slot.setUTCDate(slot.getUTCDate() + 1);
  return slot;
}

function slotProblem(date: Date): string | null {
  if (date.getTime() <= Date.now()) return "That time is in the past.";
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return "The clinic is closed on weekends.";
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const aligned =
    minutes >= OPEN_MINUTES &&
    minutes <= CLOSE_MINUTES &&
    minutes % SLOT_MINUTES === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
  if (!aligned) {
    return "Appointments start on the half hour between 09:00 and 16:30 UTC, weekdays only.";
  }
  return null;
}

function parseReason(value: unknown): { reason: string } | { error: string } {
  if (typeof value !== "string" || value.trim().length < 2) {
    return { error: "A short reason for the visit is required. Nothing was booked." };
  }
  if (value.trim().length > 280) {
    return { error: "The reason is too long. Nothing was booked." };
  }
  return { reason: value.trim() };
}

type ChartAppointment = {
  id: string;
  doctor: string;
  datetime: Date;
  status: AppointmentStatus;
  reason: string;
  patientId: string;
};

async function resolveChartAppointment(
  args: Record<string, unknown>,
  patientId: string,
  session: ToolSession,
  verb: "cancelled" | "rescheduled",
): Promise<{ appointment: ChartAppointment; appliedArguments: Record<string, unknown> } | { error: ToolResult }> {
  const parsed = parseAppointmentId(args.appointmentId);
  const requested = "error" in parsed ? "" : parsed.id;
  const named = namedAppointmentId(session.userMessages);
  const chart = await prisma.appointment.findMany({ where: { patientId }, take: 20 });

  if (named) {
    const namedRow = chart.find((row) => row.id === named);
    if (!namedRow) {
      return {
        error: {
          ok: false,
          summary: `No appointment with id ${named} is on your chart. Nothing was ${verb}. Do not change a different visit.`,
          appliedArguments: { ...args, appointmentId: named },
        },
      };
    }
    return { appointment: namedRow, appliedArguments: { ...args, appointmentId: namedRow.id } };
  }

  const direct = requested ? chart.find((row) => row.id === requested) : undefined;
  if (direct) {
    return { appointment: direct, appliedArguments: { ...args, appointmentId: direct.id } };
  }

  const confirmed = confirmedVisit(session.priorAssistantMessage, chart);
  if (confirmed) {
    return {
      appointment: confirmed,
      appliedArguments: { ...args, appointmentId: confirmed.id },
    };
  }

  const listed = chart
    .filter((row) => row.status === AppointmentStatus.scheduled)
    .map((row) => `${row.id} (${row.reason}, ${row.doctor})`)
    .join("; ");
  return {
    error: {
      ok: false,
      summary: listed
        ? `No appointment with that id is on your chart. Nothing was ${verb}. Scheduled ids: ${listed}.`
        : `No appointment with that id is on your chart. Nothing was ${verb}.`,
      appliedArguments: args,
    },
  };
}

function namedAppointmentId(messages: string[]): string | null {
  const found: string[] = [];
  for (const message of messages) {
    const pattern = /\bappointment\s+(?:id\s+)?([A-Za-z0-9][A-Za-z0-9_-]{4,})/gi;
    for (const match of message.matchAll(pattern)) {
      const token = match[1];
      if (/^(with|from|about|today|immediately)$/i.test(token)) continue;
      found.push(token);
    }
  }
  const unique = [...new Set(found)];
  return unique.length === 1 ? unique[0] : null;
}

function confirmedVisit(
  priorAssistantMessage: string | null,
  chart: ChartAppointment[],
): ChartAppointment | null {
  if (!priorAssistantMessage) return null;
  const scheduled = chart.filter((row) => row.status === AppointmentStatus.scheduled);
  const confirmText = priorAssistantMessage
    .split(/\n+/)
    .filter((line) => /\bconfirm\b/i.test(line))
    .join(" ");
  const fromConfirm = visitsNamedIn(confirmText, scheduled);
  if (fromConfirm.length === 1) return fromConfirm[0];
  const fromReply = visitsNamedIn(priorAssistantMessage, scheduled);
  return fromReply.length === 1 ? fromReply[0] : null;
}

function visitsNamedIn(text: string, scheduled: ChartAppointment[]): ChartAppointment[] {
  const folded = text.toLowerCase();
  return scheduled.filter((row) => {
    const reason = row.reason.toLowerCase();
    const doctor = row.doctor.toLowerCase().replace(/^dr\.?\s+/, "");
    const surname = doctor.split(/\s+/).at(-1) ?? doctor;
    return folded.includes(reason) && (folded.includes(doctor) || folded.includes(surname));
  });
}

function parseAppointmentId(value: unknown): { id: string } | { error: string } {
  if (typeof value !== "string" || !value.trim()) {
    return { error: "An appointment id is required. Nothing was changed." };
  }
  return { id: value.trim() };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
