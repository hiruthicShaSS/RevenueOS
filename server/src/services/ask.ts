import { z } from "zod";
import { getDb } from "../db.js";
import { llmJson } from "../llm.js";
import { memory } from "../memory/index.js";
import { errMsg, isQuotaError } from "../memory/hindsightStore.js";
import { HttpError, isoDate } from "../util.js";
import { getAccountSnapshot, snapshotToText } from "./repo.js";

async function detectCustomer(question: string): Promise<any | null> {
  const db = await getDb();
  const customers = await db.query(`SELECT id, name FROM customers`);
  const q = question.toLowerCase();
  return (
    customers.find((c: any) => q.includes(c.name.toLowerCase())) ??
    customers.find((c: any) => {
      const first = c.name.split(/\s+/)[0].toLowerCase();
      return first.length > 3 && new RegExp(`\\b${first}\\b`).test(q);
    }) ??
    null
  );
}

/**
 * Ask RevenueOS.
 *  - Account questions -> Hindsight `reflect` on that customer's bank only
 *    (agentic retrieval + cited answer, so memories never cross accounts).
 *  - Portfolio questions -> structured CRM data across accounts + playbook memory.
 *  - compare=true also returns what a stateless LLM would say, for before/after.
 */
export async function ask(question: string, customerId?: string | null, compare = false) {
  const q = question.trim();
  if (q.length < 3) throw new HttpError(400, "Ask a question.");
  const customer = customerId ? { id: customerId } : await detectCustomer(q);

  const baselineP = compare ? baseline(q) : Promise.resolve(null);

  if (customer) {
    const snapshot = await getAccountSnapshot(customer.id);
    await memory.ensureCustomerBank(snapshot.customer.id, snapshot.customer.name);
    const started = Date.now();
    try {
      const r = await memory.reflect(memory.customerBank(snapshot.customer.id), q, {
        budget: "mid",
        context:
          `The question is from an account executive at our company about the ${snapshot.customer.name} account. ` +
          `Today is ${isoDate(new Date())}. Live CRM state (authoritative for commitment status):\n${snapshotToText(snapshot)}\n` +
          `Answer concisely in markdown: a direct answer first that names the single primary blocker (the one the evidence shows, which may differ from the stated objection), then the supporting history with dates and who said it, then recommended next steps. ` +
          `If our team promised something that is still open, call it out.`,
      });
      return {
        scope: "account" as const,
        customer: snapshot.customer,
        answer: r.text,
        evidence: r.evidence,
        engine: memory.mode === "hindsight" ? "Hindsight reflect" : "mock",
        ms: Date.now() - started,
        baseline: await baselineP,
      };
    } catch (e) {
      if (!isQuotaError(e)) throw new HttpError(502, `Memory reflect failed: ${errMsg(e)}`);
      // Hindsight's own LLM is rate-limited. Recall (no LLM needed) still works, so answer
      // from recalled memories with the app's model instead of failing.
      return {
        ...(await answerFromRecall(snapshot, q, started)),
        baseline: await baselineP,
      };
    }
  }

  // Portfolio-level question.
  const db = await getDb();
  const started = Date.now();
  const deals = await db.query(
    `SELECT d.id, d.name, d.amount, d.stage, d.probability, d.close_date, d.status, d.risk, d.primary_blocker,
            c.name AS customer, c.id AS customer_id, r.name AS owner,
            (SELECT max(occurred_at) FROM interactions i WHERE i.customer_id=c.id) AS last_touch
     FROM deals d JOIN customers c ON c.id=d.customer_id LEFT JOIN reps r ON r.id=d.owner_id`
  );
  const commitments = await db.query(
    `SELECT cm.*, c.name AS customer FROM commitments cm JOIN customers c ON c.id=cm.customer_id WHERE cm.status='open'`
  );
  const objections = await db.query(
    `SELECT o.category, o.description, o.raised_by, c.name AS customer FROM objections o JOIN customers c ON c.id=o.customer_id WHERE o.status='open'`
  );
  const offers = await db.query(
    `SELECT f.description, f.discount_pct, f.response, c.name AS customer FROM offers f JOIN customers c ON c.id=f.customer_id`
  );
  let playbook: any[] = [];
  try {
    await memory.ensurePlaybookBank();
    playbook = (await memory.recall(memory.playbookBank, q, { maxTokens: 1000 })).slice(0, 6);
  } catch {
    /* playbook is optional context */
  }
  const today = isoDate(new Date());
  const data = [
    `Today: ${today}`,
    `DEALS:`,
    ...deals.map(
      (d: any) =>
        `- ${d.customer} | ${d.name} | $${Number(d.amount).toLocaleString()} | ${d.stage} ${d.probability}% | close ${d.close_date ? isoDate(d.close_date) : "n/a"} | ${d.status} | risk ${d.risk} | blocker: ${d.primary_blocker ?? "-"} | owner ${d.owner} | last touch ${d.last_touch ? isoDate(d.last_touch) : "never"}`
    ),
    `OPEN COMMITMENTS:`,
    ...commitments.map(
      (c: any) => `- ${c.customer}: ${c.owner} promised ${c.promised_to ?? "customer"} "${c.description}" due ${c.due_date ? isoDate(c.due_date) : "n/a"}${c.due_date && isoDate(c.due_date) < today ? " OVERDUE" : ""}`
    ),
    `OPEN OBJECTIONS:`,
    ...objections.map((o: any) => `- ${o.customer}: [${o.category}] ${o.description} (${o.raised_by ?? "?"})`),
    `OFFERS:`,
    ...offers.map((o: any) => `- ${o.customer}: ${o.description} -> ${o.response}`),
    `CROSS-DEAL PLAYBOOK MEMORY:`,
    ...playbook.map((p, i) => `[P${i + 1}] ${p.text}`),
  ].join("\n");

  const out = await llmJson({
    schema: z.object({ answer: z.string(), accounts: z.array(z.string()).default([]) }),
    system:
      "You are RevenueOS, a sales intelligence assistant. Answer portfolio questions from the data provided only. " +
      "Be concrete: name accounts, amounts, dates and owners. Answer in markdown with a direct answer first.",
    user: `${data}\n\nQUESTION: ${q}\n\nReturn JSON {answer: markdown string, accounts: [account names you relied on]}.`,
  });
  return {
    scope: "portfolio" as const,
    customer: null,
    answer: out.answer,
    accounts: out.accounts,
    evidence: playbook,
    engine: "CRM data + Hindsight playbook recall",
    ms: Date.now() - started,
    baseline: await baselineP,
  };
}

