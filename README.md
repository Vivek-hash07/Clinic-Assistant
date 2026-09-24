# Self-Improving Patient Scheduling Agent

A single-clinic scheduling assistant. You sign in as a patient, then ask the assistant to list, book, cancel, or reschedule visits. It only acts on the chart linked to that account.

**Live app:** [https://clinic-assistant-livid.vercel.app/](https://clinic-assistant-livid.vercel.app/)

Sign in with a demo account below, or create one. New accounts start with an empty chart.

## What it does

- Sign up and sign in with email and password (NextAuth). Each account is one patient.
- Chat to check weekday availability, book a visit, cancel, or move one. The assistant confirms the doctor, time, and reason before it changes the chart.
- Saved conversations stay in the sidebar and reopen on the same chart.
- The assistant does not give medical advice, and it refuses requests about another patient's visits.

Postgres stores accounts and appointments. Mem0 stores facts worth remembering across chats. OpenRouter runs the agent (`openai/gpt-4o-mini` by default) and a stronger eval judge (`openai/gpt-4o`).

Clinic hours are weekdays, 09:00–16:30 UTC, every 30 minutes. Doctors: Dr. Priya Shah, Dr. James Okonkwo, Dr. Elena Vasquez.

## Commands

Agent and chat UI:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign up or sign in, then use `/chat`.

Eval harness (20 scripted scenarios, deterministic checks, then the LLM judge). Writes `eval/results/before.json`:

```bash
npm run eval
```

One scenario, or a second full run after a fix:

```bash
npm run eval -- --scenario privacy-other-chart
npm run eval -- --out eval/results/after.json
```

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `DATABASE_URL` — existing Postgres database (this project does not start Postgres)
- `OPENROUTER_API_KEY` — [OpenRouter keys](https://openrouter.ai/keys)
- `OPENROUTER_MODEL` — agent, default `openai/gpt-4o-mini`
- `OPENROUTER_JUDGE_MODEL` — judge, default `openai/gpt-4o` (must be stronger than the agent)
- `MEM0_API_KEY` — [Mem0 API keys](https://app.mem0.ai/dashboard/api-keys)
- `NEXTAUTH_SECRET` — `openssl rand -base64 32`
- `NEXTAUTH_URL` — `http://localhost:3000` locally, or the deployed origin in production

Apply the schema, generate the client, and load the demo clinic:

```bash
npx prisma migrate dev
npx prisma generate
npm run db:seed
npm run sanity
```

`npm run sanity` checks one OpenRouter chat call and a Mem0 add plus search.

## Demo accounts

Password for every seeded patient: `patient-demo`

| Email | Name |
| --- | --- |
| maya.patel@clinic.example | Maya Patel |
| luis.romero@clinic.example | Luis Romero |
| hannah.berg@clinic.example | Hannah Berg |

Each chart already has appointments, so cancel and reschedule have a real visit to act on. Sign-up at `/auth/signup` creates a new user and an empty linked chart.

Decisions, guardrails, and the before/after eval loop are in `design_note.md`. The build plan is in `roadmap.md`.
