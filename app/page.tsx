import Link from "next/link";
import { requirePatientSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await requirePatientSession();

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-20">
      <p className="text-sm font-medium text-teal-800 dark:text-teal-300">
        Single-clinic scheduling
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">
        Appointments stay on your own chart.
      </h1>
      <p className="mt-4 text-lg leading-8 text-zinc-600 dark:text-zinc-400">
        Sign in so the assistant can only act for the patient linked to your
        account.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        {session ? (
          <Link
            href="/chat"
            className="flex h-11 items-center justify-center rounded-lg bg-teal-800 px-5 text-sm font-medium text-white hover:bg-teal-900"
          >
            Continue as {session.name ?? session.email}
          </Link>
        ) : (
          <>
            <Link
              href="/auth/signin"
              className="flex h-11 items-center justify-center rounded-lg bg-teal-800 px-5 text-sm font-medium text-white hover:bg-teal-900"
            >
              Sign in
            </Link>
            <Link
              href="/auth/signup"
              className="flex h-11 items-center justify-center rounded-lg border border-zinc-300 px-5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Create account
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
