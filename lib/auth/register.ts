import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FieldErrors = {
  name?: string;
  email?: string;
  password?: string;
  dob?: string;
};

export type RegisterResult =
  | {
      ok: true;
      userId: string;
      patientId: string;
      email: string;
      name: string;
    }
  | { ok: false; status: number; error?: string; fieldErrors?: FieldErrors };

export async function registerPatient(input: {
  name: unknown;
  email: unknown;
  password: unknown;
  dob: unknown;
}): Promise<RegisterResult> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email =
    typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const dobRaw = typeof input.dob === "string" ? input.dob.trim() : "";

  const fieldErrors: FieldErrors = {};
  if (name.length < 2) {
    fieldErrors.name = "Enter your full name.";
  }
  if (!EMAIL_PATTERN.test(email)) {
    fieldErrors.email = "Enter a valid email.";
  }
  if (password.length < 8) {
    fieldErrors.password = "Use at least 8 characters.";
  }

  const dob = parseDob(dobRaw);
  if (!dob) {
    fieldErrors.dob = "Enter a valid date of birth that is not in the future.";
  }

  if (Object.keys(fieldErrors).length > 0 || !dob) {
    return { ok: false, status: 400, fieldErrors };
  }

  const passwordHash = await hashPassword(password);

  try {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        patient: {
          create: {
            name,
            dob,
          },
        },
      },
      select: {
        id: true,
        email: true,
        patient: { select: { id: true, name: true } },
      },
    });

    if (!user.patient) {
      return {
        ok: false,
        status: 500,
        error: "Could not create the patient record.",
      };
    }

    return {
      ok: true,
      userId: user.id,
      patientId: user.patient.id,
      email: user.email,
      name: user.patient.name,
    };
  } catch (error) {
    if (isUniqueConstraint(error)) {
      return {
        ok: false,
        status: 409,
        error: "An account with that email already exists.",
      };
    }
    throw error;
  }
}

function parseDob(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  if (year < 1900) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  if (date.getTime() > todayUtc) return null;

  return date;
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
