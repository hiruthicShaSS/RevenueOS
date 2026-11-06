import { HindsightClient, HindsightError } from "@vectorize-io/hindsight-client";
import { config } from "../config.js";
import type { GraphLink, GraphNode, MemoryHit, MemoryStore, MentalModel, RetainOptions, ReflectResult, StoredDocument } from "./types.js";

/**
 * Real Hindsight-backed memory.
 *
 * Isolation model:
 *  - one bank per customer  -> `${prefix}-customer-${id}`. A customer's memories
 *    physically cannot surface in another customer's recall/reflect.
 *  - one shared playbook bank -> `${prefix}-playbook`. Holds anonymised deal
 *    outcomes (which tactics won/lost against which blockers) so the negotiator
 *    learns across deals without leaking customer specifics.
 */
export class HindsightStore implements MemoryStore {
  readonly mode = "hindsight" as const;
  private client: HindsightClient;
  private ensured = new Set<string>();
  readonly playbookBank: string;

  constructor() {
    this.client = new HindsightClient({
      baseUrl: config.hindsight.baseUrl,
      apiKey: config.hindsight.apiKey,
      userAgent: "revenueos/0.1",
    });
    this.playbookBank = `${config.hindsight.bankPrefix}-playbook`;
  }

  customerBank(customerId: string) {
    return `${config.hindsight.bankPrefix}-customer-${customerId}`;
  }

  async health() {
    try {
      const v = await this.client.getVersion();
      return { ok: true, detail: `Hindsight API ${v.api_version ?? ""} at ${config.hindsight.baseUrl}` };
    } catch (e) {
      return { ok: false, detail: `Hindsight unreachable at ${config.hindsight.baseUrl}: ${errMsg(e)}` };
    }
  }

  async ensureCustomerBank(customerId: string, customerName: string) {
    const bank = this.customerBank(customerId);
    if (this.ensured.has(bank)) return;
    await this.client.createBank(bank, {
      name: `${customerName} — account memory`,
      retainMission:
        `You are the account memory for ${customerName}, a B2B customer of our sales team. ` +
        `Extract durable sales facts: stakeholders (name, role, what they care about), objections and who raised them, ` +
        `pricing and discount offers and how the customer responded, technical requirements, timelines, ` +
        `commitments our reps made (who, what, by when) and whether they were fulfilled, competitors mentioned, and deal outcomes. ` +
        `Always keep who said what. Ignore small talk.`,
      reflectMission:
        `You advise a B2B account executive on the ${customerName} account. Ground every claim in remembered interactions, ` +
        `name the stakeholder and the date where possible, and distinguish what the customer said from what our team promised. ` +
        `Judge the real blocker by behaviour, not just stated objections: if a discount was offered and rejected while technical or ` +
        `implementation concerns keep recurring, say plainly that price is not the primary blocker. Treat an overdue promise from our team as a top risk.`,
      enableObservations: true,
      observationsMission:
        `Consolidate what we have learned about ${customerName}'s buying behaviour: real blockers vs stated ones, ` +
        `how each stakeholder's position evolves, and which of our moves moved the deal forward or backward.`,
    });
    this.ensured.add(bank);
  }

  async ensurePlaybookBank() {
    if (this.ensured.has(this.playbookBank)) return;
    await this.client.createBank(this.playbookBank, {
      name: "Negotiation playbook — cross-deal learnings",
      retainMission:
        `Store anonymised lessons from closed deals: the customer's industry and size, the primary blocker, ` +
        `the tactics our team tried (discounts, technical demos, pilots, references, timelines), which ones worked or failed, and the final outcome. ` +
        `Keep the causal link between blocker, tactic and outcome.`,
      reflectMission:
        `You are a sales coach. Recommend negotiation tactics based only on evidence from past deal outcomes. ` +
        `Quote win/loss counts when the evidence supports it, and say when evidence is thin.`,
      enableObservations: true,
      observationsMission:
        `Form generalised rules of the form "when the blocker is X, tactic Y tends to win/lose", with the number of supporting deals.`,
    });
    this.ensured.add(this.playbookBank);
  }

  async deleteBank(bankId: string) {
    try {
      await this.client.deleteBank(bankId);
    } catch (e) {
      if (!(e instanceof HindsightError && e.statusCode === 404)) throw e;
    }
    this.ensured.delete(bankId);
  }

