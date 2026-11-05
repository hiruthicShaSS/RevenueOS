/**
 * The memory layer contract. The real implementation is Hindsight
 * (see hindsightStore.ts). mockStore.ts exists only so the UI can be
 * developed offline and is never used when MEMORY_MODE=hindsight.
 */

export interface MemoryHit {
  id: string;
  text: string;
  type: string | null; // world | experience | observation
  context: string | null;
  occurredAt: string | null;
  documentId: string | null;
  tags: string[];
  entities: string[];
  score: number | null;
  scoreBreakdown?: { semantic?: number | null; keyword?: number | null; reranker?: number | null } | null;
  state?: string | null; // valid | invalidated
  invalidationReason?: string | null;
}

export interface RetainOptions {
  context: string;
  timestamp?: string;
  documentId?: string;
  tags?: string[];
  entities?: { text: string; type?: string }[];
  metadata?: Record<string, string>;
}

export interface ReflectResult {
  text: string;
  evidence: MemoryHit[];
  structured?: Record<string, unknown> | null;
}

export interface MentalModel {
  id: string;
  name: string;
  sourceQuery: string | null;
  content: string | null;
  lastRefreshedAt: string | null;
}

export interface MemoryStore {
  readonly mode: "hindsight" | "mock";
  health(): Promise<{ ok: boolean; detail: string }>;

  customerBank(customerId: string): string;
  readonly playbookBank: string;

  ensureCustomerBank(customerId: string, customerName: string): Promise<void>;
  ensurePlaybookBank(): Promise<void>;
  deleteBank(bankId: string): Promise<void>;

  retain(bankId: string, content: string, opts: RetainOptions): Promise<void>;
  recall(
    bankId: string,
    query: string,
    opts?: { maxTokens?: number; tags?: string[]; budget?: "low" | "mid" | "high" }
  ): Promise<MemoryHit[]>;
  reflect(
    bankId: string,
    query: string,
    opts?: { context?: string; responseSchema?: Record<string, unknown>; budget?: "low" | "mid" | "high" }
  ): Promise<ReflectResult>;
  list(
    bankId: string,
    opts?: { limit?: number; offset?: number; type?: string; q?: string }
  ): Promise<{ items: MemoryHit[]; total: number }>;

  listMentalModels(bankId: string): Promise<MentalModel[]>;
  ensureMentalModel(bankId: string, id: string, name: string, sourceQuery: string): Promise<void>;
  refreshMentalModel(bankId: string, id: string): Promise<void>;
}
