import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { requirePatientSession } from "@/lib/auth/session";
import { SignUpForm } from "./sign-up-form";

export default async function SignUpPage() {
  const session = await requirePatientSession();
  if (session) redirect("/chat");

  return (
    <AuthShell
      title="Create your patient account"
      subtitle="This creates your login and the patient chart the assistant is allowed to use."
      footer={null}
    >
      <SignUpForm />
    </AuthShell>
  );
}
