import { getDb } from "../db.js";
import { memory } from "../memory/index.js";
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

/**
 * Closing a deal teaches the system. The outcome is written twice:
 *  - into the customer's own bank (full detail, stays with the account)
 *  - into the shared playbook bank, anonymised (industry, size, blocker, tactics, result)
 * so future negotiation briefs on *other* accounts can learn from it.
 */
export async function recordOutcome(p: {
  dealId: string;
  outcome: "won" | "lost";
  primaryBlocker: string;
  tactics: string;
  reason: string;
}) {
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
  try {
    await recordPlaybookLesson({
      industry: deal.industry,
      employees: deal.employees,
      amount: Number(deal.amount),
      blocker: p.primaryBlocker,
      tactics: p.tactics,
      outcome: p.outcome,
      reason: p.reason,
      when: now,
      docId: `lesson-${deal.id}`,
    });
  } catch (e) {
    errors.push(errMsg(e));
  }
  return { ok: errors.length === 0, errors };
}

export async function recordPlaybookLesson(l: {
  industry: string;
  employees: number | null;
  amount: number;
  blocker: string;
  tactics: string;
  outcome: "won" | "lost";
  reason: string;
  when: string;
  docId: string;
}) {
  await memory.ensurePlaybookBank();
  await memory.retain(
    memory.playbookBank,
    `Closed-${l.outcome} deal: ${l.industry} company, ${sizeBand(l.employees)}, ~$${Math.round(l.amount / 1000)}k ARR. ` +
      `Primary blocker: ${l.blocker}. Tactics tried: ${l.tactics}. Outcome: ${l.outcome.toUpperCase()}. Why: ${l.reason}`,
    {
      context: "anonymised deal outcome lesson",
      timestamp: l.when,
      documentId: l.docId,
      tags: [`outcome:${l.outcome}`, `industry:${l.industry}`],
    }
  );
}

export async function getPlaybook() {
  await memory.ensurePlaybookBank();
  const [memories, models] = await Promise.all([
    memory.list(memory.playbookBank, { limit: 200 }),
    memory.listMentalModels(memory.playbookBank).catch(() => []),
  ]);
  return {
    bank: memory.playbookBank,
    mentalModel: models.find((m) => m.id === PLAYBOOK_MODEL_ID) ?? null,
    memories: memories.items,
    total: memories.total,
  };
}

export async function ensurePlaybookModel() {
  await memory.ensurePlaybookBank();
  await memory.ensureMentalModel(memory.playbookBank, PLAYBOOK_MODEL_ID, "What wins, by blocker", PLAYBOOK_MODEL_QUERY);
}

export async function refreshPlaybookModel() {
  await ensurePlaybookModel();
  await memory.refreshMentalModel(memory.playbookBank, PLAYBOOK_MODEL_ID);
}

