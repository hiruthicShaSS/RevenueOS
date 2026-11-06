export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---- session ----
const TOKEN_KEY = "revenueos.token";
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));
/** Fired when the server says the session is gone, so the app can show the sign-in screen. */
export const SIGNED_OUT_EVENT = "revenueos:signed-out";

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, "Cannot reach the RevenueOS API. Is the server running on port 4000?");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (!data && (res.status === 502 || res.status === 503 || res.status === 504))
      throw new ApiError(res.status, "Cannot reach the RevenueOS API. Is the server running on port 4000?");
    if (res.status === 401 && path !== "/auth/login") {
      setToken(null);
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    }
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => req<T>("GET", p),
  post: <T>(p: string, b?: unknown) => req<T>("POST", p, b ?? {}),
};

// ---- shared types (mirror the server responses) ----
export interface MemoryHit {
  id: string;
  text: string;
  type: string | null;
  context: string | null;
  occurredAt: string | null;
  documentId: string | null;
  tags: string[];
  entities: string[];
  score: number | null;
  scoreBreakdown?: { semantic?: number | null; keyword?: number | null; reranker?: number | null } | null;
  state?: string | null;
  invalidationReason?: string | null;
}

export interface Health {
  memory: { mode: "hindsight" | "mock"; ok: boolean; detail: string };
  llm: { configured: boolean; model: string };
  database: string;
}

export interface Deal {
  id: string;
  name: string;
  customer: string;
  customerId: string;
  amount: number;
  stage: string;
  probability: number;
  closeDate: string | null;
  status: string;
  risk: string;
  owner: string;
  primaryBlocker: string | null;
  lastTouch: string | null;
  overdueCommitments: number;
}

export interface Commitment {
  id: string;
  customer_id: string;
  customer?: string;
  interaction_id: string | null;
  owner: string;
  promised_to: string | null;
  description: string;
  due_date: string | null;
  status: string;
  overdue: boolean;
  completed_at: string | null;
  source_kind?: string;
  source_date?: string;
}

export interface Rep {
  id: string;
  name: string;
  title: string;
  email?: string | null;
}

export interface User {
  id: string;
  name: string;
  title: string;
  email: string;
}

export interface Contributor {
  name: string;
  title: string;
  interactions: number;
  last: string;
}

export interface Analysis {
  summary: string;
  facts: string[];
  stakeholders: { name: string; role: string | null; stance: string; priorities: string | null }[];
  objections: { category: string; description: string; raised_by: string | null }[];
  offers: { description: string; discount_pct: number | null; response: string }[];
  commitments: { owner: string; promised_to: string | null; description: string; due_date: string | null; direction: string }[];
  requirements: string[];
  connections: { memory_ref: string; explanation: string; memory: MemoryHit }[];
  contradictions: { previously: string; now: string; significance: string; memory: MemoryHit | null }[];
  primary_blocker: string | null;
  risk: string;
  sentiment: string;
  next_actions: { action: string; owner: string | null; why: string }[];
  recalled?: number;
}

export interface IngestResult {
  interactionId: string;
  memoryStatus: string;
  memoryError: string | null;
  recallError: string | null;
  recalledCount: number;
  analysis: Analysis;
}

export interface Interaction {
  id: string;
  kind: string;
  occurred_at: string;
  raw_text: string;
  analysis: Analysis | null;
  memory_status: string;
  memory_error: string | null;
  rep_name: string;
  rep_title?: string | null;
}

export interface AccountSnapshot {
  customer: any;
  deals: any[];
  stakeholders: { id: string; name: string; role: string | null; stance: string | null; priorities: string | null }[];
  commitments: Commitment[];
  objections: { id: string; category: string; description: string; raised_by: string | null; status: string; created_at: string }[];
  offers: { id: string; description: string; discount_pct: number | null; response: string; created_at: string }[];
  interactions: Interaction[];
}

export type Evidence = Record<string, (MemoryHit & { kind: "account_memory" | "playbook_memory" }) | (Commitment & { kind: "commitment" })>;

export interface Brief {
  headline: string;
  stated_blocker?: string | null;
  real_blocker: string;
  verdict: "hold" | "proceed" | "adjust";
  proposal_assessment?: string | null;
  do_not: { action: string; why: string; evidence: string[] }[];
  strategy: { step: string; why: string; evidence: string[] }[];
  risks: { risk: string; severity: string; evidence: string[] }[];
  stakeholder_plan: { name: string; approach: string; evidence: string[] }[];
  playbook_insight?: { text: string; evidence: string[] } | null;
  confidence: string;
}

export interface BriefResult {
  empty: boolean;
  message?: string;
  brief?: Brief;
  evidence: Evidence;
  recalled?: { account: number; playbook: number };
  contributors?: Contributor[];
  errors: string[];
}

export interface AskResult {
  scope: "account" | "portfolio";
  customer: any | null;
  answer: string;
  evidence: MemoryHit[];
  engine: string;
  ms: number;
  baseline: string | null;
  accounts?: string[];
}

export const fmtMoney = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`;

export const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

export const daysAgo = (s: string | null | undefined) => {
  if (!s) return null;
  return Math.round((Date.now() - new Date(s).getTime()) / 864e5);
};
