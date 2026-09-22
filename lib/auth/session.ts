import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";

export type PatientSession = {
  userId: string;
  patientId: string;
  email: string;
  name: string | null;
};

/**
 * The signed-in patient. Scheduling tools must use `patientId` from here.
 * Never take it from the request body, query string, or model arguments.
 */
export async function requirePatientSession(): Promise<PatientSession | null> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  const patientId = session?.user?.patientId;
  const email = session?.user?.email;

  if (!userId || !patientId || !email) return null;

  return {
    userId,
    patientId,
    email,
    name: session.user.name ?? null,
  };
}
