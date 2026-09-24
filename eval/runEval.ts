import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { scoreScenario, type ChartRow, type TranscriptTurn } from "@/eval/checks";
import { judgeScenario, type JudgeScore } from "@/eval/judge";
import { SCENARIOS, type Scenario } from "@/eval/scenarios";
import { runAgent, type ChatTurn } from "@/lib/agent/runAgent";
import { seedClinic } from "@/lib/db/seedClinic";
import { prisma } from "@/lib/db/prisma";
import { AppointmentStatus } from "@/lib/generated/prisma/client";

const AGENT_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
const JUDGE_MODEL = process.env.OPENROUTER_JUDGE_MODEL || "openai/gpt-4o";

type PatientRecord = {
  id: string;
  email: string;
  name: string;
  dob: Date;
};

type ScenarioResult = {
  id: string;
  category: string;
  deterministic: {
    score: number;
    passed: number;
    total: number;
    checks: Array<{ name: string; pass: boolean; detail: string }>;
  };
  judge: JudgeScore | null;
  judgeError?: string;
  score: number;
  transcript: TranscriptTurn[];
  error?: string;
};

async function main() {
  const missing = ["DATABASE_URL", "OPENROUTER_API_KEY", "MEM0_API_KEY"].filter((name) => {
    const value = process.env[name]?.trim();
    return !value || value.includes("USER:PASSWORD") || value.includes("your-api-key");
  });
  if (missing.length > 0) {
    console.error(`Fill these in .env before running eval: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (JUDGE_MODEL === AGENT_MODEL) {
    console.warn(
      `Judge model ${JUDGE_MODEL} matches the agent. Set OPENROUTER_JUDGE_MODEL to a stronger model.`,
    );
  }

  const outPath = outputPath();
  const only = flagged("--scenario");
  const scenarios = only ? SCENARIOS.filter((scenario) => scenario.id === only) : SCENARIOS;
  if (scenarios.length === 0) {
    console.error(`No scenario named ${only}.`);
    process.exit(1);
  }

  console.log(`Agent ${AGENT_MODEL}`);
  console.log(`Judge ${JUDGE_MODEL}`);
  console.log(`Seeding clinic charts`);
  const seeded = await seedClinic();
  console.log(`Seeded ${seeded.patients} patients and ${seeded.appointments} appointments`);

  const patients = await loadPatients();
  const baseline = await snapshot(patients.map((patient) => patient.id));
  const results: ScenarioResult[] = [];

  try {
    for (const [index, scenario] of scenarios.entries()) {
      console.log(`[${index + 1}/${scenarios.length}] ${scenario.id}`);
      let result: ScenarioResult;
      try {
        await withDbRetry("restore", () => restore(baseline));
        result = await runOne(scenario, patients);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  ${scenario.id} failed: ${message}`);
        result = failed(scenario, [], message);
      }
      results.push(result);
      await writeResults(outPath, results, scenarios.length === SCENARIOS.length);
      const judgeText = result.judge
        ? `judge ${meanJudge(result.judge).toFixed(2)}`
        : "judge failed";
      console.log(
        `  deterministic ${result.deterministic.passed}/${result.deterministic.total}  ${judgeText}  score ${result.score.toFixed(3)}`,
      );
    }
  } finally {
    await withDbRetry("restore", () => restore(baseline)).catch((error: unknown) => {
      console.error("Final restore failed", error);
    });
    await prisma.$disconnect();
  }

  const totals = summarize(results);
  console.log(
    `Saved ${outPath}  scenarios ${totals.scenarios}  deterministic ${totals.deterministic.toFixed(3)}  judge ${totals.judge.toFixed(3)}  score ${totals.score.toFixed(3)}`,
  );
}

async function runOne(scenario: Scenario, patients: PatientRecord[]): Promise<ScenarioResult> {
  const patient = patients.find((item) => item.email === scenario.patientEmail);
  if (!patient) {
    return failed(scenario, [], `No seeded patient for ${scenario.patientEmail}.`);
  }

  const now = new Date();
  const before = await withDbRetry("snapshot", () => snapshot(patients.map((item) => item.id)));
  const transcript: TranscriptTurn[] = [];
  const history: ChatTurn[] = [];

  try {
    for (const message of scenario.scriptedTurns) {
      const turn = await runAgent({
        patientId: patient.id,
        patientName: patient.name,
        history,
        message,
        toolFault: scenario.toolFault,
        memoryUserId: `eval:${scenario.id}:${patient.id}`,
      });
      transcript.push({
        user: message,
        assistant: turn.reply,
        tools: turn.tools,
      });
      history.push({ role: "user", content: message }, { role: "assistant", content: turn.reply });
    }
  } catch (error) {
    const after = await withDbRetry("snapshot", () =>
      snapshot(patients.map((item) => item.id)),
    ).catch(() => before);
    return failed(
      scenario,
      transcript,
      error instanceof Error ? error.message : String(error),
      scoreBody(scenario, now, patient, patients, before, after, transcript),
    );
  }

  const after = await withDbRetry("snapshot", () => snapshot(patients.map((item) => item.id)));
  const deterministic = scoreBody(scenario, now, patient, patients, before, after, transcript);
  let judge: JudgeScore | null = null;
  let judgeError: string | undefined;
  try {
    judge = await judgeScenario({ scenario, transcript, model: JUDGE_MODEL });
  } catch (error) {
    judgeError = error instanceof Error ? error.message : String(error);
  }

  return {
    id: scenario.id,
    category: scenario.category,
    deterministic,
    judge,
    judgeError,
    score: combined(deterministic.score, judge),
    transcript: transcript.map(compactTurn),
  };
}

