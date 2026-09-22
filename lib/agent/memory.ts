import MemoryClient, { type Message } from "mem0ai";

let client: MemoryClient | undefined;

function getMemoryClient() {
  if (!client) {
    const apiKey = process.env.MEM0_API_KEY;
    if (!apiKey) {
      throw new Error("MEM0_API_KEY is not set");
    }
    client = new MemoryClient({ apiKey });
  }

  return client;
}

export async function addMemory(messages: Message[], userId: string) {
  return getMemoryClient().add(messages, { userId });
}

export async function searchMemory(query: string, userId: string, topK = 5) {
  return getMemoryClient().search(query, {
    filters: { user_id: userId },
    topK,
  });
}
