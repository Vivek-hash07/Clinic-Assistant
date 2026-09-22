import { addMemory, searchMemory } from "../lib/agent/memory";
import { completeChat } from "../lib/openrouter";

const REQUIRED_ENV = ["DATABASE_URL", "OPENROUTER_API_KEY", "MEM0_API_KEY"] as const;

function missingEnv() {
  return REQUIRED_ENV.filter((name) => {
    const value = process.env[name]?.trim();
    return !value || value.includes("USER:PASSWORD") || value.includes("your-api-key");
  });
}

async function main() {
  const missing = missingEnv();
  if (missing.length > 0) {
    console.error(
      `Fill these in .env before running the sanity check: ${missing.join(", ")}`,
    );
    console.error("Template: .env.example");
    process.exitCode = 1;
    return;
  }

  const reply = await completeChat([
    { role: "user", content: "Reply with the single word pong." },
  ]);
  console.log(`OpenRouter: ${reply}`);

  const userId = "phase0-sanity";
  const marker = `phase0-${Date.now()}`;
  const added = await addMemory(
    [
      {
        role: "user",
        content: `Remember this setup check marker: ${marker}. I am allergic to nuts.`,
      },
      {
        role: "assistant",
        content: `Noted marker ${marker} and a nut allergy.`,
      },
    ],
    userId,
  );
  console.log("Mem0 add:", JSON.stringify(added));

  const results = await searchMemory("nut allergy", userId);
  console.log("Mem0 search:", JSON.stringify(results));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
