import { getDb } from "../db.js";
import { memory } from "../memory/index.js";
import type { GraphNode } from "../memory/types.js";
import { getAccountSnapshot } from "./repo.js";

/**
 * The Memory Explorer's knowledge map for ONE customer. Everything comes from that customer's
 * Hindsight bank (bank-per-customer isolation), joined with the same customer's CRM rows.
 *
 * Recorded vs derived:
 *  - memories and the links between them (semantic, temporal, entity, causal) are recorded by Hindsight
 *  - the category a memory is grouped under is derived here from its text, tags and entities
 */

export const CATEGORIES = [
  { id: "profile", label: "Customer Profile" },
  { id: "people", label: "People & Stakeholders" },
  { id: "conversations", label: "Conversations" },
  { id: "negotiation", label: "Negotiations & Pricing" },
  { id: "objections", label: "Objections & Requirements" },
  { id: "commitments", label: "Promises & Commitments" },
  { id: "deals", label: "Deal History" },
  { id: "preferences", label: "Preferences" },
  { id: "decisions", label: "Decisions & Outcomes" },
] as const;
export type CategoryId = (typeof CATEGORIES)[number]["id"];

const RULES: [CategoryId, RegExp][] = [
  ["decisions", /\b(won|lost|closed[- ]?(won|lost)|decided|decision|approved|signed|chose|selected|rejected the|went with|outcome)\b/i],
  ["commitments", /\b(promis\w*|commit\w*|will (send|deliver|share|provide|follow)|deliver\w*|deadline|due (by|on)|by (monday|tuesday|wednesday|thursday|friday|eod|end of)|fulfil\w*|follow[- ]up)\b/i],
  ["negotiation", /(\$\s?\d|\d+\s?%|\b(discount|pric\w*|budget|cost|quote|license|renewal|term|arr|payment|invoice|procurement|po)\b)/i],
  ["objections", /\b(concern\w*|worr\w*|objection\w*|risk\w*|requir\w*|must|blocker|block\w*|security|integration|complian\w*|questionnaire|soc ?2|baa|hipaa|sync|implementation|go-live|timeline)\b/i],
  ["preferences", /\b(prefer\w*|likes?|wants?|interested in|priorit\w*|values?|cares? about|would rather)\b/i],
  ["deals", /\b(deal|stage|proposal|pipeline|opportunit\w*|contract|evaluat\w*|pilot|trial|demo)\b/i],
  ["people", /\b(ceo|cfo|cto|coo|ciso|vp|vice president|director|manager|head of|lead|champion|sponsor|engineer|joined|role)\b/i],
  ["profile", /\b(company|facilities|employees|headquarter\w*|locations?|hospitals?|plants?|branches|sites|uses|runs|operates|industry|based in)\b/i],
];

function categorize(m: GraphNode): CategoryId {
  if (m.tags.includes("kind:outcome")) return "decisions";
  if (m.tags.includes("kind:commitment")) return "commitments";
  for (const [cat, re] of RULES) if (re.test(m.text)) return cat;
  return "conversations";
}

const tag = (m: { tags: string[] }, p: string) => m.tags.find((t) => t.startsWith(p))?.slice(p.length) ?? null;

export async function memoryMap(customerId: string) {
  const snapshot = await getAccountSnapshot(customerId);
  const bank = memory.customerBank(customerId);
  const db = await getDb();
  const [graph, interactions] = await Promise.all([
    memory.graph(bank, { limit: 800 }),
    db.query<any>(
      `SELECT i.id, i.kind, i.occurred_at, i.analysis->'source' AS source, i.analysis->>'summary' AS summary, r.name AS rep_name, r.title AS rep_title
       FROM interactions i LEFT JOIN reps r ON r.id=i.rep_id WHERE i.customer_id=$1`,
      [customerId]
    ),
  ]);
  const byInteraction = new Map(interactions.map((i) => [i.id, i]));
  const stakeholders = snapshot.stakeholders.map((s: any) => s.name as string);

  // A stakeholder is attached when the memory's own text names them (full or first name). Hindsight's
  // entity list is not used for this: it carries every person mentioned in the source passage.
  const people = (m: GraphNode) =>
    stakeholders.filter((name) => {
      const first = name.split(/\s+/)[0];
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b(${esc(name)}|${esc(first)})\\b`).test(m.text);
    });

  const nodes = graph.nodes.map((m) => {
    const ix = m.documentId ? byInteraction.get(m.documentId) : undefined;
    const file = tag(m, "file:") ?? ix?.source?.fileName ?? null;
    return {
      id: m.id,
      text: m.text,
      type: m.type,
      occurredAt: m.occurredAt,
      category: categorize(m),
      stakeholders: people(m),
      entities: m.entities,
      tags: m.tags,
      proofCount: m.proofCount,
      source: {
        interactionId: ix?.id ?? null,
        kind: (ix?.kind ?? tag(m, "kind:")) as string | null,
        rep: ix?.rep_name ?? tag(m, "rep:"),
        repTitle: ix?.rep_title ?? null,
        date: ix?.occurred_at ?? null,
        summary: ix?.summary ?? null,
        file,
        pages: ix?.source?.pages ?? null,
        context: m.context,
      },
    };
  });

  const lastUpdated = nodes.reduce<string | null>((max, n) => (n.occurredAt && (!max || n.occurredAt > max) ? n.occurredAt : max), null);

  return {
    customer: { id: snapshot.customer.id, name: snapshot.customer.name, industry: snapshot.customer.industry, hq: snapshot.customer.hq },
    bank,
    total: graph.total,
    lastUpdated,
    categories: CATEGORIES.map((c) => ({ ...c, count: nodes.filter((n) => n.category === c.id).length })),
    nodes,
    links: graph.links,
    stakeholders: snapshot.stakeholders,
    commitments: snapshot.commitments,
    deals: snapshot.deals.map((d: any) => ({ id: d.id, name: d.name, stage: d.stage, status: d.status, amount: Number(d.amount) })),
    interactions: interactions.map((i) => ({ id: i.id, kind: i.kind, occurred_at: i.occurred_at, rep: i.rep_name, file: i.source?.fileName ?? null })),
  };
}
