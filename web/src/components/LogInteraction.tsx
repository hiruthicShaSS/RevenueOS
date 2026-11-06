import { useRef, useState, type DragEvent } from "react";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, FileText, FileUp, PenLine, UploadCloud, X } from "lucide-react";
import { api, fmtDate, type DocPreview, type IngestResult } from "../api";
import { useUser } from "../auth";
import { useApi } from "../hooks";
import AnalysisView from "./AnalysisView";
import { Badge, Button, Card, ErrorBox, Segmented, Select, Spinner, inputCls } from "./ui";

const KINDS = [
  ["meeting", "Meeting notes"],
  ["call", "Call transcript or notes"],
  ["email", "Email"],
  ["note", "Note"],
  ["follow_up", "Follow-up"],
];
const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.csv,.eml";
const today = () => new Date().toISOString().slice(0, 10);

export default function LogInteraction({ customerId, customerName, onDone }: { customerId: string; customerName: string; onDone: () => void }) {
  const [mode, setMode] = useState<"write" | "upload">("write");
  return (
    <Card
      title="Log an interaction"
      subtitle="Notes, a call transcript, an email or a document. RevenueOS checks it against what it already remembers, then stores it in this account's memory."
      action={
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "write", label: <><PenLine className="h-3.5 w-3.5" /> Write</> },
            { value: "upload", label: <><FileUp className="h-3.5 w-3.5" /> Upload document</> },
          ]}
        />
      }
    >
      {mode === "write" ? <WriteForm customerId={customerId} onDone={onDone} /> : <UploadFlow pageCustomerId={customerId} pageCustomerName={customerName} onDone={onDone} />}
    </Card>
  );
}

/* ------------------------------------------------------------------ write */

function WriteForm({ customerId, onDone }: { customerId: string; onDone: () => void }) {
  const me = useUser();
  const [kind, setKind] = useState("meeting");
  const [date, setDate] = useState(today());
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.post<IngestResult>(`/customers/${customerId}/interactions`, { kind, text, occurredAt: new Date(`${date}T12:00:00Z`).toISOString() });
      setResult(r);
      setText("");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
        <Select value={kind} onChange={setKind} className="w-full !py-2.5">
          {KINDS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        <input type="date" className={inputCls} value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
      </div>
      <textarea
        className={`${inputCls} mt-4 min-h-[140px] resize-y leading-relaxed`}
        placeholder="e.g. Call with their CFO. She said the price is fine if we can guarantee go-live before their Q1 peak season. I promised to send a phased rollout plan by Thursday…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[13px] text-mute">
          {busy ? "Recalling earlier memory, extracting, writing to Hindsight…" : <>Logging as <span className="text-soft">{me.name}</span> · {me.title}</>}
        </div>
        <Button onClick={submit} loading={busy} disabled={text.trim().length < 15}>
          Analyse and remember
        </Button>
      </div>
      {error && (
        <div className="mt-4">
          <ErrorBox error={error} />
        </div>
      )}
      {result && (
        <div className="mt-6 border-t border-line pt-6">
          <SavedBanner result={result} />
          <AnalysisView a={result.analysis} />
        </div>
      )}
    </div>
  );
}

