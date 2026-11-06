/**
 * End-to-end tests against a real RevenueOS server, real Hindsight and the real LLM.
 *
 * Isolation: the suite starts its own server on a spare port with a throwaway
 * Postgres directory and a unique Hindsight bank prefix, so it never touches the
 * demo data. Every bank it creates is deleted at the end.
 *
 *   npm --prefix server run test:e2e
 *
 * Needs server/.env with LLM_API_KEY and Hindsight settings. Takes a few minutes
 * (each interaction goes through LLM extraction and Hindsight retain).
 */
import "dotenv/config";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HindsightClient } from "@vectorize-io/hindsight-client";
import { makeDocx, makePdf } from "./fixtures.js";

const PORT = 4600 + Math.floor(Math.random() * 300);
const BASE = `http://localhost:${PORT}/api`;
const PREFIX = `revenueos-e2e-${Date.now().toString(36)}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "revenueos-e2e-"));
const SERVER_DIR = path.resolve(import.meta.dirname, "..");
const LONG = { timeout: 240_000 };

let server: ChildProcess | null = null;
let serverLog = "";

async function startServer() {
  serverLog = "";
  server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT), DATA_DIR, HINDSIGHT_BANK_PREFIX: PREFIX, MEMORY_MODE: "hindsight" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout!.on("data", (d) => (serverLog += d));
  server.stderr!.on("data", (d) => (serverLog += d));
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`Server did not start:\n${serverLog}`);
}

async function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  await new Promise<void>((resolve) => {
    s.once("exit", () => resolve());
    s.kill();
    setTimeout(resolve, 5000);
  });
  await sleep(500); // let PGlite release its files
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let token: string | null = null;

async function call<T = any>(method: string, p: string, body?: unknown, auth: string | null = token): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (auth) headers.Authorization = `Bearer ${auth}`;
  const r = await fetch(`${BASE}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: (await r.json().catch(() => null)) as T };
}
const get = <T = any>(p: string) => call<T>("GET", p);
const post = <T = any>(p: string, b: unknown = {}) => call<T>("POST", p, b);

async function upload<T = any>(fileName: string, data: Buffer, fields: Record<string, string> = {}): Promise<{ status: number; data: T }> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(data)]), fileName);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const r = await fetch(`${BASE}/documents/extract`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  return { status: r.status, data: (await r.json().catch(() => null)) as T };
}

/** Sign in as a teammate; later calls run as them. */
async function signIn(email: string, designation: string) {
  const r = ok(await post("/auth/login", { email, designation }), `login ${email}`);
  token = r.token;
  return r.user;
}
const PRIYA = "priya.nair@revenueos.app";
const MARCUS = "marcus.chen@revenueos.app";

function ok<T>(res: { status: number; data: T }, label: string): T {
  assert.equal(res.status, 200, `${label} -> HTTP ${res.status}: ${JSON.stringify(res.data)}`);
  return res.data;
}

before(async () => {
  await startServer();
  await signIn(PRIYA, "Senior Account Executive");
});

