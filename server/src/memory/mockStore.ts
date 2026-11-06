import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { config } from "../config.js";
import type { MemoryHit, MemoryStore, MentalModel, RetainOptions, ReflectResult } from "./types.js";

/**
 * OFFLINE DEVELOPMENT ONLY (MEMORY_MODE=mock).
 *
 * Naive keyword-overlap retrieval over a Postgres table so the UI can be built
 * without a Hindsight server. It does no fact extraction, entity linking,
 * temporal reasoning or consolidation — that is exactly what Hindsight adds.
 * The UI shows a "mock memory" banner whenever this store is active.
 */
export class MockStore implements MemoryStore {
  readonly mode = "mock" as const;
  readonly playbookBank = `${config.hindsight.bankPrefix}-playbook`;

  customerBank(customerId: string) {
    return `${config.hindsight.bankPrefix}-customer-${customerId}`;
  }
  async health() {
    return { ok: true, detail: "MOCK memory store (offline dev mode) — not Hindsight" };
  }
  async ensureCustomerBank() {}
  async ensurePlaybookBank() {}
  async deleteBank(bankId: string) {
    const db = await getDb();
    await db.query(`DELETE FROM mock_memories WHERE bank_id=$1`, [bankId]);
  }

  async retain(bankId: string, content: string, opts: RetainOptions) {
    const db = await getDb();
    if (opts.documentId) {
      await db.query(`DELETE FROM mock_memories WHERE bank_id=$1 AND document_id=$2`, [bankId, opts.documentId]);
    }
    await db.query(
      `INSERT INTO mock_memories (id, bank_id, text, context, fact_type, document_id, occurred_at, tags)
       VALUES ($1,$2,$3,$4,'experience',$5,$6,$7)`,
      [randomUUID(), bankId, content, opts.context, opts.documentId ?? null, opts.timestamp ?? new Date().toISOString(), opts.tags ?? []]
    );
  }

  async recall(bankId: string, query: string): Promise<MemoryHit[]> {
    const db = await getDb();
    const rows = await db.query(`SELECT * FROM mock_memories WHERE bank_id=$1`, [bankId]);
    const terms = tokenize(query);
    return rows
      .map((r) => {
        const t = tokenize(r.text);
        const overlap = terms.filter((x) => t.includes(x)).length;
        return { r, score: terms.length ? overlap / terms.length : 0 };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(({ r, score }) => toHit(r, score));
  }

  async reflect(bankId: string, query: string): Promise<ReflectResult> {
    const hits = await this.recall(bankId, query);
    return {
      text: hits.length
        ? `(mock) Relevant memories:\n${hits.map((h) => `- ${h.text.slice(0, 200)}`).join("\n")}`
        : "(mock) No relevant memories.",
      evidence: hits,
      structured: null,
    };
  }

  async list(bankId: string, opts?: { limit?: number; offset?: number }) {
    const db = await getDb();
    const rows = await db.query(
      `SELECT * FROM mock_memories WHERE bank_id=$1 ORDER BY occurred_at DESC LIMIT $2 OFFSET $3`,
      [bankId, opts?.limit ?? 100, opts?.offset ?? 0]
    );
    const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM mock_memories WHERE bank_id=$1`, [bankId]);
    return { items: rows.map((r) => toHit(r, null)), total: n };
  }

  async graph(bankId: string, opts?: { limit?: number }) {
    const { items, total } = await this.list(bankId, { limit: opts?.limit ?? 500 });
    return { nodes: items.map((m) => ({ ...m, proofCount: null })), links: [], total };
  }

  async listDocuments(bankId: string) {
    const { items } = await this.list(bankId, { limit: 500 });
    return items.map((m) => ({ id: m.documentId ?? m.id, text: m.text, tags: m.tags, metadata: null, createdAt: m.occurredAt, eventDate: m.occurredAt, memoryCount: 1 }));
  }

  async listMentalModels(): Promise<MentalModel[]> {
    return [];
  }
  async ensureMentalModel() {}
  async refreshMentalModel() {}
}

function tokenize(s: string) {
  return s
    .toLowerCase()
    .split(/[^a-z0-9%]+/)
    .filter((w) => w.length > 2);
}

function toHit(r: any, score: number | null): MemoryHit {
  return {
    id: r.id,
    text: r.text,
    type: r.fact_type,
    context: r.context,
    occurredAt: r.occurred_at ? new Date(r.occurred_at).toISOString() : null,
    documentId: r.document_id,
    tags: r.tags ?? [],
    entities: [],
    score,
  };
}