async function answerFromRecall(snapshot: Awaited<ReturnType<typeof getAccountSnapshot>>, q: string, started: number) {
  const bank = memory.customerBank(snapshot.customer.id);
  const hits = (await memory.recall(bank, q, { maxTokens: 3000 })).slice(0, 20);
  const out = await llmJson({
    schema: z.object({ answer: z.string() }),
    system:
      "You advise a B2B account executive. Answer only from the remembered facts and CRM state given. " +
      "Cite who said what and when. Distinguish stated objections from the real blocker. Call out open promises our team made.",
    user: [
      `Today is ${isoDate(new Date())}.`,
      `CRM STATE:\n${snapshotToText(snapshot)}`,
      `REMEMBERED (Hindsight recall, most relevant first):`,
      ...hits.map((h) => `- (${h.occurredAt?.slice(0, 10) ?? "undated"}) ${h.text}`),
      ``,
      `QUESTION: ${q}`,
      `Return JSON {answer: markdown — direct answer first, then supporting history, then numbered next steps}.`,
    ].join("\n"),
  });
  return {
    scope: "account" as const,
    customer: snapshot.customer,
    answer: out.answer,
    evidence: hits,
    engine: "Hindsight recall + LLM",
    ms: Date.now() - started,
  };
}

/** What a stateless assistant says to the same question: the "before" in before/after. */
async function baseline(question: string) {
  try {
    const r = await llmJson({
      schema: z.object({ answer: z.string() }),
      system:
        "You are a generic AI sales assistant with no access to CRM data, notes or memory of past conversations. Answer helpfully in markdown, briefly.",
      user: `${question}\n\nReturn JSON {answer}.`,
      temperature: 0.4,
    });
    return r.answer;
  } catch (e) {
    return `(baseline unavailable: ${e instanceof Error ? e.message : String(e)})`;
  }
}
