import { z } from "zod";
import { getDb } from "../db.js";
import { llmJson } from "../llm.js";
import { memory, type MemoryHit } from "../memory/index.js";
import { errMsg } from "../memory/hindsightStore.js";
import { id, isoDate, weekday, HttpError } from "../util.js";
import { getAccountSnapshot, snapshotToText } from "./repo.js";

export const INTERACTION_KINDS = ["meeting", "call", "email", "note", "follow_up", "document"] as const;

const Stance = z.enum(["champion", "supporter", "neutral", "skeptic", "blocker", "unknown"]).catch("unknown");
const ObjCat = z
  .enum(["pricing", "integration", "implementation", "security", "competition", "timing", "authority", "product_gap", "other"])
  .catch("other");

const nullableStr = z.string().nullable().optional().transform((v) => v ?? null);

export const AnalysisSchema = z.object({
  summary: z.string(),
  facts: z.array(z.string()).default([]),
  stakeholders: z
    .array(z.object({ name: z.string(), role: nullableStr, stance: Stance, priorities: nullableStr }))
    .default([]),
  objections: z.array(z.object({ category: ObjCat, description: z.string(), raised_by: nullableStr })).default([]),
  offers: z
    .array(
      z.object({
        description: z.string(),
        discount_pct: z.number().nullable().optional().transform((v) => v ?? null),
        response: z.enum(["accepted", "rejected", "pending", "countered"]).catch("pending"),
      })
    )
    .default([]),
  commitments: z
    .array(
      z.object({
        owner: z.string(),
        promised_to: nullableStr,
        description: z.string(),
        due_date: nullableStr,
        direction: z.enum(["ours", "theirs"]).catch("ours"),
      })
    )
    .default([]),
  fulfilled_commitment_ids: z.array(z.string()).default([]),
  resolved_objection_ids: z.array(z.string()).default([]),
  requirements: z.array(z.string()).default([]),
  repeated_facts: z.array(z.string()).default([]),
  connections: z.array(z.object({ memory_ref: z.string(), explanation: z.string() })).default([]),
  contradictions: z
    .array(z.object({ previously: z.string(), now: z.string(), memory_ref: nullableStr, significance: z.string() }))
    .default([]),
  primary_blocker: nullableStr,
  risk: z.enum(["low", "medium", "high"]).catch("medium"),
  sentiment: z.enum(["positive", "neutral", "negative", "mixed"]).catch("neutral"),
  next_actions: z.array(z.object({ action: z.string(), owner: nullableStr, why: z.string() })).default([]),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export interface IngestInput {
  customerId: string;
  repId: string;
  kind: (typeof INTERACTION_KINDS)[number];
  text: string;
  occurredAt?: string;
  /** Set for uploaded documents: provenance carried into the CRM row and Hindsight. */
  source?: { fileName: string; format: string; pages: number | null; truncated: boolean };
}

/**
 * The core memory workflow:
 *  1. recall what Hindsight already knows about this account (before the new info lands)
 *  2. LLM extraction against that prior context -> facts, objections, promises, contradictions
 *  3. persist structured entities (Postgres)
 *  4. retain the interaction into the customer's Hindsight bank (facts, entities, time)
 */
export async function ingestInteraction(input: IngestInput) {
  return persistInteraction(await analyzeInteraction(input));
}

export type AnalyzedInteraction = Awaited<ReturnType<typeof analyzeInteraction>>;

/** Steps 1-2: recall + extraction. Writes nothing, so uploads can be previewed before confirming. */
export async function analyzeInteraction(input: IngestInput) {
  const db = await getDb();
  const text = input.text.trim();
  if (text.length < 15) throw new HttpError(400, "Interaction text is too short to analyse.");
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) throw new HttpError(400, "Invalid occurredAt date.");

  const snapshot = await getAccountSnapshot(input.customerId, occurredAt);
  const [rep] = await db.query(`SELECT * FROM reps WHERE id=$1`, [input.repId]);
  if (!rep) throw new HttpError(400, `Unknown rep ${input.repId}`);
  const customer = snapshot.customer;
  const bank = memory.customerBank(customer.id);
  await memory.ensureCustomerBank(customer.id, customer.name);

  // 1. Prior memory, recalled with the new interaction as the query.
  let prior: MemoryHit[] = [];
  let recallError: string | null = null;
  try {
    prior = (await memory.recall(bank, text, { maxTokens: 2500 })).slice(0, 20);
  } catch (e) {
    recallError = errMsg(e);
  }
  const refs = prior.map((m, i) => ({ ref: `M${i + 1}`, m }));

  // 2. Extraction.
  const analysis = await llmJson({
    schema: AnalysisSchema,
    system:
      "You are the analysis engine of a sales CRM. You read a new customer interaction logged by a sales rep, " +
      "compare it with what we already remember about the account, and extract structured intelligence. Be precise and literal: " +
      "never invent people, numbers or dates that are not in the text. 'Our' commitments are promises made by our sales team; " +
      "'theirs' are promises made by the customer. When judging primary_blocker, weigh what the customer does over what they say: " +
      "if discounts were offered and rejected while non-price concerns keep coming up, price is probably not the real blocker.",
    user: [
      `Today the rep logging this is ${rep.name} (${rep.title}). Interaction type: ${input.kind}.`,
      ...(input.source
        ? [
            `This is an UPLOADED DOCUMENT ("${input.source.fileName}", ${input.source.format}${input.source.pages ? `, ${input.source.pages} pages` : ""}). It may be a transcript, email, proposal or notes: extract only what it actually states.`,
            `Where the text has [Page N] or [Section: ...] markers, end each fact, objection description and commitment description with its reference in parentheses, e.g. "(p. 2)".`,
          ]
        : []),
      `Interaction date: ${isoDate(occurredAt)} (${weekday(occurredAt)}). Resolve relative due dates such as "by Friday" against this date and output YYYY-MM-DD.`,
      ``,
      `STRUCTURED CRM STATE BEFORE THIS INTERACTION:`,
      snapshotToText(snapshot),
      `Open objections (ids):`,
      ...(snapshot.objections.filter((o: any) => o.status === "open").map((o: any) => `  [O:${o.id}] (${o.category}) ${o.description}${o.raised_by ? ` — ${o.raised_by}` : ""}`)),
      ``,
      `WHAT LONG-TERM MEMORY ALREADY KNOWS (recalled from Hindsight, most relevant first):`,
      refs.length ? refs.map(({ ref, m }) => `[${ref}] (${m.occurredAt?.slice(0, 10) ?? "undated"}) ${m.text}`).join("\n") : "(nothing yet — this is the first interaction we remember)",
      ``,
      `NEW INTERACTION:`,
      `"""${text}"""`,
      ``,
      `Return JSON with keys:`,
      `summary (1-2 sentences), facts (atomic durable facts that are NEW, i.e. not already in long-term memory), repeated_facts (facts this interaction states that memory already had; append the ref, e.g. "... [M3]"), stakeholders [{name, role, stance, priorities}],`,
      `objections [{category: pricing|integration|implementation|security|competition|timing|authority|product_gap|other, description, raised_by}],`,
      `offers [{description, discount_pct, response: accepted|rejected|pending|countered}] — include offers the customer responds to in this interaction,`,
      `commitments [{owner, promised_to, description, due_date (YYYY-MM-DD or null), direction: ours|theirs}] — only NEW promises made in this interaction; never repeat one already in the CRM list or one this interaction says was delivered,`,
      `fulfilled_commitment_ids (ids from the CRM list, only if this interaction shows one was delivered),`,
      `resolved_objection_ids (ids from the open objections list that this interaction clearly shows no longer apply),`,
      `requirements (buying requirements), connections [{memory_ref (e.g. M2), explanation of how the new interaction relates}],`,
      `contradictions [{previously, now, memory_ref, significance}] — where new info changes or conflicts with what we knew,`,
      `primary_blocker (the real reason the deal is not closing, given ALL evidence), risk: low|medium|high, sentiment, next_actions [{action, owner, why}].`,
      `Use the rep's name "${rep.name}" as owner when the rep says "I". Stakeholder roles like CFO/CTO belong in role.`,
    ].join("\n"),
  });

  // Map memory refs back to real memory objects for the UI.
  const refMap = new Map(refs.map(({ ref, m }) => [ref, m]));
  const connections = analysis.connections
    .filter((c) => refMap.has(c.memory_ref))
    .map((c) => ({ ...c, memory: refMap.get(c.memory_ref)! }));
  const contradictions = analysis.contradictions.map((c) => ({
    ...c,
    memory: c.memory_ref ? refMap.get(c.memory_ref) ?? null : null,
  }));
  return { input, text, occurredAt, snapshot, rep, customer, bank, prior, recallError, analysis, connections, contradictions };
}

/** Steps 3-4: persist structured CRM data and retain the interaction into Hindsight. */
export async function persistInteraction(a: AnalyzedInteraction) {
  const db = await getDb();
  const { input, text, occurredAt, snapshot, rep, customer, bank, prior, recallError, analysis, connections, contradictions } = a;

  // 3. Persist structured data.
  const interactionId = id("int");
  await db.query(
    `INSERT INTO interactions (id, customer_id, rep_id, kind, occurred_at, raw_text, analysis, memory_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')`,
    [interactionId, customer.id, rep.id, input.kind, occurredAt.toISOString(), text, JSON.stringify({ ...analysis, connections, contradictions, recalled: prior.length, recallError, source: input.source ?? null })]
  );

  for (const s of analysis.stakeholders) {
    await db.query(
      `INSERT INTO stakeholders (id, customer_id, name, role, stance, priorities)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (customer_id, name) DO UPDATE SET
         role = COALESCE(EXCLUDED.role, stakeholders.role),
         stance = CASE WHEN EXCLUDED.stance='unknown' THEN stakeholders.stance ELSE EXCLUDED.stance END,
         priorities = COALESCE(EXCLUDED.priorities, stakeholders.priorities),
         updated_at = now()`,
      [id("stk"), customer.id, s.name.trim(), s.role, s.stance, s.priorities]
    );
  }
  for (const o of analysis.objections) {
    await db.query(
      `INSERT INTO objections (id, customer_id, interaction_id, category, description, raised_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id("obj"), customer.id, interactionId, o.category, o.description, o.raised_by]
    );
  }
  for (const o of analysis.offers) {
    await db.query(
      `INSERT INTO offers (id, customer_id, interaction_id, description, discount_pct, response) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id("off"), customer.id, interactionId, o.description, o.discount_pct, o.response]
    );
  }
  const newCommitments = [];
  // Backstop for the model re-listing a promise that is already tracked (or was just delivered).
  const tracked = snapshot.commitments.map((c: any) => c.description as string);
  for (const c of analysis.commitments) {
    if (tracked.some((t) => similar(t, c.description))) continue;
    const due = c.due_date && /^\d{4}-\d{2}-\d{2}$/.test(c.due_date) ? c.due_date : null;
    const cid = id("cmt");
    await db.query(
      `INSERT INTO commitments (id, customer_id, interaction_id, owner, promised_to, description, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [cid, customer.id, interactionId, c.owner, c.promised_to, c.description, due]
    );
    newCommitments.push({ id: cid, ...c, due_date: due });
  }
  const openObjectionIds = new Set(snapshot.objections.filter((o: any) => o.status === "open").map((o: any) => o.id));
  const resolvedObjections = analysis.resolved_objection_ids.map((x) => x.replace(/^O:/, "")).filter((x) => openObjectionIds.has(x));
  for (const oid of resolvedObjections) {
    await db.query(`UPDATE objections SET status='resolved' WHERE id=$1`, [oid]);
  }
  const validIds = new Set(snapshot.commitments.map((c: any) => c.id));
  for (const cid of analysis.fulfilled_commitment_ids.map((x) => x.replace(/^C:/, "")).filter((x) => validIds.has(x))) {
    await db.query(`UPDATE commitments SET status='done', completed_at=$2 WHERE id=$1`, [cid, occurredAt.toISOString()]);
  }
  await db.query(
    `UPDATE deals SET risk=$2, primary_blocker=COALESCE($3, primary_blocker), updated_at=now()
     WHERE customer_id=$1 AND status='open'`,
    [customer.id, analysis.risk, analysis.primary_blocker]
  );

  // 4. Retain into Hindsight. The raw interaction is the source of truth; Hindsight
  //    does its own fact extraction, entity linking and temporal indexing on it.
  let memoryStatus = "stored";
  let memoryError: string | null = null;
  try {
    await retainInteraction({
      bank,
      interactionId,
      customerName: customer.name,
      repName: rep.name,
      repTitle: rep.title,
      kind: input.kind,
      occurredAt: occurredAt.toISOString(),
      text,
      stakeholderNames: analysis.stakeholders.map((s) => s.name),
      source: input.source,
    });
  } catch (e) {
    memoryStatus = "failed";
    memoryError = errMsg(e);
  }
  await db.query(`UPDATE interactions SET memory_status=$2, memory_error=$3 WHERE id=$1`, [interactionId, memoryStatus, memoryError]);

  return {
    interactionId,
    memoryStatus,
    memoryError,
    recallError,
    recalledCount: prior.length,
    analysis: { ...analysis, connections, contradictions },
    newCommitments,
    resolvedObjections,
  };
}

function similar(a: string, b: string) {
  const tok = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const x = tok(a);
  const y = tok(b);
  if (!x.size || !y.size) return false;
  let inter = 0;
  x.forEach((w) => y.has(w) && inter++);
  return inter / (x.size + y.size - inter) >= 0.6;
}

export async function retainInteraction(p: {
  bank: string;
  interactionId: string;
  customerName: string;
  repName: string;
  repTitle: string;
  kind: string;
  occurredAt: string;
  text: string;
  stakeholderNames: string[];
  source?: { fileName: string; format: string; pages: number | null };
}) {
  const label = p.kind.replace("_", " ");
  const header = p.source
    ? `Document "${p.source.fileName}" about ${p.customerName}, dated ${p.occurredAt.slice(0, 10)}, uploaded by our rep ${p.repName} (${p.repTitle}):`
    : `${label[0].toUpperCase()}${label.slice(1)} with ${p.customerName} on ${p.occurredAt.slice(0, 10)}, logged by our rep ${p.repName} (${p.repTitle}):`;
  await memory.retain(
    p.bank,
    `${header}\n${p.text}`,
    {
      context: p.source ? `uploaded document ${p.source.fileName} — ${p.customerName} account` : `${label} notes — ${p.customerName} account`,
      timestamp: p.occurredAt,
      documentId: p.interactionId,
      tags: [`kind:${p.kind}`, `rep:${p.repName}`, ...(p.source ? [`file:${p.source.fileName.slice(0, 80)}`] : [])],
      // Only the account itself. Entities passed here are attached to every fact extracted from
      // this interaction, so people are left to Hindsight's per-fact entity extraction instead.
      entities: [{ text: p.customerName, type: "ORGANIZATION" }],
      metadata: {
        interaction_id: p.interactionId,
        rep: p.repName,
        kind: p.kind,
        ...(p.source ? { source_file: p.source.fileName, source_format: p.source.format, ...(p.source.pages ? { pages: String(p.source.pages) } : {}) } : {}),
      },
    }
  );
}

/** Retry the Hindsight write for an interaction that failed to store (e.g. Hindsight was down). */
export async function retryRetain(interactionId: string) {
  const db = await getDb();
  const [row] = await db.query(
    `SELECT i.*, c.name AS customer_name, r.name AS rep_name, r.title AS rep_title
     FROM interactions i JOIN customers c ON c.id=i.customer_id LEFT JOIN reps r ON r.id=i.rep_id WHERE i.id=$1`,
    [interactionId]
  );
  if (!row) throw new HttpError(404, "Interaction not found");
  await memory.ensureCustomerBank(row.customer_id, row.customer_name);
  try {
    await retainInteraction({
      bank: memory.customerBank(row.customer_id),
      interactionId,
      customerName: row.customer_name,
      repName: row.rep_name ?? "unknown rep",
      repTitle: row.rep_title ?? "",
      kind: row.kind,
      occurredAt: new Date(row.occurred_at).toISOString(),
      text: row.raw_text,
      stakeholderNames: (row.analysis?.stakeholders ?? []).map((s: any) => s.name),
      source: row.analysis?.source ?? undefined,
    });
    await db.query(`UPDATE interactions SET memory_status='stored', memory_error=NULL WHERE id=$1`, [interactionId]);
    return { ok: true };
  } catch (e) {
    await db.query(`UPDATE interactions SET memory_status='failed', memory_error=$2 WHERE id=$1`, [interactionId, errMsg(e)]);
    throw new HttpError(502, errMsg(e));
  }
}
