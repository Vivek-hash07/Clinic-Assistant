# Self-Improving Patient Scheduling Agent

Next.js app with Prisma (Postgres), NextAuth, and Mem0.

## Setup

Fill in `.env` (a template is in `.env.example`):

- `DATABASE_URL` — connection string for your existing Postgres database
- `OPENROUTER_API_KEY` — [OpenRouter keys](https://openrouter.ai/keys)
- `MEM0_API_KEY` — [Mem0 API keys](https://app.mem0.ai/dashboard/api-keys)

Generate the Prisma client after `DATABASE_URL` is set:

```bash
npx prisma generate
```

Check OpenRouter and Mem0:

```bash
npm run sanity
```

Start the app:

```bash
npm run dev
```
