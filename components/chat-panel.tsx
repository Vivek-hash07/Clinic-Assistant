"use client";

import { useEffect, useRef, useState } from "react";
import { BookingDialog } from "@/components/booking-dialog";
import { SignOutButton } from "@/components/sign-out-button";

type Role = "user" | "assistant";

type ChatMessage = {
  role: Role;
  content: string;
};

type ChatSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

type StreamEvent = {
  delta?: string;
  done?: boolean;
  reply?: string;
  error?: string;
  conversationId?: string | null;
  title?: string;
};

async function readChatStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((item) => item.startsWith("data:"));
      if (!line) continue;
      const event = JSON.parse(line.slice(5).trim()) as StreamEvent;
      onEvent(event);
      if (event.error) throw new Error(event.error);
    }
  }
}

function bookingSentence(content: string): string | null {
  const fields = new Map<string, string>();
  let other = 0;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^(?:[-*]\s+)?\*\*([^:*]+):\*\*\s*(.+)$/);
    if (match) {
      fields.set(match[1].trim().toLowerCase(), match[2].trim());
      continue;
    }
    if (/further assistance|feel free to ask|any more questions/i.test(line)) continue;
    other += 1;
  }
  const doctor = fields.get("doctor");
  const when = fields.get("date and time")?.replace(/,\s+at\s+/i, " at ");
  const rawReason = fields.get("reason")?.replace(/\.$/, "");
  if (!doctor || !when || !rawReason || other > 0) return null;
  const reason = /^[A-Z][a-z]+$/.test(rawReason) ? `a ${rawReason.toLowerCase()}` : rawReason;
  return `You're booked with ${doctor} on ${when} for ${reason}.`;
}

function assistantText(content: string): string {
  return (
    bookingSentence(content) ??
    content
      .split("\n")
      .filter((line) => !/^\s*if you need further assistance/i.test(line.trim()))
      .join("\n")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .trim()
  );
}

const SUGGESTIONS = [
  "I need an appointment for a headache.",
  "What appointments do I have coming up?",
  "I need to move my knee follow-up.",
];