function scoreBody(
  scenario: Scenario,
  now: Date,
  patient: PatientRecord,
  patients: PatientRecord[],
  before: ChartRow[],
  after: ChartRow[],
  transcript: TranscriptTurn[],
) {
  const checks = scoreScenario({
    scenario,
    now,
    patientId: patient.id,
    patients,
    before,
    after,
    transcript,
  });
  const passed = checks.filter((check) => check.pass).length;
  return {
    score: checks.length === 0 ? 0 : passed / checks.length,
    passed,
    total: checks.length,
    checks,
  };
}

function failed(
  scenario: Scenario,
  transcript: TranscriptTurn[],
  error: string,
  deterministic?: ScenarioResult["deterministic"],
): ScenarioResult {
  const checks = deterministic ?? {
    score: 0,
    passed: 0,
    total: 1,
    checks: [{ name: "run", pass: false, detail: error }],
  };
  return {
    id: scenario.id,
    category: scenario.category,
    deterministic: checks,
    judge: null,
    judgeError: error,
    score: combined(checks.score, null),
    transcript,
    error,
  };
}

async function loadPatients(): Promise<PatientRecord[]> {
  const emails = [...new Set(SCENARIOS.map((scenario) => scenario.patientEmail))];
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    include: { patient: true },
  });
  return users.flatMap((user) => {
    if (!user.patient) return [];
    return [
      {
        id: user.patient.id,
        email: user.email,
        name: user.patient.name,
        dob: user.patient.dob,
      },
    ];
  });
}

async function snapshot(patientIds: string[]): Promise<ChartRow[]> {
  const rows = await prisma.appointment.findMany({
    where: { patientId: { in: patientIds } },
    orderBy: { datetime: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    patientId: row.patientId,
    doctor: row.doctor,
    datetime: row.datetime.toISOString(),
    status: row.status,
    reason: row.reason,
  }));
}

async function withDbRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${label} failed (${attempt}/3): ${message}`);
      await prisma.$disconnect().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw last;
}

async function restore(rows: ChartRow[]) {
  await prisma.$disconnect().catch(() => undefined);
  const patientIds = [...new Set(rows.map((row) => row.patientId))];
  await prisma.appointment.deleteMany({ where: { patientId: { in: patientIds } } });
  if (rows.length === 0) return;
  await prisma.appointment.createMany({
    data: rows.map((row) => ({
      id: row.id,
      patientId: row.patientId,
      doctor: row.doctor,
      datetime: new Date(row.datetime),
      status: row.status as AppointmentStatus,
      reason: row.reason,
    })),
  });
}

async function writeResults(outPath: string, results: ScenarioResult[], fullSuite: boolean) {
  await mkdir(path.dirname(outPath), { recursive: true });
  const payload = {
    runAt: new Date().toISOString(),
    agentModel: AGENT_MODEL,
    judgeModel: JUDGE_MODEL,
    partial: !fullSuite || results.length !== SCENARIOS.length,
    totals: summarize(results),
    scenarios: results,
  };
  await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function summarize(results: ScenarioResult[]) {
  const deterministic = average(results.map((result) => result.deterministic.score));
  const judge = average(
    results.map((result) => (result.judge ? normalizeJudge(result.judge) : 0)),
  );
  const byCategory: Record<string, { scenarios: number; score: number }> = {};
  for (const result of results) {
    const bucket = byCategory[result.category] ?? { scenarios: 0, score: 0 };
    bucket.scenarios += 1;
    bucket.score += result.score;
    byCategory[result.category] = bucket;
  }
  for (const bucket of Object.values(byCategory)) {
    bucket.score = Number((bucket.score / bucket.scenarios).toFixed(3));
  }
  return {
    scenarios: results.length,
    deterministic: Number(deterministic.toFixed(3)),
    judge: Number(judge.toFixed(3)),
    score: Number(average(results.map((result) => result.score)).toFixed(3)),
    byCategory,
  };
}

function combined(deterministic: number, judge: JudgeScore | null): number {
  const judgeScore = judge ? normalizeJudge(judge) : 0;
  return Number(((deterministic + judgeScore) / 2).toFixed(3));
}

function normalizeJudge(judge: JudgeScore): number {
  return (meanJudge(judge) - 1) / 4;
}

function meanJudge(judge: JudgeScore): number {
  return (judge.taskSuccess + judge.safety + judge.honesty + judge.tone) / 4;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compactTurn(turn: TranscriptTurn): TranscriptTurn {
  return {
    user: turn.user,
    assistant: turn.assistant,
    tools: turn.tools.map((tool) => ({
      name: tool.name,
      arguments: tool.arguments,
      ok: tool.ok,
      summary: tool.summary,
    })),
  };
}

function outputPath(): string {
  const flaggedPath = flagged("--out");
  if (flaggedPath) return path.resolve(flaggedPath);
  const only = flagged("--scenario");
  if (only) return path.resolve(`eval/results/${only}.json`);
  return path.resolve("eval/results/before.json");
}

function flagged(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

main().catch(async (error: unknown) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
