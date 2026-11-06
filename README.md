# RevenueOS

**Your CRM remembers what happened. RevenueOS remembers why it happened, and what you promised to do next.**

RevenueOS is a sales intelligence and deal negotiation workspace for B2B account executives. Every meeting note, call, and email is analysed, connected to what the account told you before, and stored as long-term memory in [Hindsight](https://github.com/vectorize-io/hindsight). The negotiator then grounds every recommendation in that history, and cites it.

## What it does

| Feature | What memory adds |
|---|---|
| **Team sign-in** | Each teammate signs in with their work email and designation. Everything they log carries their name and role, and all of it goes into one shared memory per customer, so whoever negotiates next starts with what the whole team has heard. |
| **Home: Ask + overview** | One page with a large Ask box at the top and the pipeline below: metrics, AI insights, promises coming due, charts, the team, and open deals. Account questions run Hindsight `reflect` on that account's bank only and return a cited answer; "I" and "my" in a question mean the signed-in teammate. A toggle shows what a stateless LLM would say to the same question. |
| **Log an interaction** | Before analysing new notes, RevenueOS *recalls* what it already knows about the account, so the AI can separate new information from what memory already had, flag what changed ("they asked for 15%, now 20% is not enough") and link the new call to earlier ones. |
| **Upload documents** | PDF, DOCX, TXT, Markdown, CSV and EML files go through the same pipeline as typed notes. Text is extracted with page and section markers, the account is identified from names, domains and stakeholders (or the user is asked when it is unclear), and an extraction preview is shown before anything is saved. Confirmed documents are retained in Hindsight with the file name, date and page references. |
| **Deal Negotiator** | Multi-angle recall (pricing, objections, technical needs, promises) over notes logged by every teammate on the account, plus cross-deal lessons. The brief is organised as verdict, confidence, actual blocker, what the customer says, what memory reveals, strategy, what not to do, risks and a plan per stakeholder. Every point cites the memories (M#), CRM promises (C#) and playbook lessons (P#) behind it, and each memory opens in the Memory Explorer. |
| **Never forget a promise** | Commitments ("I'll send the SAP docs by Friday") are extracted with owner, recipient, and due date. When a promise is kept, that fact is written back to memory. |
| **Memory Explorer** | A knowledge map of one account's memory (React Flow): the customer in the centre, nine categories around it, and the account's real memories inside them. Links between memories (semantic, temporal, causal, shared person) come from Hindsight's memory graph; the category grouping is derived by RevenueOS and labelled as such. Search, filters by category, stakeholder and date, and a detail panel with the source conversation or document, related memories, commitments and deals. The list view with the live recall probe (semantic, keyword and rerank scores) is still one click away. |
| **Playbook** | Closing a deal writes the full outcome to the account's own bank and an anonymised lesson to a shared bank: the LLM rewrites it in general terms, then a deterministic pass removes any remaining customer, stakeholder or rep name, amount or date. Lessons are grouped by blocker with won/lost counts and evidence strength, can be drafted from the account's memory, and are recalled by the negotiator on every other account. |
| **Light and dark themes** | A warm light theme and an inked dark theme built on shared design tokens, with a system option. The choice persists across sessions. |

## How Hindsight is used

```
                ┌────────────── Postgres ───────────────┐
 rep notes ──►  │ customers · deals · commitments ·     │  structured CRM state
                │ objections · offers · stakeholders     │
                └───────────────────────────────────────┘
      │
      ▼
 recall(account bank, new notes) ──► LLM extraction ──► retain(account bank, notes,
                                      (facts, promises,         timestamp, entities,
                                       contradictions)          document_id, tags)
      
 negotiator ──► recall × 5 angles (account bank) + recall (playbook bank) ──► cited brief
 ask        ──► reflect(account bank, include facts) ──► answer + based_on memories
 outcome    ──► retain(account bank) + retain(playbook bank) ──► mental model refresh
```

- **One memory bank per customer** (`revenueos-customer-<id>`). Banks are isolated in Hindsight, so one account's history can't leak into another account's answers. Each bank gets a `retain_mission` that tells Hindsight what to extract for sales: stakeholders, objections, offers and responses, commitments, and timelines.
- **One shared playbook bank** (`revenueos-playbook`) holds anonymised deal outcomes. Observations are enabled, so Hindsight consolidates patterns like "discounts lose when the blocker is integration".
- **retain** is called with `timestamp` (when the conversation happened, not when it was logged), `entities` (people and company), `document_id` (the interaction id, so re-storing is idempotent), and tags.
- **recall** results carry relevance scores, which the Memory Explorer and the negotiator's evidence panel display.
- **reflect** with `include.facts` returns `based_on`, so every Ask answer lists the memories it used.
- **Mental model** `what-wins-by-blocker` on the playbook bank refreshes after consolidation.

Code: [`server/src/memory/hindsightStore.ts`](server/src/memory/hindsightStore.ts), [`server/src/services/ingest.ts`](server/src/services/ingest.ts), [`server/src/services/negotiator.ts`](server/src/services/negotiator.ts), [`server/src/services/ask.ts`](server/src/services/ask.ts), [`server/src/services/playbook.ts`](server/src/services/playbook.ts).

## Running it

Requirements: Node 20+, Docker (for self-hosted Hindsight), and an LLM API key. Groq is the default; any OpenAI-compatible endpoint works.

```bash
npm install
npm run install:all

# 1. App config: set LLM_API_KEY (HINDSIGHT_BASE_URL defaults to http://localhost:8888)
cp server/.env.example server/.env

# 2. Hindsight, self-hosted in Docker. Reuses the LLM key from server/.env.
npm run hindsight:up          # API on :8888, Hindsight UI on :9999

# 3. Optional: load history for the other accounts plus playbook lessons into Hindsight
npm run seed:memory

# 4. Run
npm run dev                   # API :4000, web :5173
```

To use **Hindsight Cloud** instead of Docker, set `HINDSIGHT_BASE_URL` and `HINDSIGHT_API_KEY` in `server/.env`.

CRM data uses embedded Postgres (PGlite) by default and is stored in `server/data/`. Set `DATABASE_URL` to use a regular Postgres server.

`MEMORY_MODE=mock` swaps Hindsight for a naive keyword store. It exists only for offline UI work, and the UI shows a banner whenever it's active.

## Deploying with Docker

The `Dockerfile` builds one image that serves both the web app and the API on port 4000 (the server serves the built UI when `WEB_DIST` is set). `deploy/docker-compose.yml` runs it next to a Postgres container for the CRM data; memory stays in Hindsight Cloud.

```bash
python scripts/deploy.py --seed-memory   # first deploy
python scripts/deploy.py                 # later deploys
```

The script builds the image locally, streams it to the server over ssh (`docker save | gzip | docker load`), uploads the compose file and `restart.py` to `~/services/revenueos`, and starts the stack on `127.0.0.1:1039`. On the first run it creates the server `.env` from `deploy/.env.example`, copying the API keys from `server/.env` and generating a database password; after that the server's `.env` is left alone unless you pass `--new-env`. Production uses its own Hindsight bank prefix (`revenueos-prod`), so it never mixes with local data. Point a tunnel or reverse proxy at `http://localhost:1039`.

## The memory test

Run it with two teammates, for example in two browsers (or a normal and a private window), since each browser keeps its own session. The seeded teammates can sign in with their emails: `priya.nair@revenueos.app` and `marcus.chen@revenueos.app`. Any other email creates a new teammate.

1. **Priya** opens **Halcyon Logistics** and logs a meeting. The CFO (Sarah Whitman) says the price is too high and asks for 15% off. The CTO (David Okafor) needs SAP integration and a go-live under 30 days. Priya promises the integration docs by Friday.
2. **Marcus**, signed in separately, logs a later call (set the date two weeks on). Even a 20% discount doesn't convince them, they're worried about implementation complexity, and David asks about automated SAP sync.
3. Either of them asks on Home: *"Why is Halcyon Logistics not closing? What should I do next?"*, or opens the Deal Negotiator, which lists both teammates as sources.

The answer connects both conversations. Pricing was the stated objection, but a bigger discount was still rejected. The real blocker is implementation confidence, and the integration docs promised for that Friday were never sent. Step 3 also works after restarting the server, because it reads from Hindsight rather than from session state. The meeting texts are in `demoScript()` in `server/src/seed.ts`, and `POST /api/demo/reset` deletes the account's CRM rows and memory bank so the scenario can be run again.

## Tests

```bash
npm --prefix server run test:e2e
```

The end-to-end suite (`server/test/e2e.test.ts`, 20 tests) runs against real Hindsight and the real LLM, with no mocks. It starts its own server on a spare port with a throwaway database and a unique Hindsight bank prefix, and deletes every bank it created when it finishes, so your data is never touched. It covers:

- sign-in: every API needs a session, new teammates are created from their email, known emails reuse their profile, logout ends only that session
- input validation and error responses on every endpoint
- the full memory scenario with two signed-in teammates: extraction, "by Friday" resolving to the correct date, recall across teammates, attribution of each note, and the real blocker moving off pricing
- persistence across a **full server restart**
- isolation: one customer's bank never returns another customer's facts
- promise tracking and completion being written back to memory
- negotiator citation integrity (every cited ref resolves to real evidence) and that the brief draws on both teammates' notes
- portfolio questions, deal outcomes teaching the playbook, and demo reset

A run takes about two minutes and uses LLM and Hindsight credits.

## Project layout

```
server/   Express + TypeScript API
  src/memory/      MemoryStore interface, Hindsight implementation, offline mock
  src/services/    ingest, negotiator, ask, playbook, dashboard
  src/seed.ts      realistic accounts, history, playbook lessons, demo script
web/      React + TypeScript + Tailwind + Recharts
  src/pages/       Login, Home (Ask + overview), Customers, Negotiator, Commitments, Memory Explorer, Playbook
```

## Limitations

- Sign-in identifies teammates by email and designation only; there is no password or email verification. It is meant for a trusted team workspace, and real deployments should put it behind SSO.
- Extraction quality depends on the LLM. Every structured output is validated with zod and retried, with a fallback model, because open models sometimes return malformed JSON.
- Hindsight's own retain, consolidation and reflect also call an LLM, so storing an interaction takes 10–15 seconds. On Groq's free tier (8k tokens/minute per model), the app and Hindsight run on different models so they don't share a budget, and `hindsight:up` sets `HINDSIGHT_API_LLM_GROQ_SERVICE_TIER=on_demand` because the free plan rejects Hindsight's default `auto` tier. Even so, `reflect` (several ~5k-token calls per question) often exceeds the free limit. When Hindsight reports a provider quota, Ask falls back to Hindsight `recall` plus the app's model, and the UI labels which engine answered. A paid Groq tier or Hindsight Cloud removes this limit.
- Portfolio-wide questions are answered from structured CRM data plus the playbook bank, not from per-account memories. That's a deliberate trade-off to keep customer banks isolated.
