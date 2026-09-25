import { hashPassword } from "@/lib/auth/password";
import { AppointmentStatus } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

const PASSWORD = "patient-demo";

const DOCTORS = {
  priya: "Dr. Priya Shah",
  james: "Dr. James Okonkwo",
  elena: "Dr. Elena Vasquez",
} as const;

const PATIENTS = [
  {
    email: "maya.patel@clinic.example",
    name: "Maya Patel",
    dob: "1990-03-12",
    appointments: [
      {
        doctor: DOCTORS.priya,
        offsetDays: 1,
        hour: 10,
        minute: 0,
        status: AppointmentStatus.scheduled,
        reason: "Annual physical",
      },
      {
        doctor: DOCTORS.james,
        offsetDays: 4,
        hour: 14,
        minute: 30,
        status: AppointmentStatus.scheduled,
        reason: "Knee follow-up",
      },
    ],
  },
  {
    email: "luis.romero@clinic.example",
    name: "Luis Romero",
    dob: "1985-11-02",
    appointments: [
      {
        doctor: DOCTORS.elena,
        offsetDays: 2,
        hour: 9,
        minute: 0,
        status: AppointmentStatus.scheduled,
        reason: "Skin check",
      },
      {
        doctor: DOCTORS.priya,
        offsetDays: -6,
        hour: 15,
        minute: 0,
        status: AppointmentStatus.cancelled,
        reason: "Cold symptoms",
      },
    ],
  },
  {
    email: "hannah.berg@clinic.example",
    name: "Hannah Berg",
    dob: "1998-07-21",
    appointments: [
      {
        doctor: DOCTORS.james,
        offsetDays: 6,
        hour: 11,
        minute: 0,
        status: AppointmentStatus.scheduled,
        reason: "Vaccination",
      },
      {
        doctor: DOCTORS.elena,
        offsetDays: -14,
        hour: 13,
        minute: 0,
        status: AppointmentStatus.completed,
        reason: "New patient visit",
      },
    ],
  },
] as const;

export async function seedClinic(): Promise<{ patients: number; appointments: number }> {
  const passwordHash = await hashPassword(PASSWORD);
  const emails = PATIENTS.map((patient) => patient.email);

  await prisma.user.deleteMany({
    where: { email: { in: [...emails] } },
  });

  for (const patient of PATIENTS) {
    await prisma.user.create({
      data: {
        email: patient.email,
        passwordHash,
        patient: {
          create: {
            name: patient.name,
            dob: utcDate(patient.dob),
            appointments: {
              create: patient.appointments.map((appointment) => ({
                doctor: appointment.doctor,
                datetime: atUtc(
                  appointment.offsetDays,
                  appointment.hour,
                  appointment.minute,
                  appointment.status,
                ),
                status: appointment.status,
                reason: appointment.reason,
              })),
            },
          },
        },
      },
    });
  }

  const appointments = await prisma.appointment.count({
    where: { patient: { user: { email: { in: [...emails] } } } },
  });
  return { patients: PATIENTS.length, appointments };
}

function utcDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function atUtc(
  offsetDays: number,
  hour: number,
  minute: number,
  status: AppointmentStatus,
): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  date.setUTCHours(hour, minute, 0, 0);
  if (status === AppointmentStatus.scheduled) {
    const weekday = date.getUTCDay();
    if (weekday === 6) date.setUTCDate(date.getUTCDate() + 2);
    if (weekday === 0) date.setUTCDate(date.getUTCDate() + 1);
  }
  return date;
}
