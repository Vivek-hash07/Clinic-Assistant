import { encode } from "next-auth/jwt";
import { cookies } from "next/headers";

const MAX_AGE = 30 * 24 * 60 * 60;

export function sessionCookieName(secure: boolean): string {
  return `${secure ? "__Secure-" : ""}next-auth.session-token`;
}

export function useSecureSessionCookie(): boolean {
  return process.env.NODE_ENV === "production";
}

function authSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is not set");
  }
  return secret;
}

export async function createPatientSession(user: {
  id: string;
  email: string;
  name: string;
  patientId: string;
}): Promise<void> {
  const secure = useSecureSessionCookie();
  const token = await encode({
    secret: authSecret(),
    maxAge: MAX_AGE,
    token: {
      sub: user.id,
      userId: user.id,
      patientId: user.patientId,
      email: user.email,
      name: user.name,
    },
  });

  const jar = await cookies();
  jar.set(sessionCookieName(secure), token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: MAX_AGE,
  });
}

export async function clearPatientSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(sessionCookieName(false));
  jar.delete(sessionCookieName(true));
}
