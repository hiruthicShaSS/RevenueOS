import { getDb } from "../db.js";
import { HttpError, isoDate } from "../util.js";

/** Read helpers over the structured (Postgres) side of the system. */

export async function getCustomer(customerId: string) {
  const db = await getDb();
  const [c] = await db.query(`SELECT * FROM customers WHERE id=$1`, [customerId]);
  if (!c) throw new HttpError(404, `Customer ${customerId} not found`);
  return c;
}

export async function getAccountSnapshot(customerId: string, asOf = new Date()) {
  const db = await getDb();
  const customer = await getCustomer(customerId);
  const [deals, stakeholders, commitments, objections, offers, interactions] = await Promise.all([
    db.query(
      `SELECT d.*, r.name AS owner_name FROM deals d LEFT JOIN reps r ON r.id=d.owner_id
       WHERE customer_id=$1 ORDER BY status='open' DESC, amount DESC`,
      [customerId]
    ),
    db.query(`SELECT * FROM stakeholders WHERE customer_id=$1 ORDER BY name`, [customerId]),
    db.query(`SELECT * FROM commitments WHERE customer_id=$1 ORDER BY status='open' DESC, due_date NULLS LAST`, [customerId]),
    db.query(`SELECT * FROM objections WHERE customer_id=$1 ORDER BY created_at`, [customerId]),
    db.query(`SELECT * FROM offers WHERE customer_id=$1 ORDER BY created_at`, [customerId]),
    db.query(
      `SELECT i.id, i.kind, i.occurred_at, i.raw_text, i.analysis, i.memory_status, i.memory_error, r.name AS rep_name, r.title AS rep_title
       FROM interactions i LEFT JOIN reps r ON r.id=i.rep_id
       WHERE customer_id=$1 ORDER BY occurred_at DESC`,
      [customerId]
    ),
  ]);
  const today = isoDate(asOf);
  for (const c of commitments) {
    c.due_date = c.due_date ? isoDate(c.due_date) : null;
    c.overdue = c.status === "open" && !!c.due_date && c.due_date < today;
  }
  return { customer, deals, stakeholders, commitments, objections, offers, interactions };
}

/** Compact text form of the structured snapshot, used as LLM / reflect context. */
export function snapshotToText(s: Awaited<ReturnType<typeof getAccountSnapshot>>) {
  const deal = s.deals.find((d: any) => d.status === "open") ?? s.deals[0];
  const lines = [
    `Account: ${s.customer.name} (${s.customer.industry}, ~${s.customer.employees} employees, ${s.customer.hq})`,
    deal
      ? `Open deal: ${deal.name}, $${Number(deal.amount).toLocaleString("en-US")} ARR, stage ${deal.stage}, owner ${deal.owner_name}`
      : "No open deal.",
    `Stakeholders: ${s.stakeholders.map((x: any) => `${x.name} (${x.role ?? "?"}, ${x.stance ?? "unknown"})`).join("; ") || "none recorded"}`,
    `Commitments tracked in CRM:`,
    ...s.commitments.map(
      (c: any) =>
        `  [C:${c.id}] ${c.owner} -> ${c.promised_to ?? "customer"}: ${c.description} | due ${c.due_date ?? "n/a"} | ${c.status}${c.overdue ? " (OVERDUE)" : ""}`
    ),
    `Offers: ${s.offers.map((o: any) => `${o.description} -> ${o.response}`).join("; ") || "none"}`,
  ];
  return lines.join("\n");
}
