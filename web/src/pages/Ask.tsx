import { useEffect, useRef, useState } from "react";
import { Brain, Send, User } from "lucide-react";
import clsx from "clsx";
import { api, type AskResult } from "../api";
import { setLastRetrieval, useApi } from "../hooks";
import { Badge, Button, ErrorBox, MD, MemoryRow, PageHeader, Select, Spinner } from "../components/ui";

const SUGGESTIONS = [
  "Why is Halcyon Logistics not closing? What should I do next?",
  "What promises have we made to Halcyon Logistics that we haven't fulfilled?",
  "Have we offered Solace Insurance a discount before? How did it go?",
  "What did Meridian's CISO ask for?",
  "Which commitments are overdue across all accounts?",
  "Which deals could close this month?",
  "Which customers rejected our pricing and why?",
];

interface Turn {
  q: string;
  r?: AskResult;
  error?: string;
}

export default function Ask() {
  const { data: customers } = useApi<{ id: string; name: string }[]>("/customers");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState("");
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Block body on purpose: newer browsers return a Promise from scrollIntoView, which React would treat as a cleanup function.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  async function send(question = q) {
    if (!question.trim() || busy) return;
    setQ("");
    setBusy(true);
    setTurns((t) => [...t, { q: question }]);
    try {
      const r = await api.post<AskResult>("/ask", { question, customerId: scope || null, compare });
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, r } : x)));
      setLastRetrieval({ source: "Ask RevenueOS", question, customerId: r.customer?.id ?? null, at: new Date().toISOString(), memories: r.evidence });
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: e instanceof Error ? e.message : String(e) } : x)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <PageHeader
        title="Ask RevenueOS"
        subtitle="Questions about one account are answered by Hindsight reflect over that account's memory only. Portfolio questions use CRM data."
        action={
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-mute">
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="accent-indigo-500" />
              Compare with no-memory answer
            </label>
            <Select value={scope} onChange={setScope}>
              <option value="">Auto-detect account</option>
              {customers?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pb-4">
        {turns.length === 0 && (
          <div className="mx-auto mt-6 max-w-2xl text-center">
            <Brain className="mx-auto h-8 w-8 text-mem" />
            <div className="mt-3 text-sm text-soft">Ask anything about your customers. Every answer shows the memories it was built on.</div>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-line-2 bg-white/[0.02] px-3.5 py-1.5 text-xs text-soft transition hover:border-accent/40 hover:text-white">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className="space-y-3 fade-in">
            <div className="flex justify-end">
              <div className="flex max-w-[80%] items-start gap-2 rounded-2xl rounded-tr-sm bg-accent-2/20 px-4 py-2.5 text-[13.5px] text-white">
                {t.q}
                <User className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              </div>
            </div>
            {!t.r && !t.error && <Spinner label="Recalling and reasoning over memory…" />}
            {t.error && <ErrorBox error={t.error} />}
            {t.r && (
              <div className={clsx("grid gap-4", t.r.baseline && "lg:grid-cols-2")}>
                {t.r.baseline && (
                  <div className="rounded-2xl border border-line bg-panel/60 p-5">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-mute">Without memory</div>
                    <MD>{t.r.baseline}</MD>
                  </div>
                )}
                <div className="rounded-2xl border border-mem/25 bg-panel/80 p-5">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-mute">
                    <Badge tone="mem">{t.r.scope === "account" ? t.r.customer?.name : "portfolio"}</Badge>
                    <span>{t.r.engine}</span>
                    <span className="font-mono">{(t.r.ms / 1000).toFixed(1)}s</span>
                  </div>
                  <MD>{t.r.answer}</MD>
                  {t.r.evidence.length > 0 && (
                    <details className="mt-4 border-t border-line pt-3">
                      <summary className="cursor-pointer text-xs text-mem">
                        {t.r.scope === "portfolio" ? `Playbook lessons consulted (${t.r.evidence.length})` : `Built on ${t.r.evidence.length} memories`}
                      </summary>
                      <div className="mt-3 space-y-2">
                        {t.r.evidence.map((m) => (
                          <MemoryRow key={m.id} m={m} compact />
                        ))}
                      </div>
                    </details>
                  )}
                  {t.r.accounts && t.r.accounts.length > 0 && <div className="mt-3 text-[11px] text-mute">Accounts referenced: {t.r.accounts.join(", ")}</div>}
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="flex gap-2 border-t border-line pt-4">
        <input
          className="flex-1 rounded-xl border border-line-2 bg-panel-2 px-4 py-3 text-[13.5px] text-white outline-none placeholder:text-mute focus:border-accent/50"
          placeholder="Why is this deal stuck? What did their CTO ask for? What did we promise?"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <Button onClick={() => send()} loading={busy} className="px-5">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