after(async () => {
  await stopServer();
  // Delete every bank this run created.
  const hs = new HindsightClient({ baseUrl: process.env.HINDSIGHT_BASE_URL!, apiKey: process.env.HINDSIGHT_API_KEY || undefined });
  const ids = ["halcyon", "meridian", "brightwater", "kestrel", "solace", "pinecrest", "tidewater", "vantage", "larkspur"].map(
    (c) => `${PREFIX}-customer-cus_${c}`
  );
  await Promise.allSettled([...ids, `${PREFIX}-playbook`].map((b) => hs.deleteBank(b)));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe("system", () => {
  test("health reports real Hindsight, LLM and database", async () => {
    const h = ok(await get("/health"), "health");
    assert.equal(h.memory.mode, "hindsight");
    assert.equal(h.memory.ok, true, h.memory.detail);
    assert.equal(h.llm.configured, true);
  });

  test("seeded CRM data is present and overview numbers are consistent", async () => {
    const customers = ok(await get<any[]>("/customers"), "customers");
    assert.equal(customers.length, 9);
    const o = ok(await get("/overview"), "overview");
    const openSum = o.deals.filter((d: any) => d.status === "open").reduce((s: number, d: any) => s + d.amount, 0);
    assert.equal(o.metrics.pipeline, openSum);
    assert.ok(o.metrics.expected < o.metrics.pipeline);
    assert.ok(o.metrics.overdueCommitments >= 1, "seed has overdue promises");
  });
});

describe("sign-in", () => {
  test("every API except health and login requires a session", async () => {
    assert.equal((await call("GET", "/customers", undefined, null)).status, 401);
    assert.equal((await call("GET", "/customers", undefined, "not-a-real-token")).status, 401);
    assert.equal((await call("GET", "/health", undefined, null)).status, 200);
  });

  test("login validates email and designation", async () => {
    assert.equal((await call("POST", "/auth/login", { email: "nope", designation: "AE" }, null)).status, 400);
    assert.equal((await call("POST", "/auth/login", { email: "a@b.co", designation: "" }, null)).status, 400);
  });

  test("a new teammate is created from email, a known email reuses its profile, logout ends the session", async () => {
    const email = `sam.okoro.${Date.now()}@revenueos.app`;
    const first = ok(await call<any>("POST", "/auth/login", { email: email.toUpperCase(), designation: "Sales Manager" }, null), "new login");
    assert.equal(first.user.name, "Sam Okoro");
    assert.equal(first.user.title, "Sales Manager");
    const again = ok(await call<any>("POST", "/auth/login", { email, designation: "VP of Sales" }, null), "second login");
    assert.equal(again.user.id, first.user.id, "same email, same teammate");
    assert.equal(again.user.title, "VP of Sales", "designation updated");
    assert.equal(ok(await call<any>("GET", "/auth/me", undefined, again.token), "me").email, email);
    ok(await call("POST", "/auth/logout", {}, again.token), "logout");
    assert.equal((await call("GET", "/auth/me", undefined, again.token)).status, 401);
    assert.equal((await call("GET", "/auth/me", undefined, first.token)).status, 200, "other sessions stay valid");

    const seeded = ok(await call<any>("POST", "/auth/login", { email: PRIYA, designation: "Senior Account Executive" }, null), "seeded login");
    assert.equal(seeded.user.id, "rep_priya");
  });
});

describe("input validation and error handling", () => {
  test("rejects bad interaction input", async () => {
    const good = { kind: "meeting", text: "A sufficiently long note about the account." };
    assert.equal((await post("/customers/cus_halcyon/interactions", { ...good, text: "too short" })).status, 400);
    assert.equal((await post("/customers/cus_halcyon/interactions", { ...good, kind: "fax" })).status, 400);
    assert.equal((await post("/customers/cus_halcyon/interactions", { ...good, occurredAt: "not-a-date" })).status, 400);
    assert.equal((await post("/customers/cus_nope/interactions", good)).status, 404);
  });

  test("rejects bad requests on other endpoints", async () => {
    assert.equal((await get("/customers/cus_nope")).status, 404);
    assert.equal((await post("/ask", { question: "" })).status, 400);
    assert.equal((await post("/customers/cus_halcyon/recall", { query: "x" })).status, 400);
    assert.equal((await post("/commitments/cmt_nope/complete")).status, 404);
    assert.equal((await post("/deals/deal_nope/outcome", { outcome: "won", primaryBlocker: "x", tactics: "y", reason: "z" })).status, 404);
    assert.equal((await post("/deals/deal_tidewater/outcome", { outcome: "won", primaryBlocker: " ", tactics: "", reason: "" })).status, 400);
    assert.equal((await post("/deals/deal_tidewater/outcome", { outcome: "maybe", primaryBlocker: "x", tactics: "y", reason: "z" })).status, 400);
  });

  test("negotiator on an account with no memory returns an empty state, not an error", async () => {
    const r = ok(await post("/customers/cus_halcyon/negotiate", {}), "negotiate empty");
    assert.equal(r.empty, true);
  });
});

describe("the persistent memory scenario", () => {
  let script: any;
  let conv1: any;

  test("conversation 1 is analysed and retained in Hindsight", LONG, async () => {
    script = ok(await get("/demo/script"), "script");
    const s = script.steps[0];
    await signIn(PRIYA, "Senior Account Executive");
    conv1 = ok(await post(`/customers/${script.customerId}/interactions`, { kind: s.kind, text: s.text, occurredAt: s.occurredAt }), "conv1");
    assert.equal(conv1.memoryStatus, "stored", conv1.memoryError);
    assert.equal(conv1.recalledCount, 0, "fresh bank has nothing to recall");

    const a = conv1.analysis;
    const names = a.stakeholders.map((x: any) => x.name).join(" ");
    assert.match(names, /Sarah/);
    assert.match(names, /David/);
    assert.ok(a.objections.some((o: any) => o.category === "pricing"));
    assert.ok(a.objections.some((o: any) => /SAP|integrat/i.test(o.description)));

    // "by Friday" must resolve to the Friday after the meeting.
    const promise = conv1.newCommitments.find((c: any) => /document/i.test(c.description));
    assert.ok(promise, "documentation promise detected");
    assert.match(promise.owner, /Priya/);
    assert.ok(promise.due_date, "due date resolved");
    const due = new Date(`${promise.due_date}T12:00:00Z`);
    const met = new Date(s.occurredAt);
    assert.equal(due.getUTCDay(), 5, `due ${promise.due_date} should be a Friday`);
    const days = (due.getTime() - met.getTime()) / 864e5;
    assert.ok(days >= -1 && days <= 7, `due date within the week of the meeting (got ${days.toFixed(1)} days)`);
  });

  test("Hindsight extracted facts from conversation 1", LONG, async () => {
    const m = ok(await get(`/customers/${script.customerId}/memory`), "memory");
    assert.ok(m.total >= 3, `expected several facts, got ${m.total}`);
    const all = m.items.map((x: any) => x.text).join("\n");
    assert.match(all, /SAP/);
    assert.match(all, /15\s?%/);
  });

  test("conversation 2 by a different rep recalls and connects conversation 1", LONG, async () => {
    const s = script.steps[1];
    await signIn(MARCUS, "Account Executive");
    const r = ok(await post(`/customers/${script.customerId}/interactions`, { kind: s.kind, text: s.text, occurredAt: s.occurredAt }), "conv2");
    const snap = ok(await get(`/customers/${script.customerId}`), "snapshot");
    assert.deepEqual(new Set(snap.interactions.map((i: any) => i.rep_name)), new Set(["Priya Nair", "Marcus Chen"]), "each note is attributed to who logged it");
    assert.equal(r.memoryStatus, "stored", r.memoryError);
    assert.ok(r.recalledCount > 0, "should recall conversation 1");
    assert.ok(r.analysis.connections.length > 0, "should link to earlier memories");
    assert.ok(r.analysis.offers.some((o: any) => o.discount_pct === 20 && o.response === "rejected"), "20% discount rejected");
    assert.doesNotMatch(String(r.analysis.primary_blocker), /^pric/i, "real blocker should no longer be pricing");
  });

  test("after a full server restart, memory still answers the question", LONG, async () => {
    await stopServer();
    await startServer();
    const r = ok(await post("/ask", { question: script.question, customerId: script.customerId }), "ask after restart");
    assert.equal(r.scope, "account");
    assert.ok(r.evidence.length > 0, "answer cites memories");
    assert.match(r.answer, /SAP/i);
    assert.match(r.answer, /document/i, "mentions the promised documentation");
    assert.match(r.answer, /20\s?%|discount/i);
  });

  test("account is auto-detected from the question text", LONG, async () => {
    const r = ok(await post("/ask", { question: "What did the CTO at Halcyon ask for?" }), "ask detect");
    assert.equal(r.scope, "account");
    assert.equal(r.customer.id, "cus_halcyon");
  });

  test("baseline comparison returns a stateless answer alongside", LONG, async () => {
    const r = ok(await post("/ask", { question: "What did David ask about SAP?", customerId: "cus_halcyon", compare: true }), "ask compare");
    assert.ok(r.baseline && r.baseline.length > 20);
    assert.ok(r.answer.length > 20);
  });
});

describe("isolation between customer memories", () => {
  test("another account's bank never returns Halcyon facts", LONG, async () => {
    const r = ok(
      await post("/customers/cus_meridian/interactions", {
        kind: "note",
        text: "Angela Ruiz confirmed the security review meeting with Tom Becker is booked for next Tuesday.",
      }),
      "meridian ingest"
    );
    assert.equal(r.memoryStatus, "stored", r.memoryError);
    const probe = ok(await post("/customers/cus_meridian/recall", { query: "Sarah Whitman SAP integration discount Halcyon" }), "recall");
    for (const h of probe.hits) {
      assert.doesNotMatch(h.text, /Halcyon|Sarah Whitman|David Okafor/, `leaked: ${h.text}`);
    }
  });
});

describe("commitments", () => {
  test("overdue promise is tracked, can be completed, and completion is remembered", LONG, async () => {
    const list = ok(await get<any[]>("/commitments"), "commitments");
    const c = list.find((x) => x.customer_id === "cus_halcyon" && /document/i.test(x.description));
    assert.ok(c, "Halcyon documentation promise listed");
    assert.equal(c.status, "open");
    assert.equal(c.overdue, true);

    const done = ok(await post(`/commitments/${c.id}/complete`, { note: "Sent SAP integration guide v3 to David." }), "complete");
    assert.equal(done.memoryError, null);

    const after = ok(await get<any[]>("/commitments"), "commitments after");
    assert.equal(after.find((x) => x.id === c.id).status, "done");

    const probe = ok(await post("/customers/cus_halcyon/recall", { query: "was the integration documentation sent to David?" }), "recall fulfilled");
    assert.ok(probe.hits.some((h: any) => /fulfil|sent|guide/i.test(h.text)), "fulfilment is in memory");
  });
});

describe("negotiator", () => {
  test("advises against another discount and every citation resolves", LONG, async () => {
    const r = ok(await post("/customers/cus_halcyon/negotiate", { proposal: "Offer a 25% discount to close this month" }), "negotiate");
    assert.equal(r.empty, false);
    const b = r.brief;
    assert.notEqual(b.verdict, "proceed", "should not endorse a bigger discount");
    assert.ok(b.strategy.length >= 2);
    const refs = [...b.strategy, ...b.do_not, ...b.risks, ...b.stakeholder_plan].flatMap((x: any) => x.evidence);
    assert.ok(refs.length > 0, "recommendations cite evidence");
    const unresolved = refs.filter((ref: string) => !(ref in r.evidence));
    assert.deepEqual(unresolved, [], "every cited ref exists in the evidence map");
    const names = r.contributors.map((c: any) => c.name);
    assert.ok(names.includes("Priya Nair") && names.includes("Marcus Chen"), `brief draws on both teammates' notes: ${names}`);
  });
});

describe("portfolio questions and learning", () => {
  test("portfolio question uses CRM data across accounts", LONG, async () => {
    const r = ok(await post("/ask", { question: "Which commitments are overdue across all accounts?" }), "portfolio");
    assert.equal(r.scope, "portfolio");
    assert.match(r.answer, /Meridian|Pinecrest/);
  });

  test("closing a deal writes a lesson to the playbook bank", LONG, async () => {
    const before = ok(await get("/playbook"), "playbook before");
    const r = ok(
      await post("/deals/deal_brightwater/outcome", {
        outcome: "won",
        primaryBlocker: "Procurement calendar",
        tactics: "Countersigned redlines before the finance committee; FDA audit trail sample report",
        reason: "Board finance committee approved on schedule",
      }),
      "outcome"
    );
    assert.equal(r.ok, true, r.errors?.join("; "));
    const o = ok(await get("/overview"), "overview after");
    assert.equal(o.deals.find((d: any) => d.id === "deal_brightwater").status, "won");
    const afterPb = ok(await get("/playbook"), "playbook after");
    assert.ok(afterPb.lessons.length > before.lessons.length, "playbook gained a lesson");
  });

  test("lessons reaching the shared playbook are anonymised", LONG, async () => {
    const r = ok(
      await post("/deals/deal_pinecrest/outcome", {
        outcome: "lost",
        primaryBlocker: "Lisa Tran at Pinecrest Credit Union said the board caps software at $75k/yr",
        tactics: "Jordan Blake offered Pinecrest a 3-year term at $71,500 on 2026-11-01",
        reason: "Pinecrest Credit Union's board rejected it; Lisa Tran wanted approval workflows we lacked",
      }),
      "outcome"
    );
    assert.equal(r.ok, true, r.errors?.join("; "));
    const text = JSON.stringify(r.lesson);
    for (const banned of ["Pinecrest", "Lisa", "Tran", "Jordan", "Blake", "$75k", "71,500", "2026-11-01"]) {
      assert.ok(!text.includes(banned), `lesson leaks "${banned}": ${text}`);
    }
    const pb = ok(await get("/playbook"), "playbook");
    const stored = pb.lessons.find((l: any) => l.id === "lesson-deal_pinecrest");
    assert.ok(stored, "lesson stored in the playbook bank");
    assert.ok(!JSON.stringify(stored).includes("Pinecrest"), "stored lesson has no customer name");
    assert.ok(pb.patterns.every((p: any) => ["strong", "moderate", "limited"].includes(p.confidence)), "every pattern states its evidence strength");
  });
});

describe("document uploads", () => {
  test("a PDF is identified, previewed without saving, then confirmed into Hindsight", LONG, async () => {
    const pdf = makePdf([
      ["Call notes - Solace Insurance Group", "Diane Foster (CFO) reviewed our migration cost analysis and called it credible.", "She still compares us with LogiTrack's renewal price."],
      ["Raj Malhotra asked for a two-year price lock.", "I promised a revised quote with a two-year price lock by Friday."],
    ]);
    const before = ok(await get("/customers/cus_solace"), "solace before").interactions.length;
    const p = ok(await upload("solace-call.pdf", pdf, { occurredAt: new Date().toISOString() }), "extract");
    assert.equal(p.file.pages, 2);
    assert.equal(p.identification.customer?.id, "cus_solace", JSON.stringify(p.identification));
    assert.equal(p.needsCustomer, false);
    assert.ok(p.analysis?.summary, "preview has an analysis");
    assert.equal(ok(await get("/customers/cus_solace"), "solace mid").interactions.length, before, "nothing saved before confirm");

    const saved = ok(await post(`/documents/${p.draftId}/confirm`), "confirm");
    assert.equal(saved.memoryStatus, "stored", saved.memoryError);
    const snap = ok(await get("/customers/cus_solace"), "solace after");
    const doc = snap.interactions.find((i: any) => i.kind === "document");
    assert.ok(doc, "document interaction saved");
    assert.equal(doc.analysis.source.fileName, "solace-call.pdf");
    assert.match(doc.raw_text, /\[Page 2\]/, "page markers kept for provenance");

    const map = ok(await get("/customers/cus_solace/memory-map"), "map");
    assert.ok(map.nodes.some((n: any) => n.source.file === "solace-call.pdf"), "document memories trace back to the file");
    assert.equal((await post(`/documents/${p.draftId}/confirm`)).status, 404, "a draft can only be confirmed once");
  });

  test("a document naming no account asks the user to choose", LONG, async () => {
    const docx = makeDocx([{ text: "Discovery notes", heading: true }, { text: "The logistics manager wants supplier shipment tracking to replace a shared spreadsheet." }]);
    const p = ok(await upload("notes.docx", docx), "extract");
    assert.equal(p.needsCustomer, true);
    assert.equal(p.customer, null);
    assert.equal(p.analysis, null);
    assert.equal((await post(`/documents/${p.draftId}/confirm`)).status, 400, "cannot confirm without a customer");
    const a = ok(await post(`/documents/${p.draftId}/analyze`, { customerId: "cus_kestrel" }), "analyze for chosen account");
    assert.equal(a.customer.id, "cus_kestrel");
    assert.ok(a.analysis?.summary);
    ok(await post(`/documents/${p.draftId}/discard`), "discard");
    assert.equal((await post(`/documents/${p.draftId}/confirm`)).status, 404, "discarded draft is gone");
  });

  test("unsupported and unreadable files are rejected", async () => {
    assert.equal((await upload("image.png", Buffer.from("not really a png"))).status, 400);
    assert.equal((await upload("empty.txt", Buffer.from("  "))).status, 422);
  });
});

describe("knowledge map", () => {
  test("shows only the selected account's memories, with recorded links and categories", LONG, async () => {
    const map = ok(await get("/customers/cus_halcyon/memory-map"), "map");
    assert.ok(map.nodes.length > 0);
    assert.equal(map.categories.reduce((s: number, c: any) => s + c.count, 0), map.nodes.length, "every memory has one category");
    const ids = new Set(map.nodes.map((n: any) => n.id));
    assert.ok(map.links.every((l: any) => ids.has(l.source) && ids.has(l.target)), "links stay inside the account");
    for (const n of map.nodes) assert.doesNotMatch(n.text, /Meridian|Angela Ruiz|Tom Becker|Solace/, `leaked: ${n.text}`);
    assert.ok(map.nodes.some((n: any) => n.stakeholders.length > 0), "stakeholders are attached");
  });
});

describe("demo reset", () => {
  test("reset clears the demo account in CRM and Hindsight", LONG, async () => {
    ok(await post("/demo/reset"), "reset");
    const acct = ok(await get("/customers/cus_halcyon"), "account");
    assert.equal(acct.interactions.length, 0);
    assert.equal(acct.commitments.length, 0);
    const m = ok(await get("/customers/cus_halcyon/memory"), "memory after reset");
    assert.equal(m.total, 0);
  });
});
