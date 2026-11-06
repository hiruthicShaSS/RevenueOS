import { randomBytes } from "node:crypto";
import path from "node:path";
import { getDb } from "../db.js";
import { HttpError } from "../util.js";
import { analyzeInteraction, persistInteraction, type AnalyzedInteraction } from "./ingest.js";
import type { User } from "./auth.js";

/**
 * Uploaded documents go through the SAME memory pipeline as typed interactions
 * (recall -> extraction -> CRM + Hindsight), with a preview step in between:
 *
 *   extract  : read the file, find the customer, run analysis (nothing saved yet)
 *   analyze  : run analysis for a customer the user picked (when we were not sure)
 *   confirm  : persist the previewed analysis and retain the document into Hindsight
 */

export const SUPPORTED = ["pdf", "docx", "txt", "md", "markdown", "csv", "eml"] as const;
const MAX_CHARS = 14_000; // keeps one extraction inside a free-tier LLM's per-minute token budget
const DRAFT_TTL_MS = 30 * 60_000;

export interface ExtractedDoc {
  fileName: string;
  format: string;
  text: string;
  pages: number | null;
  truncated: boolean;
  /** From an email's Date header, when present. */
  documentDate: string | null;
}

interface Draft {
  userId: string;
  doc: ExtractedDoc;
  analyzed: AnalyzedInteraction | null;
  expires: number;
}
const drafts = new Map<string, Draft>();

function sweep() {
  const now = Date.now();
  for (const [k, d] of drafts) if (d.expires < now) drafts.delete(k);
}

// ---------------------------------------------------------------- text extraction

export async function extractText(fileName: string, buf: Buffer): Promise<ExtractedDoc> {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  if (!(SUPPORTED as readonly string[]).includes(ext)) {
    throw new HttpError(400, `Unsupported file type ".${ext}". Upload PDF, DOCX, TXT, Markdown, CSV or EML.`);
  }
  let text = "";
  let pages: number | null = null;
  let documentDate: string | null = null;

  if (ext === "pdf") {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const r = await pdfText(pdf, { mergePages: false });
    const list = Array.isArray(r.text) ? r.text : [r.text];
    pages = r.totalPages ?? list.length;
    text = list.map((t, i) => `[Page ${i + 1}]\n${t.trim()}`).join("\n\n");
  } else if (ext === "docx") {
    const mammoth = await import("mammoth");
    // HTML keeps headings, which become [Section: ...] markers for provenance.
    const { value: html } = await mammoth.convertToHtml({ buffer: buf });
    text = html
      .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, (_m, h) => `\n[Section: ${stripTags(h)}]\n`)
      .replace(/<\/(p|li|tr)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "");
    text = decodeEntities(text);
  } else if (ext === "eml") {
    const { simpleParser } = await import("mailparser");
    const mail = await simpleParser(buf);
    documentDate = mail.date ? mail.date.toISOString() : null;
    const addr = (a: any) => (a ? (Array.isArray(a) ? a : [a]).map((x: any) => x.text).join(", ") : "");
    text = [
      `From: ${addr(mail.from)}`,
      `To: ${addr(mail.to)}`,
      mail.cc ? `Cc: ${addr(mail.cc)}` : "",
      mail.date ? `Date: ${mail.date.toUTCString()}` : "",
      `Subject: ${mail.subject ?? ""}`,
      "",
      mail.text ?? stripTags(String(mail.html ?? "")),
    ]
      .filter((l, i) => l !== "" || i === 5)
      .join("\n");
  } else {
    text = buf.toString("utf8").replace(/^﻿/, "");
    if (ext === "md" || ext === "markdown") text = text.replace(/^(#{1,6})\s+(.+)$/gm, (_m, _h, t) => `[Section: ${t.trim()}]`);
  }

  text = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.replace(/\[(Page \d+|Section: [^\]]*)\]/g, "").trim().length < 15) {
    throw new HttpError(422, "No readable text found in this file. Scanned PDFs need OCR before upload.");
  }
  const truncated = text.length > MAX_CHARS;
  if (truncated) text = text.slice(0, MAX_CHARS) + "\n[... document truncated for analysis ...]";
  return { fileName, format: ext === "markdown" ? "md" : ext, text, pages, truncated, documentDate };
}

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, "")).trim();
const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");

// ---------------------------------------------------------------- customer identification

/**
 * Deterministic and explainable: counts mentions of each account's name, distinctive name word,
 * website domain and known stakeholders. Never guesses: if no account clearly leads, the user picks.
 */
