import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { z } from "zod";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { memory } from "./memory/index.js";
import { errMsg } from "./memory/hindsightStore.js";
import { LlmError } from "./llm.js";
import { HttpError, isoDate } from "./util.js";
import { getAccountSnapshot } from "./services/repo.js";
import { ingestInteraction, retryRetain, INTERACTION_KINDS } from "./services/ingest.js";
import { negotiationBrief } from "./services/negotiator.js";
import { ask } from "./services/ask.js";
import { overview } from "./services/dashboard.js";
import { getPlaybook, recordOutcome, refreshPlaybookModel } from "./services/playbook.js";
import { demoScript, resetDemoAccount, seedDatabase, seedMemory, DEMO_CUSTOMER_ID } from "./seed.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).then((data) => (res.headersSent ? undefined : res.json(data))).catch(next);

// ---------- system ----------
app.get(
  "/api/health",
  h(async () => {
    const mem = await memory.health();
    return {
      memory: { mode: memory.mode, ...mem },
      llm: { configured: !!config.llm.apiKey, model: config.llm.model, baseUrl: config.llm.baseUrl },
      database: config.databaseUrl ? "postgres" : "embedded postgres (PGlite)",
    };
  })
);

app.get("/api/reps", h(async () => (await getDb()).query(`SELECT * FROM reps ORDER BY name`)));

// ---------- overview ----------
app.get("/api/overview", h(overview));

// ---------- customers ----------
app.get(
  "/api/customers",
  h(async () =>
    (await getDb()).query(`
      SELECT c.*,
        (SELECT row_to_json(d) FROM (SELECT id, name, amount, stage, probability, status, risk, primary_blocker FROM deals WHERE customer_id=c.id ORDER BY status='open' DESC, amount DESC LIMIT 1) d) AS deal,
        (SELECT max(occurred_at) FROM interactions WHERE customer_id=c.id) AS last_touch,
        (SELECT count(*)::int FROM interactions WHERE customer_id=c.id) AS interaction_count,
        (SELECT count(*)::int FROM commitments WHERE customer_id=c.id AND status='open') AS open_commitments
      FROM customers c ORDER BY c.name`)
  )
);

app.get("/api/customers/:id", h(async (req) => getAccountSnapshot(String(req.params.id))));

const IngestBody = z.object({
  repId: z.string(),
  kind: z.enum(INTERACTION_KINDS),
  text: z.string().min(1),
  occurredAt: z.string().optional(),
});
app.post(
  "/api/customers/:id/interactions",
  h(async (req) => ingestInteraction({ customerId: String(req.params.id), ...IngestBody.parse(req.body) }))
);
app.post("/api/interactions/:id/retry-memory", h(async (req) => retryRetain(String(req.params.id))));

// ---------- negotiation ----------
app.post(
  "/api/customers/:id/negotiate",
  h(async (req) => negotiationBrief(String(req.params.id), z.object({ proposal: z.string().optional() }).parse(req.body ?? {}).proposal))
);

// ---------- memory explorer ----------
app.get(
  "/api/customers/:id/memory",
  h(async (req) => {
    const customerId = String(req.params.id);
    const snapshot = await getAccountSnapshot(customerId);
    const bank = memory.customerBank(customerId);
    let items: any[] = [];
    let total = 0;
    let error: string | null = null;
    try {
      const r = await memory.list(bank, { limit: 300 });
      items = r.items;
      total = r.total;
    } catch (e) {
      error = errMsg(e);
    }
    return { bank, mode: memory.mode, total, items, error, stakeholders: snapshot.stakeholders, interactions: snapshot.interactions };
  })
);
app.post(
  "/api/customers/:id/recall",
  h(async (req) => {
    const { query } = z.object({ query: z.string().min(2) }).parse(req.body);
    const bank = memory.customerBank(String(req.params.id));
    const started = Date.now();
    const hits = await memory.recall(bank, query, { maxTokens: 2500 });
    return { bank, query, ms: Date.now() - started, hits };
  })
);