function SavedBanner({ result }: { result: IngestResult }) {
  const ok = result.memoryStatus === "stored";
  return (
    <div className={clsx("mb-5 flex flex-wrap items-center gap-2 rounded-xl px-4 py-3 text-[13.5px]", ok ? "bg-good/10 text-good" : "bg-bad/10 text-bad")}>
      {ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
      {ok ? "Saved and stored in Hindsight memory." : `Saved to the CRM, but the memory write failed: ${result.memoryError}`}
      <span className="text-mute">Compared against {result.recalledCount} earlier memories.</span>
    </div>
  );
}

/* ------------------------------------------------------------------ upload */

function UploadFlow({ pageCustomerId, pageCustomerName, onDone }: { pageCustomerId: string; pageCustomerName: string; onDone: () => void }) {
  const { data: customers } = useApi<{ id: string; name: string }[]>("/customers");
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState("");
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<null | "extract" | "analyze" | "confirm">(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DocPreview | null>(null);
  const [pick, setPick] = useState(pageCustomerId);
  const [saved, setSaved] = useState<IngestResult | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => {
    if (preview) api.post(`/documents/${preview.draftId}/discard`).catch(() => undefined);
    setFile(null);
    setPreview(null);
    setError(null);
    setDate("");
  };

  function choose(f: File | null | undefined) {
    if (!f) return;
    setSaved(null);
    setPreview(null);
    setError(null);
    if (f.size > 10 * 1024 * 1024) return setError("That file is larger than 10 MB.");
    setFile(f);
  }

  async function extract() {
    if (!file) return;
    setBusy("extract");
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (date) form.append("occurredAt", new Date(`${date}T12:00:00Z`).toISOString());
      const p = await api.upload<DocPreview>("/documents/extract", form);
      setPreview(p);
      setPick(p.identification?.candidates[0]?.id ?? pageCustomerId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function analyzeFor(customerId: string) {
    if (!preview) return;
    setBusy("analyze");
    setError(null);
    try {
      setPreview(await api.post<DocPreview>(`/documents/${preview.draftId}/analyze`, { customerId, occurredAt: date ? new Date(`${date}T12:00:00Z`).toISOString() : undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy("confirm");
    setError(null);
    try {
      const r = await api.post<IngestResult>(`/documents/${preview.draftId}/confirm`);
      setSaved(r);
      setPreview(null);
      setFile(null);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    choose(e.dataTransfer.files?.[0]);
  };

  // ---------- step 1: choose a file
  if (!preview) {
    return (
      <div>
        {saved && (
          <div className="mb-6">
            <SavedBanner result={saved} />
          </div>
        )}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          onClick={() => input.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          className={clsx(
            "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition",
            drag ? "border-accent bg-accent/[0.06]" : "border-line-2 hover:border-accent/60 hover:bg-fg/[0.02]"
          )}
        >
          <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
          {file ? (
            <>
              <FileText className="h-8 w-8 text-accent-strong dark:text-accent" />
              <div className="mt-3 text-[14.5px] font-medium text-fg">{file.name}</div>
              <div className="mt-1 text-[12.5px] text-mute">{(file.size / 1024).toFixed(0)} KB · click to choose another file</div>
            </>
          ) : (
            <>
              <UploadCloud className="h-8 w-8 text-mute" />
              <div className="mt-3 text-[14.5px] font-medium text-fg">Drop a document here, or click to browse</div>
              <div className="mt-1 text-[12.5px] text-mute">PDF, DOCX, TXT, Markdown, CSV or EML · up to 10 MB</div>
            </>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="text-[12.5px] text-mute">Interaction date (optional)</span>
            <input type="date" className={`${inputCls} mt-1.5 w-[180px]`} value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
          </label>
          <p className="max-w-sm pb-2 text-[12.5px] leading-relaxed text-mute">Leave empty to use the email's date, or today. Nothing is saved until you confirm the preview.</p>
          <Button className="ml-auto" onClick={extract} loading={busy === "extract"} disabled={!file}>
            {busy === "extract" ? "Reading and comparing with memory…" : "Extract and preview"}
          </Button>
        </div>
        {error && (
          <div className="mt-4">
            <ErrorBox error={error} />
          </div>
        )}
      </div>
    );
  }

  // ---------- step 2: preview
  const id = preview.identification;
  const mismatch = preview.customer && preview.customer.id !== pageCustomerId;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-line bg-raised px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <FileText className="mt-0.5 h-5 w-5 shrink-0 text-accent-strong dark:text-accent" />
          <div className="min-w-0">
            <div className="truncate text-[14.5px] font-medium text-fg">{preview.file.name}</div>
            <div className="mt-0.5 text-[12.5px] text-mute">
              {preview.file.format.toUpperCase()}
              {preview.file.pages ? ` · ${preview.file.pages} pages` : ""} · {preview.file.characters.toLocaleString("en-US")} characters
              {preview.occurredAt && ` · dated ${fmtDate(preview.occurredAt)}`}
            </div>
            {preview.file.truncated && <div className="mt-1 text-[12.5px] text-warn">Long document: only the first part was analysed.</div>}
          </div>
        </div>
        <button onClick={reset} className="flex items-center gap-1 text-[12.5px] text-mute hover:text-fg">
          <X className="h-3.5 w-3.5" /> Discard
        </button>
      </div>

      {/* customer identification */}
      <div>
        <div className="text-[13px] font-semibold text-fg">Customer</div>
        {preview.customer ? (
          <div className="mt-2 text-[13.5px] text-soft">
            <span className="font-medium text-fg">{preview.customer.name}</span>
            {id?.customer && id.customer.id === preview.customer.id ? (
              <span className="text-mute">
                {" "}
                · identified with {id.confidence} confidence ({id.reasons.join(", ")})
              </span>
            ) : (
              <span className="text-mute"> · chosen by you</span>
            )}
          </div>
        ) : (
          <div className="mt-2 rounded-xl border border-warn/30 bg-warn/[0.07] px-4 py-3 text-[13.5px] text-soft">
            {id?.confidence === "ambiguous"
              ? "This document mentions more than one account, so RevenueOS won't guess. Choose the account it belongs to."
              : "RevenueOS couldn't tell which account this document is about. Choose one."}
            {id && id.candidates.length > 0 && <div className="mt-1.5 text-[12.5px] text-mute">Mentions found: {id.candidates.map((c) => `${c.name} (${c.reasons.join(", ")})`).join("; ")}</div>}
          </div>
        )}
        {mismatch && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/[0.07] px-4 py-3 text-[13.5px] text-soft">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
            This document looks like it belongs to {preview.customer!.name}, not {pageCustomerName}. Confirming saves it to {preview.customer!.name}'s memory.
          </div>
        )}
        {(!preview.customer || mismatch) && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Select value={pick} onChange={setPick} className="min-w-[240px]">
              {customers?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Button variant="outline" onClick={() => analyzeFor(pick)} loading={busy === "analyze"}>
              Analyse for this account
            </Button>
          </div>
        )}
      </div>

      {busy === "analyze" && <Spinner label="Comparing with this account's memory…" />}

      {preview.analysis && busy !== "analyze" && (
        <div className="border-t border-line pt-6">
          <div className="mb-5 flex flex-wrap items-center gap-2 text-[13px] text-mute">
            <Badge tone="mem">Preview</Badge>
            Compared against {preview.recalledCount} earlier memories. Nothing has been saved yet.
            {preview.recallError && <span className="text-bad">Memory recall failed: {preview.recallError}</span>}
          </div>
          <AnalysisView a={preview.analysis} />
        </div>
      )}

      {error && <ErrorBox error={error} />}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-5">
        <Button variant="ghost" onClick={reset}>
          Cancel
        </Button>
        <Button onClick={confirm} loading={busy === "confirm"} disabled={!preview.analysis || busy === "analyze"}>
          Confirm and save to memory
        </Button>
      </div>
    </div>
  );
}
