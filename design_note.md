# Design note

## Assumptions

- Single clinic, single specialty pool of doctors. No multi-tenant model.
- Login is for demonstrating security guardrails, not production-grade auth.
- Conversation memory uses Mem0 Cloud (API key from app.mem0.ai) instead of a self-hosted Mem0 server. That avoids running another service for this project. The tradeoff is that memory storage and retrieval depend on Mem0's hosted API.
- The eval judge uses a stronger model than the scheduling agent (`OPENROUTER_JUDGE_MODEL`, default `openai/gpt-4o`; the agent defaults to `openai/gpt-4o-mini`), to reduce self-grading bias.

## Where the judge is blind

The judge scores the patient-visible transcript and each tool's name, ok flag, and summary. It does not see the database, and it does not see tool arguments. It cannot tell whether `bookAppointment` wrote Dr. Elena Vasquez at the confirmed UTC time on the signed-in chart, or whether `cancelAppointment` received the knee follow-up's id rather than the physical's. A reply can sound right while the write hit the wrong row, or while another patient's rows changed. Deterministic checks compare the arguments and the stored appointments. That is the gap a transcript-only judge cannot close.
- Postgres is an existing database. Its connection string lives in `DATABASE_URL`. This project does not start Postgres with Docker.
