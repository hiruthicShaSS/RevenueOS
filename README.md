# RevenueOS

**Your CRM remembers what happened. RevenueOS remembers why it happened, and what you promised to do next.**

RevenueOS is a sales intelligence and deal negotiation workspace for B2B account executives. Every meeting note, call, and email is analysed, connected to what the account told you before, and stored as long-term memory in [Hindsight](https://github.com/vectorize-io/hindsight). The negotiator then grounds every recommendation in that history, and cites it.

## What it does

| Feature | What memory adds |
|---|---|
| **Log an interaction** | Before analysing new notes, RevenueOS *recalls* what it already knows about the account, so the AI can flag what changed ("they asked for 15%, now 20% is not enough") and link the new call to earlier ones. |
| **Deal Negotiator** | Multi-angle recall (pricing, objections, technical needs, promises) plus cross-deal lessons. Every "do / don't" cites the exact memories (M#), CRM promises (C#), and playbook lessons (P#) behind it. |
| **Never forget a promise** | Commitments ("I'll send the SAP docs by Friday") are extracted with owner, recipient, and due date. When a promise is kept, that fact is written back to memory. |
| **Ask RevenueOS** | Account questions run Hindsight `reflect` on that account's bank only and return a cited answer. A toggle shows what a stateless LLM would say to the same question. |
| **Memory Explorer** | Shows what Hindsight stores for an account: facts, interactions, consolidated observations, superseded memories, entity links, and a live recall probe with semantic/keyword/rerank scores. |
| **Playbook** | Closing a deal writes an anonymised lesson (industry, blocker, tactics, outcome) to a shared bank. A Hindsight mental model keeps "what wins, by blocker" up to date, and the negotiator uses it on every other account. |

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

## The memory test

The Overview page has a three-step guided scenario on **Halcyon Logistics**:

1. **Priya** logs a meeting. The CFO (Sarah Whitman) says the price is too high and asks for 15% off. The CTO (David Okafor) needs SAP integration and a go-live under 30 days. Priya promises the integration docs by Friday.
2. Two weeks later, **Marcus**, a different rep, logs a call. Even a 20% discount doesn't convince them, they're worried about implementation complexity, and David asks about automated SAP sync.
3. Then the question: *"Why is Halcyon Logistics not closing? What should I do next?"*

The answer connects both conversations. Pricing was the stated objection, but a bigger discount was still rejected. The real blocker is implementation confidence, and the integration docs promised for that Friday were never sent. Step 3 also works after restarting the server, because it reads from Hindsight rather than from session state. **Reset** deletes the account's memory bank so the scenario can be run again.

## Tests

```bash
npm --prefix server run test:e2e
```

The end-to-end suite (`server/test/e2e.test.ts`, 17 tests) runs against real Hindsight and the real LLM, with no mocks. It starts its own server on a spare port with a throwaway database and a unique Hindsight bank prefix, and deletes every bank it created when it finishes, so your data is never touched. It covers:

- input validation and error responses on every endpoint
- the full memory scenario: extraction, "by Friday" resolving to the correct date, recall across reps, and the real blocker moving off pricing
- persistence across a **full server restart**
- isolation: one customer's bank never returns another customer's facts
- promise tracking and completion being written back to memory
- negotiator citation integrity: every cited ref resolves to real evidence
- portfolio questions, deal outcomes teaching the playbook, and demo reset

A run takes about two minutes and uses LLM and Hindsight credits.

## Project layout

```
server/   Express + TypeScript API
  src/memory/      MemoryStore interface, Hindsight implementation, offline mock
  src/services/    ingest, negotiator, ask, playbook, dashboard
  src/seed.ts      realistic accounts, history, playbook lessons, demo script
web/      React + TypeScript + Tailwind + Recharts
  src/pages/       Overview, Customers, Negotiator, Commitments, Ask, Memory Explorer, Playbook
```

## Limitations

- Extraction quality depends on the LLM. Every structured output is validated with zod and retried, with a fallback model, because open models sometimes return malformed JSON.
- Hindsight's own retain, consolidation and reflect also call an LLM, so storing an interaction takes 10–15 seconds. On Groq's free tier (8k tokens/minute per model), the app and Hindsight run on different models so they don't share a budget, and `hindsight:up` sets `HINDSIGHT_API_LLM_GROQ_SERVICE_TIER=on_demand` because the free plan rejects Hindsight's default `auto` tier. Even so, `reflect` (several ~5k-token calls per question) often exceeds the free limit. When Hindsight reports a provider quota, Ask falls back to Hindsight `recall` plus the app's model, and the UI labels which engine answered. A paid Groq tier or Hindsight Cloud removes this limit.
- Portfolio-wide questions are answered from structured CRM data plus the playbook bank, not from per-account memories. That's a deliberate trade-off to keep customer banks isolated.