export function ChatPanel({ patientName }: { patientName: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const pendingChatId = useRef<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatId = useRef(0);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTop = thread.scrollHeight;
  }, [messages, pending]);

  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = "0px";
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
  }, [draft]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/chats")
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as { chats?: ChatSummary[] };
        if (!cancelled) setChats(payload.chats ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function rememberChat(summary: ChatSummary, replaceId?: string | null) {
    setConversationId(summary.id);
    setTitle(summary.title);
    setChats((current) => [
      summary,
      ...current.filter((chat) => chat.id !== summary.id && chat.id !== replaceId),
    ]);
  }

  function startNewChat() {
    chatId.current += 1;
    setMessages([]);
    setDraft("");
    setError(null);
    setPending(false);
    setBookingOpen(false);
    setConversationId(null);
    setTitle(null);
    pendingChatId.current = null;
  }

  async function openChat(id: string) {
    if (pending || id.startsWith("local-")) return;
    chatId.current += 1;
    setError(null);
    setDraft("");
    try {
      const response = await fetch(`/api/chats/${id}`);
      const payload = (await response.json()) as {
        id?: string;
        title?: string;
        messages?: ChatMessage[];
        error?: string;
      };
      if (!response.ok || !payload.id || !payload.messages) {
        throw new Error(payload.error || "That chat could not be opened.");
      }
      setConversationId(payload.id);
      setTitle(payload.title ?? null);
      setMessages(payload.messages);
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : "That chat could not be opened.";
      setError(text);
    }
  }

  async function sendMessage(text: string) {
    const message = text.trim();
    if (!message || pending) return;

    const id = chatId.current;
    const history = messages.map((item) => ({
      role: item.role,
      content: item.content,
    }));
    const savedId = conversationId && !conversationId.startsWith("local-") ? conversationId : null;
    if (!savedId) {
      const localId = `local-${Date.now()}`;
      pendingChatId.current = localId;
      const label = message.replace(/\s+/g, " ").trim();
      rememberChat({
        id: localId,
        title: label.length > 42 ? `${label.slice(0, 42).trimEnd()}…` : label,
        updatedAt: new Date().toISOString(),
      });
    }
    setMessages((current) => [...current, { role: "user", content: message }]);
    setDraft("");
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history, conversationId: savedId }),
      });
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "The assistant could not reply.");
      }
      await readChatStream(response.body, (event) => {
        if (chatId.current !== id) return;
        if (event.error) throw new Error(event.error);
        if (event.delta) {
          setMessages((current) => {
            const last = current[current.length - 1];
            if (last?.role === "assistant") {
              return [
                ...current.slice(0, -1),
                { role: "assistant", content: last.content + event.delta },
              ];
            }
            return [...current, { role: "assistant", content: event.delta ?? "" }];
          });
        }
        if (event.done && event.reply) {
          setMessages((current) => {
            const last = current[current.length - 1];
            if (last?.role === "assistant") {
              return [...current.slice(0, -1), { role: "assistant", content: event.reply! }];
            }
            return [...current, { role: "assistant", content: event.reply! }];
          });
          if (event.conversationId && event.title) {
            rememberChat(
              {
                id: event.conversationId,
                title: event.title,
                updatedAt: new Date().toISOString(),
              },
              pendingChatId.current,
            );
            pendingChatId.current = null;
          }
        }
      });
    } catch (caught) {
      if (chatId.current !== id) return;
      const text = caught instanceof Error ? caught.message : "The assistant could not reply.";
      setError(text);
    } finally {
      if (chatId.current === id) setPending(false);
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft);
  }

  const firstName = patientName.split(" ")[0] || "there";

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className={`${
          sidebarOpen ? "flex" : "hidden"
        } h-full w-60 shrink-0 flex-col border-r border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900`}
      >
        <div className="flex items-center gap-2 px-3 pt-3">
          <button
            type="button"
            onClick={startNewChat}
            className="flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-zinc-200 dark:hover:bg-zinc-800"
          >
            New chat
          </button>
          <button
            type="button"
            aria-label="Hide chats"
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg px-2 py-2 text-sm text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
          >
            ‹
          </button>
        </div>
        <nav className="mt-2 flex-1 space-y-1 overflow-y-auto px-2 pb-3" aria-label="Recent chats">
          {chats.length === 0 ? (
            <p className="px-3 py-2 text-sm text-zinc-500">No earlier chats</p>
          ) : (
            chats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => void openChat(chat.id)}
                title={chat.title}
                className={`block w-full truncate rounded-lg px-3 py-2 text-left text-sm ${
                  chat.id === conversationId
                    ? "bg-white dark:bg-zinc-800"
                    : "hover:bg-zinc-200 dark:hover:bg-zinc-800"
                }`}
              >
                {chat.title}
              </button>
            ))
          )}
        </nav>
        <p className="truncate border-t border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
          {patientName}
        </p>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="relative flex items-center justify-between px-4 py-3">
        {sidebarOpen ? (
          <span className="w-8" />
        ) : (
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Chats
          </button>
        )}
        <p className="pointer-events-none absolute inset-x-24 truncate text-center text-sm text-zinc-500">
          {title ?? ""}
        </p>
        <div className="ml-auto">
          <SignOutButton />
        </div>
      </header>
      <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 py-6">
          {messages.length === 0 ? (
            <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
              <h2 className="text-3xl font-medium tracking-tight">
                How can I help, {firstName}?
              </h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-zinc-500">
                Ask in the chat, or book a visit yourself from the appointment button.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void sendMessage(suggestion)}
                    disabled={pending}
                    className="rounded-full border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6 pb-4">
              {messages.map((item, index) =>
                item.role === "user" ? (
                  <div key={`${item.role}-${index}`} className="flex justify-end">
                    <p className="max-w-[80%] whitespace-pre-wrap rounded-3xl bg-zinc-100 px-4 py-2.5 text-[15px] leading-7 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50">
                      {item.content}
                    </p>
                  </div>
                ) : (
                  <div key={`${item.role}-${index}`} className="flex gap-3">
                    <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
                      C
                    </span>
                    <p className="whitespace-pre-wrap pt-1 text-[15px] leading-7">
                      {assistantText(item.content)}
                    </p>
                  </div>
                ),
              )}
              {pending && messages.at(-1)?.role !== "assistant" ? (
                <div className="flex gap-3" aria-live="polite">
                  <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
                    C
                  </span>
                  <p className="pt-1 text-sm text-zinc-500">Thinking…</p>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        {error ? (
          <p className="mb-2 px-2 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}
        <form
          onSubmit={onSubmit}
          className="flex items-end gap-2 rounded-[28px] border border-zinc-200 bg-white px-3 py-2 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <button
            type="button"
            onClick={() => setBookingOpen(true)}
            className="mb-0.5 shrink-0 rounded-full px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Appointment
          </button>
          <label htmlFor="message" className="sr-only">
            Message
          </label>
          <textarea
            ref={inputRef}
            id="message"
            name="message"
            rows={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage(draft);
              }
            }}
            placeholder="Message the clinic"
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2 text-[15px] leading-6 outline-none"
            disabled={pending}
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={pending || draft.trim().length === 0}
            className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900"
          >
            <span aria-hidden="true">↑</span>
          </button>
        </form>
        <p className="mt-2 text-center text-xs text-zinc-400">
          The assistant confirms chat bookings before it changes your chart.
        </p>
      </div>

      <BookingDialog
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
        onBooked={(summary) => {
          setMessages((current) => [...current, { role: "assistant", content: summary }]);
          setError(null);
          void fetch("/api/chats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId, content: summary }),
          })
            .then(async (response) => {
              if (!response.ok) return;
              const payload = (await response.json()) as ChatSummary;
              if (payload.id && payload.title) rememberChat(payload);
            })
            .catch(() => undefined);
        }}
      />
      </div>
    </div>
  );
}