// ---------- commitments ----------
app.get(
  "/api/commitments",
  h(async () => {
    const rows = await (await getDb()).query(
      `SELECT cm.*, c.name AS customer, i.kind AS source_kind, i.occurred_at AS source_date
       FROM commitments cm JOIN customers c ON c.id=cm.customer_id LEFT JOIN interactions i ON i.id=cm.interaction_id
       ORDER BY cm.status='open' DESC, cm.due_date NULLS LAST`
    );
    const today = isoDate(new Date());
    return rows.map((r: any) => {
      const due = r.due_date ? isoDate(r.due_date) : null;
      return { ...r, due_date: due, overdue: r.status === "open" && !!due && due < today };
    });
  })
);
app.post(
  "/api/commitments/:id/complete",
  h(async (req) => {
    const db = await getDb();
    const { note } = z.object({ note: z.string().optional() }).parse(req.body ?? {});
    const [c] = await db.query(
      `UPDATE commitments SET status='done', completed_at=now() WHERE id=$1 RETURNING *, (SELECT name FROM customers WHERE id=customer_id) AS customer`,
      [req.params.id]
    );
    if (!c) throw new HttpError(404, "Commitment not found");
    // The fulfilment becomes part of the account's memory, so future answers know the promise was kept.
    let memoryError: string | null = null;
    try {
      await memory.ensureCustomerBank(c.customer_id, c.customer);
      await memory.retain(
        memory.customerBank(c.customer_id),
        `${c.owner} fulfilled the commitment to ${c.promised_to ?? c.customer}: "${c.description}" on ${isoDate(new Date())}.${note ? ` Note: ${note}` : ""}`,
        { context: `commitment fulfilled — ${c.customer}`, timestamp: new Date().toISOString(), documentId: `commitment-${c.id}`, tags: ["kind:commitment"] }
      );
    } catch (e) {
      memoryError = errMsg(e);
    }
    return { ok: true, memoryError };
  })
);

// ---------- ask ----------
app.post(
  "/api/ask",
  h(async (req) => {
    const b = z.object({ question: z.string(), customerId: z.string().nullable().optional(), compare: z.boolean().optional() }).parse(req.body);
    return ask(b.question, b.customerId, b.compare ?? false);
  })
);

// ---------- playbook / learning ----------
app.get("/api/playbook", h(getPlaybook));
app.post("/api/playbook/refresh", h(async () => (await refreshPlaybookModel(), { ok: true })));
app.post(
  "/api/deals/:id/outcome",
  h(async (req) => {
    const b = z
      .object({ outcome: z.enum(["won", "lost"]), primaryBlocker: z.string(), tactics: z.string(), reason: z.string() })
      .parse(req.body);
    return recordOutcome({ dealId: String(req.params.id), ...b });
  })
);

// ---------- demo ----------
app.get("/api/demo/script", h(async () => demoScript()));
app.post("/api/demo/reset", h(async () => (await resetDemoAccount(), { ok: true, customerId: DEMO_CUSTOMER_ID })));

// ---------- errors ----------
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) return res.status(400).json({ error: "Invalid request", issues: err.issues });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof LlmError) return res.status(502).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: errMsg(err) });
});

async function main() {
  await getDb();
  const s = await seedDatabase();
  if (s.seeded) console.log("Seeded CRM data.");
  if (process.argv.includes("--seed-memory")) {
    console.log("Seeding Hindsight memory…");
    await seedMemory();
    process.exit(0);
  }
  const mem = await memory.health();
  app.listen(config.port, () => {
    console.log(`RevenueOS API on http://localhost:${config.port}`);
    console.log(`Memory: ${memory.mode} — ${mem.detail}`);
    if (!config.llm.apiKey) console.warn("WARNING: LLM_API_KEY not set — analysis and negotiation will fail.");
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
