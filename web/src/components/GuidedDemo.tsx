import { useState } from "react";
import { Link } from "react-router-dom";
import { Brain, CheckCircle2, ChevronDown, Circle, RotateCcw, Sparkles } from "lucide-react";
import clsx from "clsx";
import { api, fmtDate, type AccountSnapshot, type AskResult, type IngestResult, type Rep } from "../api";
import { setLastRetrieval, useApi } from "../hooks";
import AnalysisView from "./AnalysisView";
import { Badge, Button, Card, ErrorBox, MD, MemoryRow } from "./ui";

interface Script {
  customerId: string;
  steps: { title: string; repId: string; kind: string; occurredAt: string; text: string }[];
  question: string;
}

/**
 * The three-step proof of persistent memory:
 * two separate interactions by two different reps, then a question that can
 * only be answered by connecting both. Progress is read from the server, so it
 * survives page reloads and server restarts.
 */
export default function GuidedDemo({ onChange }: { onChange?: () => void }) {
  const { data: script } = useApi<Script>("/demo/script");
  const { data: reps } = useApi<Rep[]>("/reps");
  const { data: account, reload } = useApi<AccountSnapshot>(script ? `/customers/${script.customerId}` : null, [script?.customerId]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<number, IngestResult>>({});
  const [answer, setAnswer] = useState<AskResult | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const done = account?.interactions.length ?? 0;
  const repName = (id: string) => reps?.find((r) => r.id === id)?.name ?? id;


  async function runStep(i: number) {
    if (!script) return;
    const s = script.steps[i];
    setBusy(i);
    setError(null);
    try {
      const r = await api.post<IngestResult>(`/customers/${script.customerId}/interactions`, {
        repId: s.repId,
        kind: s.kind,
        text: s.text,
        occurredAt: s.occurredAt,
      });
      setResults((p) => ({ ...p, [i]: r }));
      setOpen(i);
      await reload();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function ask() {
    if (!script) return;
    setBusy(2);
    setError(null);
    try {
      const r = await api.post<AskResult>("/ask", { question: script.question, customerId: script.customerId, compare: true });
      setAnswer(r);
      setLastRetrieval({ source: "Guided demo · Ask", question: script.question, customerId: script.customerId, at: new Date().toISOString(), memories: r.evidence });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    if (!confirm("Reset the Halcyon Logistics demo account? This deletes its CRM interactions and its Hindsight memory bank.")) return;
    setBusy(-1);
    try {
      await api.post("/demo/reset");
      setResults({});
      setAnswer(null);
      setOpen(null);
      await reload();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!script) return null;

  return (
    <Card
      className="border-accent/20 bg-gradient-to-b from-accent-2/[0.06] to-panel/80"
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" /> Memory test: Halcyon Logistics
        </span>
      }
      subtitle="Two conversations, two different reps, two weeks apart. Then one question that only memory can answer."
      action={
        <Button variant="ghost" onClick={reset} loading={busy === -1}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Button>
      }
    >
      <div className="space-y-3">
        {script.steps.map((s, i) => {
          const isDone = done > i;
          const result = results[i];
          const stored = account?.interactions[account.interactions.length - 1 - i];
          return (
            <div key={i} className={clsx("rounded-xl border p-4 transition", isDone ? "border-good/20 bg-good/[0.03]" : done === i ? "border-accent/30 bg-white/[0.02]" : "border-line opacity-60")}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  {isDone ? <CheckCircle2 className="h-4 w-4 text-good" /> : <Circle className="h-4 w-4 text-mute" />}
                  <div>
                    <div className="text-[13px] font-medium text-white">{s.title}</div>
                    <div className="text-xs text-mute">
                      {repName(s.repId)} · {s.kind} · {fmtDate(s.occurredAt)}
                    </div>
                  </div>
                </div>
                {!isDone ? (
                  <Button onClick={() => runStep(i)} loading={busy === i} disabled={done !== i || busy !== null}>
                    {busy === i ? "Analysing & storing in Hindsight…" : `Log as ${repName(s.repId).split(" ")[0]}`}
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    {stored && <Badge tone={stored.memory_status === "stored" ? "mem" : "bad"}>{stored.memory_status === "stored" ? "in Hindsight" : `memory ${stored.memory_status}`}</Badge>}
                    {(result || stored?.analysis) && (
                      <button onClick={() => setOpen(open === i ? null : i)} className="flex items-center gap-1 text-xs text-mute hover:text-white">
                        what it extracted <ChevronDown className={clsx("h-3.5 w-3.5 transition", open === i && "rotate-180")} />
                      </button>
                    )}
                  </div>
                )}
              </div>
              <p className="mt-3 rounded-lg border border-line bg-black/30 px-3 py-2 text-[12.5px] leading-relaxed text-soft">"{s.text}"</p>
              {open === i && (result?.analysis || stored?.analysis) && (
                <div className="mt-4 border-t border-line pt-4">
                  {result && (
                    <div className="mb-3 text-xs text-mute">
                      Recalled {result.recalledCount} prior memories before analysing.
                      {result.memoryError && <span className="text-bad"> Memory write failed: {result.memoryError}</span>}
                    </div>
                  )}
                  <AnalysisView a={(result?.analysis ?? stored!.analysis)!} />
                </div>
              )}
            </div>
          );
        })}

        <div className={clsx("rounded-xl border p-4", done >= 2 ? "border-mem/30 bg-mem/[0.03]" : "border-line opacity-60")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Brain className="h-4 w-4 text-mem" />
              <div>
                <div className="text-[13px] font-medium text-white">Conversation 3 — the memory test</div>
                <div className="text-xs text-mute">New session. Works after a full restart too.</div>
              </div>
            </div>
            <Button onClick={ask} loading={busy === 2} disabled={done < 2 || busy !== null}>
              {busy === 2 ? "Reflecting over memory…" : "Ask"}
            </Button>
          </div>
          <p className="mt-3 text-[13px] font-medium text-white">“{script.question}”</p>
          {answer && (
            <div className="mt-4 grid gap-4 lg:grid-cols-2 fade-in">
              <div className="rounded-xl border border-line bg-black/30 p-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-mute">Without memory (stateless LLM)</div>
                <MD>{answer.baseline ?? ""}</MD>
              </div>
              <div className="rounded-xl border border-mem/30 bg-mem/[0.04] p-4">
                <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-mem">
                  <span>With Hindsight memory</span>
                  <span className="font-mono normal-case tracking-normal text-mute">
                    {answer.engine} · {(answer.ms / 1000).toFixed(1)}s
                  </span>
                </div>
                <MD>{answer.answer}</MD>
              </div>
              {answer.evidence.length > 0 && (
                <div className="lg:col-span-2">
                  <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-mute">
                    <span>Memories this answer was built on ({answer.evidence.length})</span>
                    <Link to="/memory" className="normal-case tracking-normal text-accent hover:underline">
                      open Memory Explorer →
                    </Link>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {answer.evidence.slice(0, 8).map((m) => (
                      <MemoryRow key={m.id} m={m} compact />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {error && <ErrorBox error={error} />}
      </div>
    </Card>
  );
}