export async function identifyCustomer(text: string) {
  const db = await getDb();
  const customers = await db.query<{ id: string; name: string; website: string | null }>(`SELECT id, name, website FROM customers`);
  const people = await db.query<{ customer_id: string; name: string }>(`SELECT customer_id, name FROM stakeholders`);
  const hay = text.toLowerCase();
  const count = (needle: string) => {
    const n = needle.toLowerCase().trim();
    if (n.length < 3) return 0;
    const re = new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "g");
    return (hay.match(re) ?? []).length;
  };
  const GENERIC = new Set(["group", "partners", "services", "health", "foods", "insurance", "credit", "union", "energy", "logistics", "components", "aerospace", "the", "and"]);

  const scored = customers
    .map((c) => {
      const reasons: string[] = [];
      let score = 0;
      const full = count(c.name);
      if (full) (score += 5 * full), reasons.push(`name "${c.name}" ×${full}`);
      const word = c.name.split(/\s+/)[0];
      if (!GENERIC.has(word.toLowerCase())) {
        const w = count(word) - full;
        if (w > 0) (score += 2 * w), reasons.push(`"${word}" ×${w}`);
      }
      if (c.website) {
        const d = count(c.website.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
        if (d) (score += 4 * d), reasons.push(`domain ${c.website} ×${d}`);
      }
      for (const p of people.filter((p) => p.customer_id === c.id)) {
        const k = count(p.name);
        if (k) (score += 3 * k), reasons.push(`stakeholder ${p.name} ×${k}`);
      }
      return { id: c.id, name: c.name, score, reasons };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  const [top, second] = scored;
  const confident = !!top && top.score >= 4 && (!second || top.score >= second.score * 2);
  return {
    customer: confident ? { id: top.id, name: top.name } : null,
    confidence: !top ? "none" : confident ? (top.score >= 8 ? "high" : "medium") : "ambiguous",
    reasons: top?.reasons ?? [],
    candidates: scored.slice(0, 5).map(({ id, name, score, reasons }) => ({ id, name, score, reasons })),
  };
}

// ---------------------------------------------------------------- draft lifecycle

function preview(draftId: string, d: Draft, identification: Awaited<ReturnType<typeof identifyCustomer>> | null) {
  const a = d.analyzed;
  return {
    draftId,
    file: { name: d.doc.fileName, format: d.doc.format, pages: d.doc.pages, truncated: d.doc.truncated, characters: d.doc.text.length },
    documentDate: d.doc.documentDate,
    excerpt: d.doc.text.slice(0, 1200),
    identification,
    needsCustomer: !a,
    customer: a ? { id: a.customer.id, name: a.customer.name } : null,
    occurredAt: a ? a.occurredAt.toISOString() : null,
    recalledCount: a?.prior.length ?? 0,
    recallError: a?.recallError ?? null,
    analysis: a ? { ...a.analysis, connections: a.connections, contradictions: a.contradictions } : null,
  };
}

async function runAnalysis(d: Draft, customerId: string, user: User, occurredAt?: string) {
  d.analyzed = await analyzeInteraction({
    customerId,
    repId: user.id,
    kind: "document",
    text: d.doc.text,
    occurredAt: occurredAt ?? d.doc.documentDate ?? undefined,
    source: { fileName: d.doc.fileName, format: d.doc.format, pages: d.doc.pages, truncated: d.doc.truncated },
  });
}

export async function extractDocument(file: { originalname: string; buffer: Buffer }, user: User, opts: { customerId?: string; occurredAt?: string }) {
  sweep();
  const doc = await extractText(file.originalname, file.buffer);
  const identification = await identifyCustomer(doc.text);
  const draftId = randomBytes(12).toString("hex");
  const d: Draft = { userId: user.id, doc, analyzed: null, expires: Date.now() + DRAFT_TTL_MS };
  drafts.set(draftId, d);
  const customerId = opts.customerId || identification.customer?.id;
  if (customerId) await runAnalysis(d, customerId, user, opts.occurredAt);
  return preview(draftId, d, identification);
}

function getDraft(draftId: string, user: User) {
  sweep();
  const d = drafts.get(draftId);
  if (!d || d.userId !== user.id) throw new HttpError(404, "This upload preview has expired. Upload the file again.");
  return d;
}

/** Re-run analysis for a customer the user chose (or a corrected date). */
export async function analyzeDraft(draftId: string, user: User, customerId: string, occurredAt?: string) {
  const d = getDraft(draftId, user);
  await runAnalysis(d, customerId, user, occurredAt);
  return preview(draftId, d, null);
}

export async function confirmDraft(draftId: string, user: User) {
  const d = getDraft(draftId, user);
  if (!d.analyzed) throw new HttpError(400, "Choose the customer this document belongs to first.");
  const result = await persistInteraction(d.analyzed);
  drafts.delete(draftId);
  return result;
}

export function discardDraft(draftId: string, user: User) {
  const d = drafts.get(draftId);
  if (d && d.userId === user.id) drafts.delete(draftId);
  return { ok: true };
}
