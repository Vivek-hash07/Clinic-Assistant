import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { requirePatientSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const session = await requirePatientSession();
  if (!session) redirect("/auth/signin");

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-16">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-teal-800 dark:text-teal-300">
            Your chart
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {session.name ?? "Patient"}
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Signed in as {session.email}. Appointment actions use the patient
            id stored on this session.
          </p>
        </div>
        <SignOutButton />
      </div>
      <section className="mt-10 rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Scheduling assistant</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          The chat agent is not connected yet. This page is only available
          while you are signed in.
        </p>
      </section>
    </main>
  );
}
