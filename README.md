# Self-Improving Patient Scheduling Agent

Next.js scheduling assistant for one clinic. Postgres holds accounts and appointments. Mem0 holds conversation memory. OpenRouter runs the agent and a stronger eval judge.

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
