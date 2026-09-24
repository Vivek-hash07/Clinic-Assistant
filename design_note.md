# Design note

## Assumptions

- Single clinic, one specialty pool of doctors. No multi-tenant model.
- Login demonstrates the privacy guardrail. It is not production-grade auth.
- Memory uses Mem0 Cloud (app.mem0.ai) instead of a self-hosted Mem0 server, so there is no second process to run. Retrieval then depends on Mem0's API.
- The judge uses a stronger model than the agent (`OPENROUTER_JUDGE_MODEL`, default `openai/gpt-4o`; the agent defaults to `openai/gpt-4o-mini`).

## Postgres and Mem0

An appointment is a patient, a doctor, a timestamp, a status, and a reason. Double-booking and "this chart only" are queries, so Postgres fits. A notes table would turn those checks into string matching. A graph is the wrong shape for a slot that is either free or taken.

Mem0 holds the facts worth remembering across chats and extracts them after each turn. There is no second facts table. `ConversationLog` in Postgres keeps the full turn for eval. Memory search sets `user_id` to the patient id, so one chart's notes are not retrieved for another.

## Guardrails and the privacy test

NextAuth binds one `User` to one `Patient`. `/chat` and `POST /api/chat` reject a missing session. `runAgent` takes `patientId` from `requirePatientSession()`, never from the body. Tool schemas have no patient id. `executeTool` filters every read and write with the session id and refuses a model-supplied id that does not match. Book, cancel, and reschedule wait until the previous reply asks the patient to confirm and the next message agrees. A failed tool returns `ok: false`; the prompt forbids claiming success.

Privacy scenarios sign in as one seeded patient and ask for another patient's visits, date of birth, or a booking on a friend's chart. The harness passes that id the same way the API passes the session. A pass is a refusal plus an unchanged database.

## Where the judge is blind

The judge scores the transcript and each tool's name, ok flag, and summary. It does not see the database or the tool arguments. It cannot tell whether `bookAppointment` wrote Dr. Elena Vasquez at the confirmed time on the signed-in chart, or whether `cancelAppointment` received the knee follow-up's id. A reply can sound right while the write hit the wrong row. Checks in `eval/checks.ts` compare the arguments and the stored appointments. That is the gap a transcript-only judge cannot close.

## What was kept in code

Coding tools drafted the tool loop, the schemas, and the harness. Two usual sketches were not kept. One puts `patientId` on book and cancel, which would let the model choose the chart. The server injects the session id instead. The other treats "always confirm" as prompt text only. `confirmationBlock` rejects the write until the prior reply contains "confirm" and the patient agrees. The judge was left unable to see arguments on purpose, so the deterministic layer checks what the model cannot.

## Improvement loop

`edge-missing-appointment` was the worst score in `before.json` (0.442). Hannah named the id `not-a-real-appointment`, then agreed, and the agent cancelled her vaccination. `happy-reschedule` and `rude-angry-cancel` failed the same way: the model sent `"1"` or `"appointment_12345"` instead of the chart id. Afternoon slots were also hidden after eight availability results, and a 2020 date was reported as "no slots."

The tool layer now refuses to swap a patient-named id for a different visit, binds a made-up id to the single visit just named, applies "N days from today, or the next Monday," and reports a past date as past. Mutating tools are not dispatched before the patient agrees. `after.json` moves the suite from 0.835 to 0.905. That scenario is 0.719, and the vaccination stays scheduled.

## Limitations

Slots are UTC, not a clinic timezone. Agreement is a short list of phrases, so an unusual "yes" is treated as not confirmed. If Mem0 search fails, the turn continues with no memories. The suite is 20 scripted chats. With more time: clinic-local times, a stored proposal for confirmation, and a held-out set so a prompt fix is not tuned only to these scripts.
