import { z } from "zod";
import { llmJson } from "../llm.js";
import { memory, type MemoryHit } from "../memory/index.js";
import { errMsg } from "../memory/hindsightStore.js";
import { getAccountSnapshot, snapshotToText } from "./repo.js";

const Ev = z.array(z.string()).default([]);
const BriefSchema = z.object({
  headline: z.string(),
  stated_blocker: z.string().nullable().optional(),
  real_blocker: z.string(),
  verdict: z.enum(["hold", "proceed", "adjust"]).catch("adjust"),
  proposal_assessment: z.string().nullable().optional(),
  do_not: z.array(z.object({ action: z.string(), why: z.string(), evidence: Ev })).default([]),
  strategy: z.array(z.object({ step: z.string(), why: z.string(), evidence: Ev })).default([]),
  risks: z
    .array(z.object({ risk: z.string(), severity: z.enum(["low", "medium", "high"]).catch("medium"), evidence: Ev }))
    .default([]),
  stakeholder_plan: z.array(z.object({ name: z.string(), approach: z.string(), evidence: Ev })).default([]),
  playbook_insight: z
    .object({ text: z.string(), evidence: Ev })
    .nullable()
    .optional(),
  confidence: z.enum(["low", "medium", "high"]).catch("medium"),
});

const RECALL_ANGLES = [
  "pricing, discounts offered and how the customer responded",
  "objections and concerns raised by each stakeholder",
  "technical requirements, integrations and implementation timeline expectations",
  "promises and commitments our team made and whether they were delivered",
];

/**
 * Builds a negotiation brief: multi-angle Hindsight recall on the customer's
 * bank + cross-deal recall on the playbook bank + CRM commitments, then an LLM
 * that must cite memory refs for every recommendation.
 */
export async function negotiationBrief(customerId: string, proposal?: string) {
  const snapshot = await getAccountSnapshot(customerId);
  const bank = memory.customerBank(customerId);
  await memory.ensureCustomerBank(customerId, snapshot.customer.name);

  const queries = proposal?.trim() ? [proposal.trim(), ...RECALL_ANGLES] : RECALL_ANGLES;
  const errors: string[] = [];
  const results = await Promise.all(
    queries.map((q) =>
      memory.recall(bank, `${snapshot.customer.name}: ${q}`, { maxTokens: 1500 }).catch((e) => {
        errors.push(errMsg(e));
        return [] as MemoryHit[];
      })
    )
  );
  const merged = new Map<string, MemoryHit>();
  results.flat().forEach((h) => {
    const prev = merged.get(h.id);
    if (!prev || (h.score ?? 0) > (prev.score ?? 0)) merged.set(h.id, h);
  });
  const seen = new Set<string>();
  const accountMem = [...merged.values()]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .filter((m) => {
      const key = m.text.split("|")[0].toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 24);

  const openDeal = snapshot.deals.find((d: any) => d.status === "open");
  let playbookMem: MemoryHit[] = [];
  try {
    await memory.ensurePlaybookBank();
    playbookMem = (
      await memory.recall(
        memory.playbookBank,
        `${snapshot.customer.industry} deal where the blocker was ${openDeal?.primary_blocker ?? "pricing vs implementation risk"}: which tactics won and which lost`,
        { maxTokens: 1200 }
      )
    ).slice(0, 8);
  } catch (e) {
    errors.push(errMsg(e));
  }

  const aRefs = accountMem.map((m, i) => ({ ref: `M${i + 1}`, m }));
  const pRefs = playbookMem.map((m, i) => ({ ref: `P${i + 1}`, m }));
  const cRefs = snapshot.commitments.map((c: any, i: number) => ({ ref: `C${i + 1}`, c }));

  if (!aRefs.length && !snapshot.interactions.length) {
    return {
      empty: true,
      message: `No interactions remembered for ${snapshot.customer.name} yet. Log a meeting or call first.`,
      evidence: {},
      errors,
    };
  }

  const brief = await llmJson({
    schema: BriefSchema,
    temperature: 0.3,
    system:
      "You are a senior enterprise sales negotiator coaching an account executive. You only reason from the evidence given. " +
      "Every recommendation, risk and 'do not' MUST cite evidence refs (M# account memories, C# CRM commitments, P# cross-deal playbook). " +
      "Separate the blocker the customer states from the one the evidence shows. If a discount was already rejected, say whether pricing is really the issue. " +
      "Flag unfulfilled promises our team made. Be direct and specific; name stakeholders.",
    user: [
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
      proposal?.trim() ? `The rep is considering this next move: "${proposal.trim()}". Assess it explicitly in proposal_assessment.` : `The rep wants to know how to move this deal forward.`,
      ``,
      `CRM STATE:`,
      snapshotToText(snapshot),
      ``,
      `CRM COMMITMENTS (refs):`,
      cRefs.map(({ ref, c }) => `[${ref}] ${c.owner} -> ${c.promised_to ?? "customer"}: ${c.description}; due ${c.due_date ?? "n/a"}; ${c.status}${c.overdue ? " OVERDUE" : ""}`).join("\n") || "(none)",
      ``,
      `ACCOUNT MEMORY recalled from Hindsight (refs):`,
      aRefs.map(({ ref, m }) => `[${ref}] (${m.occurredAt?.slice(0, 10) ?? "undated"}, ${m.type ?? "fact"}) ${m.text}`).join("\n") || "(none)",
      ``,
      `CROSS-DEAL PLAYBOOK recalled from Hindsight (refs, anonymised outcomes of other deals):`,
      pRefs.map(({ ref, m }) => `[${ref}] ${m.text}`).join("\n") || "(no closed-deal learnings yet)",
      ``,
      `Return JSON: headline (one-sentence diagnosis), stated_blocker, real_blocker, verdict (hold|proceed|adjust — about the proposed move or the current approach),`,
      `proposal_assessment, do_not [{action, why, evidence}], strategy [{step, why, evidence}] (ordered, 3-6 steps), risks [{risk, severity, evidence}],`,
      `stakeholder_plan [{name, approach, evidence}], playbook_insight {text, evidence} or null if no P refs, confidence. evidence = array of ref strings like "M3","C1","P2".`,
    ].join("\n"),
  });

  const evidence: Record<string, any> = {};
  aRefs.forEach(({ ref, m }) => (evidence[ref] = { kind: "account_memory", ...m }));
  pRefs.forEach(({ ref, m }) => (evidence[ref] = { kind: "playbook_memory", ...m }));
  cRefs.forEach(({ ref, c }) => (evidence[ref] = { kind: "commitment", ...c }));

  return { empty: false, customer: snapshot.customer, brief, evidence, recalled: { account: accountMem.length, playbook: playbookMem.length }, errors };
}
