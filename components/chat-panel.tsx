"use client";

import { useState } from "react";
import { buttonClassName, fieldClassName } from "@/components/auth-shell";

type Role = "user" | "assistant";

type ToolNote = {
  name: string;
  ok: boolean;
  summary: string;
};

type ChatMessage = {
  role: Role;
  content: string;
  tools?: ToolNote[];
};

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || pending) return;

    const history = messages.map((item) => ({
      role: item.role,
      content: item.content,
    }));
    setMessages((current) => [...current, { role: "user", content: message }]);
    setDraft("");
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      const payload = (await response.json()) as {
        reply?: string;
        tools?: ToolNote[];
        error?: string;
      };
      if (!response.ok || !payload.reply) {
        throw new Error(payload.error || "The assistant could not reply.");
      }
      setMessages((current) => [
        ...current,
        { role: "assistant", content: payload.reply!, tools: payload.tools ?? [] },
      ]);
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : "The assistant could not reply.";
      setError(text);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-8 flex min-h-[32rem] flex-1 flex-col rounded-2xl border border-zinc-200 dark:border-zinc-800">
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-5">
        {messages.length === 0 ? (
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Ask about your appointments, or request a booking, change, or
            cancellation. The assistant confirms the details before it changes
            your chart.
          </p>
        ) : null}
        {messages.map((item, index) => (
          <div
            key={`${item.role}-${index}`}
            className={item.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                item.role === "user"
                  ? "max-w-[85%] rounded-2xl bg-teal-800 px-4 py-3 text-sm leading-6 text-white"
                  : "max-w-[85%] rounded-2xl border border-zinc-200 px-4 py-3 text-sm leading-6 dark:border-zinc-800"
              }
            >
              <p className="whitespace-pre-wrap">{item.content}</p>
              {item.tools && item.tools.length > 0 ? (
                <ul className="mt-3 space-y-1 border-t border-zinc-200 pt-2 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  {item.tools.map((tool, toolIndex) => (
                    <li key={`${tool.name}-${toolIndex}`}>
                      {tool.ok ? "Completed" : "Failed"} {tool.name}: {tool.summary}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ))}
        {pending ? (
          <p className="text-sm text-zinc-500" aria-live="polite">
            Checking the schedule…
          </p>
        ) : null}
      </div>
      <form onSubmit={onSubmit} className="border-t border-zinc-200 p-4 dark:border-zinc-800">
        {error ? (
          <p className="mb-3 text-sm text-red-700 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}
        <label htmlFor="message" className="text-sm font-medium">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="I need to move my knee follow-up."
          className={`${fieldClassName} resize-none`}
          disabled={pending}
        />
        <button
          type="submit"
          className={`${buttonClassName} mt-3`}
          disabled={pending || draft.trim().length === 0}
        >
          {pending ? "Sending…" : "Send"}
        </button>
      </form>
    </section>
  );
}
