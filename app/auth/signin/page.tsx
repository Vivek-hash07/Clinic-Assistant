import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { requirePatientSession } from "@/lib/auth/session";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    callbackUrl?: string | string[];
    error?: string | string[];
  }>;
}) {
  const session = await requirePatientSession();
  if (session) redirect("/chat");

  const query = await searchParams;
  const callbackUrl = safeCallbackUrl(query.callbackUrl);
  const error = first(query.error);
  const initialError =
    error === "CredentialsSignin" ? "Invalid email or password." : null;

  return (
    <AuthShell
      title="Sign in"
      subtitle="Your session is what ties every later appointment action to your chart."
      footer={null}
    >
      <SignInForm callbackUrl={callbackUrl} initialError={initialError} />
    </AuthShell>
  );
}

function safeCallbackUrl(value: string | string[] | undefined): string {
  const raw = first(value);
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/chat";
  return raw;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
