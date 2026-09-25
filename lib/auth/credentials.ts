import { prisma } from "@/lib/db/prisma";
import { verifyPassword } from "@/lib/auth/password";

export type SignedInUser = {
  id: string;
  email: string;
  name: string;
  patientId: string;
};

export type SignInResult =
  | { ok: true; user: SignedInUser }
  | { ok: false; status: 401 | 503; error: string };

export async function signInWithPassword(
  emailRaw: unknown,
  passwordRaw: unknown,
): Promise<SignInResult> {
  const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
  const password = typeof passwordRaw === "string" ? passwordRaw : "";
  if (!email || !password) {
    return { ok: false, status: 401, error: "Invalid email or password." };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { patient: true },
    });
    if (!user?.patient) {
      return { ok: false, status: 401, error: "Invalid email or password." };
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return { ok: false, status: 401, error: "Invalid email or password." };
    }

    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.patient.name,
        patientId: user.patient.id,
      },
    };
  } catch (error) {
    console.error(
      "sign-in failed",
      error instanceof Error ? error.message : error,
    );
    return {
      ok: false,
      status: 503,
      error: "Sign-in is unavailable right now. Try again in a moment.",
    };
  }
}
