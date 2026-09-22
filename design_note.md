# Design note

## Assumptions

- Single clinic, single specialty pool of doctors. No multi-tenant model.
- Login is for demonstrating security guardrails, not production-grade auth.
- Conversation memory uses Mem0 Cloud (API key from app.mem0.ai) instead of a self-hosted Mem0 server. That avoids running another service for this project. The tradeoff is that memory storage and retrieval depend on Mem0's hosted API.
- The eval judge will use a stronger model than the scheduling agent, to reduce self-grading bias.
- Postgres is an existing database. Its connection string lives in `DATABASE_URL`. This project does not start Postgres with Docker.
