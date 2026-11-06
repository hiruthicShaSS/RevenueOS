import { getDb } from "../db.js";
import { isoDate } from "../util.js";

/**
 * Overview metrics. Insights here are deterministic rules over CRM + extracted
 * memory signals (cheap, instant). Deep reasoning happens in the negotiator.
 */
export async function overview() {
  const db = await getDb();
  const today = isoDate(new Date());
  const in7 = isoDate(new Date(Date.now() + 7 * 864e5));

  const deals = await db.query(
    `SELECT d.*, c.name AS customer, c.id AS customer_id, r.name AS owner,
       (SELECT max(occurred_at) FROM interactions i WHERE i.customer_id=c.id) AS last_touch,
       (SELECT count(*)::int FROM objections o WHERE o.customer_id=c.id AND o.status='open') AS open_objections,
       (SELECT count(*)::int FROM offers f WHERE f.customer_id=c.id AND f.response='rejected') AS rejected_offers,
       (SELECT count(*)::int FROM offers f WHERE f.customer_id=c.id AND f.response='rejected' AND f.discount_pct IS NOT NULL) AS rejected_discounts,
       (SELECT count(*)::int FROM objections o WHERE o.customer_id=c.id AND o.status='open' AND o.category<>'pricing') AS non_price_objections,
       (SELECT count(*)::int FROM commitments cm WHERE cm.customer_id=c.id AND cm.status='open' AND cm.due_date < $1::date) AS overdue_commitments
     FROM deals d JOIN customers c ON c.id=d.customer_id LEFT JOIN reps r ON r.id=d.owner_id`,
    [today]
  );
  const open = deals.filter((d: any) => d.status === "open");
  const amount = (d: any) => Number(d.amount);
  const pipeline = open.reduce((s: number, d: any) => s + amount(d), 0);
  const expected = open.reduce((s: number, d: any) => s + (amount(d) * d.probability) / 100, 0);
  const atRisk = open.filter((d: any) => d.risk === "high" || d.overdue_commitments > 0);
  const staleCutoff = Date.now() - 14 * 864e5;
  const awaitingFollowUp = open.filter((d: any) => !d.last_touch || new Date(d.last_touch).getTime() < staleCutoff || d.overdue_commitments > 0);
  const objectionExposure = open.filter((d: any) => d.open_objections > 0).reduce((s: number, d: any) => s + amount(d), 0);

  const commitments = await db.query(
    `SELECT cm.*, c.name AS customer FROM commitments cm JOIN customers c ON c.id=cm.customer_id
     WHERE cm.status='open' ORDER BY cm.due_date NULLS LAST`
  );
  for (const c of commitments) c.due_date = c.due_date ? isoDate(c.due_date) : null;
  const overdue = commitments.filter((c: any) => c.due_date && c.due_date < today);
  const upcoming = commitments.filter((c: any) => c.due_date && c.due_date >= today && c.due_date <= in7);

  const stages = ["Discovery", "Qualification", "Proposal", "Negotiation", "Closed Won", "Closed Lost"];
  const byStage = stages.map((s) => ({
    stage: s,
    amount: deals.filter((d: any) => d.stage === s).reduce((t: number, d: any) => t + amount(d), 0),
    count: deals.filter((d: any) => d.stage === s).length,
  }));

  const weeks = await db.query(
    `SELECT date_trunc('week', occurred_at) AS wk, count(*)::int AS n FROM interactions
     WHERE occurred_at > now() - interval '10 weeks' GROUP BY 1 ORDER BY 1`
  );
  const engagement = weeks.map((w: any) => ({ week: isoDate(w.wk), interactions: w.n }));

  const insights: { severity: "high" | "medium" | "info"; title: string; detail: string; customerId?: string }[] = [];
  for (const d of open) {
    if (d.rejected_discounts > 0 && d.non_price_objections > 0) {
      insights.push({
        severity: "high",
        title: `${d.customer}: discounting isn't working`,
        detail: `${d.rejected_discounts} discount offer(s) rejected while ${d.non_price_objections} non-pricing objection(s) remain open. Price is likely not the real blocker.`,
        customerId: d.customer_id,
      });
    }
    if (d.overdue_commitments > 0) {
      insights.push({
        severity: "high",
        title: `${d.customer}: ${d.overdue_commitments} promise(s) overdue`,
        detail: `$${Math.round(amount(d) / 1000)}k deal in ${d.stage}. An unkept promise during negotiation erodes trust fastest.`,
        customerId: d.customer_id,
      });
    }
    if (d.last_touch && new Date(d.last_touch).getTime() < staleCutoff && d.probability >= 40) {
      const days = Math.round((Date.now() - new Date(d.last_touch).getTime()) / 864e5);
      insights.push({
        severity: "medium",
        title: `${d.customer}: ${days} days of silence`,
        detail: `${d.stage} stage at ${d.probability}% with no logged touch since ${isoDate(d.last_touch)}.`,
        customerId: d.customer_id,
      });
    }
  }
  insights.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : b.severity === "high" ? 1 : a.severity === "medium" ? -1 : 1));

  // Recent activity: what the team logged lately, across accounts.
  const recent = await db.query(
    `SELECT i.id, i.kind, i.occurred_at, i.customer_id, c.name AS customer, r.name AS rep, r.title AS rep_title,
       i.analysis->>'summary' AS summary, i.analysis->'source'->>'fileName' AS file
     FROM interactions i JOIN customers c ON c.id=i.customer_id LEFT JOIN reps r ON r.id=i.rep_id
     ORDER BY i.occurred_at DESC LIMIT 8`
  );
  const recentActivity = recent.map((r: any) => ({
    id: r.id,
    kind: r.kind,
    occurredAt: new Date(r.occurred_at).toISOString(),
    customerId: r.customer_id,
    customer: r.customer,
    rep: r.rep,
    repTitle: r.rep_title,
    summary: r.summary ?? null,
    file: r.file ?? null,
  }));

  // Account activity: interactions per account over 30 days, with the open deal's state.
  const activity = await db.query(
    `SELECT c.id, c.name,
       (SELECT count(*)::int FROM interactions i WHERE i.customer_id=c.id AND i.occurred_at > now() - interval '30 days') AS last30,
       (SELECT max(occurred_at) FROM interactions i WHERE i.customer_id=c.id) AS last_touch,
       (SELECT risk FROM deals d WHERE d.customer_id=c.id AND d.status='open' ORDER BY amount DESC LIMIT 1) AS risk,
       (SELECT amount FROM deals d WHERE d.customer_id=c.id AND d.status='open' ORDER BY amount DESC LIMIT 1) AS amount
     FROM customers c ORDER BY last30 DESC, last_touch DESC NULLS LAST`
  );
  const accountActivity = activity
    .filter((a: any) => a.amount !== null)
    .map((a: any) => ({
      customerId: a.id,
      customer: a.name,
      last30: a.last30,
      lastTouch: a.last_touch ? new Date(a.last_touch).toISOString() : null,
      risk: a.risk,
      amount: Number(a.amount),
    }));

  return {
    recentActivity,
    accountActivity,
    metrics: {
      pipeline,
      expected,
      openDeals: open.length,
      atRiskCount: atRisk.length,
      atRiskAmount: atRisk.reduce((s: number, d: any) => s + amount(d), 0),
      awaitingFollowUp: awaitingFollowUp.length,
      objectionExposure,
      overdueCommitments: overdue.length,
      upcomingCommitments: upcoming.length,
      wonAmount: deals.filter((d: any) => d.status === "won").reduce((s: number, d: any) => s + amount(d), 0),
    },
    byStage,
    engagement,
    insights: insights.slice(0, 8),
    atRisk: atRisk.map(pickDeal),
    upcoming,
    overdue,
    deals: deals.map(pickDeal),
  };
}

function pickDeal(d: any) {
  return {
    id: d.id,
    name: d.name,
    customer: d.customer,
    customerId: d.customer_id,
    amount: Number(d.amount),
    stage: d.stage,
    probability: d.probability,
    closeDate: d.close_date ? isoDate(d.close_date) : null,
    status: d.status,
    risk: d.risk,
    owner: d.owner,
    primaryBlocker: d.primary_blocker,
    lastTouch: d.last_touch ? new Date(d.last_touch).toISOString() : null,
    overdueCommitments: d.overdue_commitments,
  };
}
