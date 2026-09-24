import { redirect } from "next/navigation";
import { ChatPanel } from "@/components/chat-panel";
import { requirePatientSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const session = await requirePatientSession();
  if (!session) redirect("/auth/signin");

  return (
    <main className="flex h-dvh flex-col bg-white dark:bg-zinc-950">
      <ChatPanel patientName={session.name ?? "there"} />
    </main>
  );
}
