import { z } from "zod";
import { getDb } from "../db.js";
import { llmJson } from "../llm.js";
import { memory, type MemoryHit } from "../memory/index.js";
import { errMsg } from "../memory/hindsightStore.js";
import { HttpError, isoDate } from "../util.js";

export const PLAYBOOK_MODEL_ID = "what-wins-by-blocker";
export const PLAYBOOK_MODEL_QUERY =
  "For each primary deal blocker we have seen (pricing, integration, implementation risk, security, competition, timing), " +
  "which negotiation tactics won deals and which lost them? Give counts of supporting deals and one-line rules a rep can follow.";

function sizeBand(n: number | null) {
  if (!n) return "unknown size";
  if (n < 500) return "SMB (<500 employees)";
  if (n < 5000) return "mid-market (500-5,000 employees)";
  return "enterprise (5,000+ employees)";
}
function valueBand(amount: number) {
  if (amount < 100_000) return "under $100k";
  if (amount < 250_000) return "$100k-$250k";
  if (amount < 500_000) return "$250k-$500k";
  return "$500k+";
}

/* ------------------------------------------------------------------ anonymisation */

const AnonSchema = z.object({
  blocker: z.string(),
  tactics: z.string(),
  why: z.string(),
  lesson: z.string(),
});

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Names that must never reach the shared playbook bank. */
async function identifyingNames(customerId: string) {
  const db = await getDb();
  const [c] = await db.query(`SELECT name, website FROM customers WHERE id=$1`, [customerId]);
  const people = await db.query(`SELECT name FROM stakeholders WHERE customer_id=$1`, [customerId]);
  const reps = await db.query(`SELECT name FROM reps`);
  const names = new Set<string>();
  if (c) {
    names.add(c.name);
    const first = c.name.split(/\s+/)[0];
    if (first.length > 3) names.add(first);
    if (c.website) names.add(String(c.website).replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
  }
  for (const p of [...people, ...reps]) {
    names.add(p.name);
    const parts = String(p.name).split(/\s+/);
    for (const part of parts) if (part.length > 2) names.add(part);
  }
  return [...names].sort((a, b) => b.length - a.length);
}

/** Deterministic backstop after the LLM rewrite: no name, domain, exact amount or date survives. */
function scrub(text: string, names: string[]) {
  let t = text;
  for (const n of names) t = t.replace(new RegExp(`\\b${escapeRe(n)}\\b`, "gi"), "the customer");
  t = t
    .replace(/\$\s?\d[\d,.]*\s?(k|m|million|thousand)?/gi, "a specific amount")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "a specific date")
    .replace(/\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?)\s+\d{1,2}(st|nd|rd|th)?\b/gi, "a specific date")
    .replace(/(the customer[’']s?\s*)+/gi, (m) => (m.toLowerCase().includes("'") || m.includes("’") ? "the customer's " : "the customer "))
    .replace(/\s{2,}/g, " ")
    .trim();
  return t;
}

export async function anonymiseLesson(p: { customerId: string; outcome: "won" | "lost"; blocker: string; tactics: string; reason: string }) {
  const names = await identifyingNames(p.customerId);
  let out: z.infer<typeof AnonSchema>;
  try {
    out = await llmJson({
      schema: AnonSchema,
      temperature: 0.2,
      system:
        "You turn one closed B2B deal into a reusable, ANONYMISED negotiation lesson for a shared playbook. " +
        "Remove every company name, person name, product codename, exact amount, date, location and contract detail that could identify the customer. " +
        "Keep the transferable pattern: the type of blocker, what was tried, and why it worked or failed. Do not add facts that are not in the input.",
      user: [
        `Outcome: ${p.outcome.toUpperCase()}`,
        `Primary blocker (as recorded): ${p.blocker}`,
        `Tactics used (as recorded): ${p.tactics}`,
        `Why (as recorded): ${p.reason || "(not given)"}`,
        `Names that must not appear: ${names.join(", ") || "(none)"}`,
        ``,
        `Return JSON {blocker: generic blocker type, tactics: generic description of the tactics, why: generic explanation,`,
        `lesson: one sentence rule a rep on another account could follow, e.g. "Customers concerned about implementation complexity were more likely to accept multi-year contracts when offered phased implementation."}`,
      ].join("\n"),
    });
  } catch {
    // The LLM is unavailable: fall back to the deterministic scrub of what the rep wrote.
    out = { blocker: p.blocker, tactics: p.tactics, why: p.reason, lesson: "" };
  }
  return {
    blocker: scrub(out.blocker, names),
    tactics: scrub(out.tactics, names),
    why: scrub(out.why, names),
    lesson: scrub(out.lesson, names),
  };
}

/* ------------------------------------------------------------------ recording outcomes */

/**
 * Closing a deal teaches the system. The outcome is written twice:
 *  - into the customer's own bank (full detail, stays with the account)
 *  - into the shared playbook bank, anonymised (industry, size band, blocker, tactics, result)
 * so future negotiation briefs on *other* accounts can learn from it.
 */
export async function recordOutcome(p: { dealId: string; outcome: "won" | "lost"; primaryBlocker: string; tactics: string; reason: string }) {
  const db = await getDb();
  const [deal] = await db.query(
    `SELECT d.*, c.name AS customer_name, c.industry, c.employees FROM deals d JOIN customers c ON c.id=d.customer_id WHERE d.id=$1`,
    [p.dealId]
  );
  if (!deal) throw new HttpError(404, "Deal not found");
  if (!p.primaryBlocker.trim() || !p.tactics.trim()) throw new HttpError(400, "Blocker and tactics are required.");

  await db.query(
    `UPDATE deals SET status=$2, stage=$3, probability=$4, outcome_reason=$5, primary_blocker=$6, updated_at=now() WHERE id=$1`,
    [p.dealId, p.outcome, p.outcome === "won" ? "Closed Won" : "Closed Lost", p.outcome === "won" ? 100 : 0, p.reason, p.primaryBlocker]
  );

  const now = new Date().toISOString();
  const errors: string[] = [];
  try {
    await memory.ensureCustomerBank(deal.customer_id, deal.customer_name);
    await memory.retain(
      memory.customerBank(deal.customer_id),
      `Deal "${deal.name}" ($${Number(deal.amount).toLocaleString("en-US")}) was ${p.outcome.toUpperCase()} on ${isoDate(now)}. Primary blocker: ${p.primaryBlocker}. Tactics used: ${p.tactics}. Reason: ${p.reason}`,
      { context: `deal outcome — ${deal.customer_name}`, timestamp: now, documentId: `outcome-${deal.id}`, tags: ["kind:outcome"] }
    );
  } catch (e) {
    errors.push(errMsg(e));
  }

  const anon = await anonymiseLesson({ customerId: deal.customer_id, outcome: p.outcome, blocker: p.primaryBlocker, tactics: p.tactics, reason: p.reason });
  try {
    await recordPlaybookLesson({
      industry: deal.industry,
      employees: deal.employees,
      amount: Number(deal.amount),
      blocker: anon.blocker,
      tactics: anon.tactics,
      outcome: p.outcome,
      reason: anon.why,
      lesson: anon.lesson,
      when: now,
      docId: `lesson-${deal.id}`,
    });
  } catch (e) {
    errors.push(errMsg(e));
  }
  return { ok: errors.length === 0, errors, lesson: { ...anon, outcome: p.outcome, industry: deal.industry, size: sizeBand(deal.employees) } };
}

export async function recordPlaybookLesson(l: {
  industry: string;
  employees: number | null;
  amount: number;
  blocker: string;
  tactics: string;
  outcome: "won" | "lost";
  reason: string;
  lesson?: string;
  when: string;
  docId: string;
}) {
  await memory.ensurePlaybookBank();
  await memory.retain(
    memory.playbookBank,
    `Closed-${l.outcome} deal: ${l.industry} company, ${sizeBand(l.employees)}, deal value ${valueBand(l.amount)}. ` +
      `Primary blocker: ${l.blocker}. Tactics tried: ${l.tactics}. Outcome: ${l.outcome.toUpperCase()}. Why: ${l.reason}` +
      (l.lesson ? ` Lesson: ${l.lesson}` : ""),
    {
      context: "anonymised deal outcome lesson",
      timestamp: l.when,
      documentId: l.docId,
      tags: [`outcome:${l.outcome}`, `industry:${l.industry}`],
      metadata: {
        outcome: l.outcome,
        industry: l.industry,
        size: sizeBand(l.employees),
        value_band: valueBand(l.amount),
        blocker: l.blocker.slice(0, 300),
        tactics: l.tactics.slice(0, 600),
        why: l.reason.slice(0, 600),
        ...(l.lesson ? { lesson: l.lesson.slice(0, 400) } : {}),
      },
    }
  );
}

/* ------------------------------------------------------------------ reading the playbook */

const THEMES: { id: string; label: string; re: RegExp }[] = [
  { id: "timing", label: "Timing & budget cycles", re: /freeze|fiscal|timing|next year|budget cycle/i },
  { id: "security", label: "Security & compliance", re: /security|soc ?2|baa|hipaa|compliance|questionnaire|pen-?test/i },
  { id: "integration", label: "Integration", re: /integration|sap|sync|erp|api|workday|epic|connector/i },
  { id: "implementation", label: "Implementation confidence", re: /implementation|timeline|go-live|confidence|onboarding|rollout|complexity/i },
  { id: "competition", label: "Competition", re: /competit|incumbent|other vendor|rival/i },
  { id: "pricing", label: "Pricing & budget", re: /pric|budget|cost|discount|cap\b/i },
];
const themeOf = (blocker: string) => THEMES.find((t) => t.re.test(blocker)) ?? { id: "other", label: "Other blockers" };

function between(text: string, start: string, end: string | null) {
  const i = text.indexOf(start);
  if (i < 0) return "";
  const from = i + start.length;
  const j = end ? text.indexOf(end, from) : -1;
  return (j < 0 ? text.slice(from) : text.slice(from, j)).trim().replace(/\.$/, "");
}

/** A stored lesson document -> structured lesson. Uses metadata when present, the text otherwise. */
function parseLesson(d: { id: string; text: string; metadata: Record<string, string> | null; eventDate: string | null; tags: string[] }) {
  const m = d.metadata ?? {};
  const t = d.text;
  const outcome = (m.outcome ?? (t.startsWith("Closed-won") ? "won" : t.startsWith("Closed-lost") ? "lost" : t.match(/Outcome: (WON|LOST)/)?.[1]?.toLowerCase())) as "won" | "lost" | undefined;
  if (!outcome) return null;
  // Older lessons carried an exact ARR figure; show only a value band.
  const head = t
    .split(". Primary blocker:")[0]
    .replace(/^Closed-(won|lost) deal:\s*/, "")
    .replace(/~\$(\d+)k ARR/, (_m, k) => `deal value ${valueBand(Number(k) * 1000)}`);
  const blocker = m.blocker ?? between(t, "Primary blocker: ", ". Tactics tried: ");
  return {
    id: d.id,
    outcome,
    profile: head,
    industry: m.industry ?? d.tags.find((x) => x.startsWith("industry:"))?.slice(9) ?? null,
    blocker,
    theme: (({ id, label }) => ({ id, label }))(themeOf(blocker)),
    tactics: m.tactics ?? between(t, "Tactics tried: ", ". Outcome: "),
    why: m.why ?? between(t, "Why: ", " Lesson: "),
    lesson: m.lesson ?? (t.includes(" Lesson: ") ? between(t, " Lesson: ", null) : null),
    recordedAt: d.eventDate,
  };
}

export async function getPlaybook() {
  await memory.ensurePlaybookBank();
  const [docs, models, observations] = await Promise.all([
    memory.listDocuments(memory.playbookBank, { limit: 200, withText: true }),
    memory.listMentalModels(memory.playbookBank).catch(() => []),
    memory.list(memory.playbookBank, { limit: 100, type: "observation" }).catch(() => ({ items: [] as MemoryHit[], total: 0 })),
  ]);
  const lessons = docs.map(parseLesson).filter((l): l is NonNullable<ReturnType<typeof parseLesson>> => !!l);
  lessons.sort((a, b) => (b.recordedAt ?? "").localeCompare(a.recordedAt ?? ""));

  const patterns = [...new Set(lessons.map((l) => l.theme.id))].map((id) => {
    const group = lessons.filter((l) => l.theme.id === id);
    const won = group.filter((l) => l.outcome === "won");
    const lost = group.filter((l) => l.outcome === "lost");
    const n = group.length;
    return {
      id,
      label: group[0].theme.label,
      outcomes: n,
      won: won.length,
      lost: lost.length,
      confidence: n >= 3 ? "strong" : n === 2 ? "moderate" : "limited",
      winning: won.map((l) => ({ id: l.id, tactics: l.tactics, why: l.why, lesson: l.lesson })),
      losing: lost.map((l) => ({ id: l.id, tactics: l.tactics, why: l.why, lesson: l.lesson })),
    };
  });
  patterns.sort((a, b) => b.outcomes - a.outcomes);

  return {
    bank: memory.playbookBank,
    mentalModel: models.find((m) => m.id === PLAYBOOK_MODEL_ID) ?? null,
    lessons,
    patterns,
    observations: observations.items,
  };
}

/* ------------------------------------------------------------------ drafting an outcome from memory */

const DraftSchema = z.object({
  primary_blocker: z.string(),
  tactics: z.string(),
  reason: z.string(),
  evidence: z.array(z.string()).default([]),
});

/** Suggest blocker, tactics and reason for a deal being closed, from that account's own memory. */
export async function outcomeDraft(dealId: string, outcome: "won" | "lost") {
  const db = await getDb();
  const [deal] = await db.query(`SELECT d.*, c.name AS customer_name FROM deals d JOIN customers c ON c.id=d.customer_id WHERE d.id=$1`, [dealId]);
  if (!deal) throw new HttpError(404, "Deal not found");
  const bank = memory.customerBank(deal.customer_id);
  const angles = ["what is blocking the deal and what the customer is worried about", "offers, discounts and tactics we used and how the customer responded"];
  const hits = (await Promise.all(angles.map((q) => memory.recall(bank, `${deal.customer_name}: ${q}`, { maxTokens: 1200 }).catch(() => [] as MemoryHit[])))).flat();
  const seen = new Set<string>();
  const mems = hits.filter((h) => !seen.has(h.id) && seen.add(h.id)).slice(0, 14);
  if (!mems.length) return { draft: null, evidence: [], message: "No memories for this account yet, so fill the outcome in by hand." };
  const refs = mems.map((m, i) => ({ ref: `M${i + 1}`, m }));
  const draft = await llmJson({
    schema: DraftSchema,
    temperature: 0.2,
    system: "You summarise a B2B deal's history into a closing record. Use only the memories given. Be concise and concrete.",
    user: [
      `Deal: ${deal.name}, being closed as ${outcome.toUpperCase()}. Recorded blocker so far: ${deal.primary_blocker ?? "unknown"}.`,
      `MEMORIES:`,
      ...refs.map(({ ref, m }) => `[${ref}] ${m.text}`),
      `Return JSON {primary_blocker (short phrase), tactics (what our team tried, comma-separated), reason (one or two sentences on why it was ${outcome}, only if the memories support it, else ""), evidence: [refs used]}.`,
    ].join("\n"),
  });
  const used = new Set(draft.evidence);
  return { draft, evidence: refs.filter(({ ref }) => used.has(ref)).map(({ ref, m }) => ({ ref, ...m })), message: null };
}

export async function ensurePlaybookModel() {
  await memory.ensurePlaybookBank();
  await memory.ensureMentalModel(memory.playbookBank, PLAYBOOK_MODEL_ID, "What wins, by blocker", PLAYBOOK_MODEL_QUERY);
}

export async function refreshPlaybookModel() {
  await ensurePlaybookModel();
  await memory.refreshMentalModel(memory.playbookBank, PLAYBOOK_MODEL_ID);
}