  async retain(bankId: string, content: string, opts: RetainOptions) {
    try {
      await this.retainOnce(bankId, content, opts);
    } catch (e) {
      // Hindsight surfaces its LLM provider's rate limit with a reset time. Wait it out once.
      // documentId makes the retry idempotent.
      const wait = quotaWaitMs(e);
      if (wait === null) throw e;
      console.warn(`Hindsight provider quota hit; retrying retain in ${Math.round(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
      await this.retainOnce(bankId, content, opts);
    }
  }

  private async retainOnce(bankId: string, content: string, opts: RetainOptions) {
    await this.client.retain(bankId, content, {
      context: opts.context,
      timestamp: opts.timestamp,
      documentId: opts.documentId,
      tags: opts.tags,
      entities: opts.entities,
      metadata: opts.metadata,
    });
  }

  async recall(bankId: string, query: string, opts?: { maxTokens?: number; tags?: string[]; budget?: "low" | "mid" | "high" }) {
    const r = await withQuotaRetry(() =>
      this.client.recall(bankId, query, {
        maxTokens: opts?.maxTokens ?? 2048,
        budget: opts?.budget ?? "mid",
        tags: opts?.tags,
        types: ["world", "experience", "observation"],
      })
    );
    return r.results.map(
      (x): MemoryHit => ({
        id: x.id,
        text: x.text,
        type: x.type ?? null,
        context: x.context ?? null,
        occurredAt: x.occurred_start ?? x.mentioned_at ?? null,
        documentId: x.document_id ?? null,
        tags: x.tags ?? [],
        entities: x.entities ?? [],
        score: x.scores?.final ?? null,
        scoreBreakdown: x.scores
          ? { semantic: x.scores.semantic, keyword: x.scores.keyword, reranker: x.scores.reranker }
          : null,
      })
    );
  }

  async reflect(
    bankId: string,
    query: string,
    opts?: { context?: string; responseSchema?: Record<string, unknown>; budget?: "low" | "mid" | "high" }
  ): Promise<ReflectResult> {
    const r = await withQuotaRetry(() => this.client.reflect(bankId, query, {
      context: opts?.context,
      budget: opts?.budget ?? "mid",
      includeFacts: true,
      responseSchema: opts?.responseSchema,
    }), 0);
    return {
      text: r.text,
      structured: r.structured_output ?? null,
      evidence: (r.based_on?.memories ?? []).map(
        (m): MemoryHit => ({
          id: m.id ?? "",
          text: m.text,
          type: m.type ?? null,
          context: m.context ?? null,
          occurredAt: m.occurred_start ?? m.mentioned_at ?? null,
          documentId: m.document_id ?? null,
          tags: m.tags ?? [],
          entities: [],
          score: null,
        })
      ),
    };
  }

  async list(bankId: string, opts?: { limit?: number; offset?: number; type?: string; q?: string }) {
    try {
      const r = await this.client.listMemories(bankId, {
        limit: opts?.limit ?? 100,
        offset: opts?.offset ?? 0,
        type: opts?.type,
        q: opts?.q,
      });
      return {
        total: r.total,
        items: r.items.map(
          (m): MemoryHit => ({
            id: m.id,
            text: m.text ?? "",
            type: m.fact_type ?? null,
            context: m.context ?? null,
            occurredAt: m.occurred_start ?? m.mentioned_at ?? m.date ?? null,
            documentId: m.document_id ?? null,
            tags: m.tags ?? [],
            entities: m.entities ? m.entities.split(",").map((s) => s.trim()).filter(Boolean) : [],
            score: null,
            state: m.state ?? null,
            invalidationReason: m.invalidation_reason ?? null,
          })
        ),
      };
    } catch (e) {
      if (e instanceof HindsightError && e.statusCode === 404) return { items: [], total: 0 };
      throw e;
    }
  }

  /**
   * GET /v1/default/banks/{bank}/graph: every memory unit and the links Hindsight recorded between
   * them (semantic, temporal, entity, caused_by). The client SDK has no wrapper for it yet.
   */
  async graph(bankId: string, opts?: { limit?: number }) {
    const url = `${config.hindsight.baseUrl.replace(/\/$/, "")}/v1/default/banks/${encodeURIComponent(bankId)}/graph?limit=${opts?.limit ?? 500}`;
    const r = await fetch(url, { headers: config.hindsight.apiKey ? { Authorization: `Bearer ${config.hindsight.apiKey}` } : {} });
    if (r.status === 404) return { nodes: [], links: [], total: 0 };
    if (!r.ok) throw new Error(`Hindsight graph failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
    const j: any = await r.json();
    const nodes: GraphNode[] = (j.table_rows ?? []).map((m: any) => ({
      id: m.id,
      text: m.text ?? "",
      type: m.fact_type ?? null,
      context: m.context && m.context !== "N/A" ? m.context : null,
      occurredAt: m.occurred_start ?? m.mentioned_at ?? null,
      documentId: m.document_id ?? null,
      tags: m.tags ?? [],
      entities: m.entities ? String(m.entities).split(",").map((s: string) => s.trim()).filter(Boolean) : [],
      score: null,
      proofCount: m.proof_count ?? null,
    }));
    const ids = new Set(nodes.map((n) => n.id));
    const links: GraphLink[] = (j.edges ?? [])
      .map((e: any) => e.data ?? e)
      .filter((e: any) => ids.has(e.source) && ids.has(e.target))
      .map((e: any) => ({ source: e.source, target: e.target, type: e.linkType ?? e.link_type ?? "related", weight: Number(e.weight ?? 1), entity: e.entityName || null }));
    return { nodes, links, total: Number(j.total_units ?? nodes.length) };
  }

  async listDocuments(bankId: string, opts?: { limit?: number; withText?: boolean }): Promise<StoredDocument[]> {
    let items: any[];
    try {
      items = (await this.client.listDocuments(bankId, { limit: opts?.limit ?? 200 })).items ?? [];
    } catch (e) {
      if (e instanceof HindsightError && e.statusCode === 404) return [];
      throw e;
    }
    const full = opts?.withText ? await Promise.all(items.map((d) => this.client.getDocument(bankId, d.id).catch(() => null))) : [];
    return items.map((d, i) => {
      const f: any = full[i];
      return {
        id: d.id,
        text: f?.original_text ?? "",
        tags: d.tags ?? [],
        metadata: (f?.document_metadata ?? d.document_metadata ?? null) as Record<string, string> | null,
        createdAt: d.created_at ?? null,
        eventDate: d.retain_params?.event_date ?? null,
        memoryCount: d.memory_unit_count ?? null,
      };
    });
  }

  async listMentalModels(bankId: string): Promise<MentalModel[]> {
    try {
      const r = await this.client.listMentalModels(bankId, { detail: "content" });
      return r.items.map((m) => ({
        id: m.id,
        name: m.name,
        sourceQuery: m.source_query ?? null,
        content: m.content ?? null,
        lastRefreshedAt: m.last_refreshed_at ?? null,
      }));
    } catch (e) {
      if (e instanceof HindsightError && e.statusCode === 404) return [];
      throw e;
    }
  }

  async ensureMentalModel(bankId: string, id: string, name: string, sourceQuery: string) {
    const existing = await this.listMentalModels(bankId);
    if (existing.some((m) => m.id === id)) return;
    await this.client.createMentalModel(bankId, name, sourceQuery, {
      id,
      trigger: { refreshAfterConsolidation: true, mode: "full" },
    });
  }

  async refreshMentalModel(bankId: string, id: string) {
    await this.client.refreshMentalModel(bankId, id);
  }
}

/** Retry once after an LLM-provider quota error, if the wait is short enough to be worth it. */
async function withQuotaRetry<T>(fn: () => Promise<T>, maxWaitMs = 35_000): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const wait = quotaWaitMs(e);
    if (wait === null || wait > maxWaitMs) throw e;
    console.warn(`Hindsight provider quota hit; retrying in ${Math.round(wait / 1000)}s`);
    await new Promise((r) => setTimeout(r, wait));
    return fn();
  }
}

export function isQuotaError(e: unknown) {
  return /rate limit|quota|429/i.test(errMsg(e));
}

/** If the error is an LLM-provider quota/rate-limit, how long to wait before retrying (capped at 65s). */
function quotaWaitMs(e: unknown): number | null {
  const msg = errMsg(e);
  if (!/rate limit|quota|429/i.test(msg)) return null;
  const tryIn = msg.match(/try again in ([\d.]+)s/i);
  if (tryIn) return Math.min(65_000, Math.ceil(Number(tryIn[1]) * 1000) + 1500);
  const at = msg.match(/retry at (\d{4}-\d{2}-\d{2}T[\d:.]+(?:\+00:00|Z)?)/);
  if (at) {
    const ms = new Date(at[1].endsWith("Z") || at[1].includes("+") ? at[1] : `${at[1]}Z`).getTime() - Date.now();
    if (Number.isFinite(ms)) return Math.min(65_000, Math.max(2_000, ms + 1500));
  }
  return 20_000;
}

export function errMsg(e: unknown): string {
  if (e instanceof HindsightError) return `${e.message}${e.statusCode ? ` (HTTP ${e.statusCode})` : ""}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
