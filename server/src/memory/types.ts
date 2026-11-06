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

/** One memory unit in Hindsight's graph view of a bank. */
export interface GraphNode extends MemoryHit {
  proofCount: number | null;
}
/** A relationship Hindsight recorded between two memories. */
export interface GraphLink {
  source: string;
  target: string;
  /** semantic | temporal | entity | caused_by | ... */
  type: string;
  weight: number;
  entity: string | null;
}

export interface StoredDocument {
  id: string;
  text: string;
  tags: string[];
  metadata: Record<string, string> | null;
  createdAt: string | null;
  eventDate: string | null;
  memoryCount: number | null;
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

  /** Every memory unit in the bank plus the links Hindsight recorded between them. */
  graph(bankId: string, opts?: { limit?: number }): Promise<{ nodes: GraphNode[]; links: GraphLink[]; total: number }>;
  /** Original retained documents (the text as written, before fact extraction). */
  listDocuments(bankId: string, opts?: { limit?: number; withText?: boolean }): Promise<StoredDocument[]>;

  listMentalModels(bankId: string): Promise<MentalModel[]>;
  ensureMentalModel(bankId: string, id: string, name: string, sourceQuery: string): Promise<void>;
  refreshMentalModel(bankId: string, id: string): Promise<void>;
}
