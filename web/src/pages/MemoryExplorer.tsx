import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Database, Search, Sparkles } from "lucide-react";
import clsx from "clsx";
import { api, fmtDate, type AccountSnapshot, type MemoryHit } from "../api";
import { useApi, useLastRetrieval } from "../hooks";
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, MemoryRow, Select, Skeleton, inputCls } from "../components/ui";

interface MemoryData {
  bank: string;
  mode: string;
  total: number;
  items: MemoryHit[];
  error: string | null;
  stakeholders: AccountSnapshot["stakeholders"];
  interactions: AccountSnapshot["interactions"];
}

const TYPES = [
  ["all", "All"],
  ["world", "Facts"],
  ["experience", "Interactions"],
  ["observation", "Consolidated observations"],
];

export default function MemoryExplorer() {
  const [params, setParams] = useSearchParams();
  const customerId = params.get("customer") ?? "cus_halcyon";
  const { data: customers } = useApi<{ id: string; name: string }[]>("/customers");
  const { data, error, loading, reload } = useApi<MemoryData>(`/customers/${customerId}/memory`, [customerId]);
  const last = useLastRetrieval();
  const [type, setType] = useState("all");
  const [query, setQuery] = useState("");
  const [probe, setProbe] = useState<{ hits: MemoryHit[]; ms: number; query: string } | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeErr, setProbeErr] = useState<string | null>(null);

  const items = useMemo(() => (data?.items ?? []).filter((m) => type === "all" || m.type === type), [data, type]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (data?.items ?? []).forEach((m) => (c[m.type ?? "other"] = (c[m.type ?? "other"] ?? 0) + 1));
    return c;
  }, [data]);

  // Entity co-occurrence: who appears alongside whom in remembered facts.
  const graph = useMemo(() => {
    const names = new Set((data?.stakeholders ?? []).map((s) => s.name));
    const pair = new Map<string, number>();
    const mentions = new Map<string, number>();
    for (const m of data?.items ?? []) {
      const ents = [...new Set(m.entities.filter((e) => names.has(e) || [...names].some((n) => e.includes(n.split(" ")[0]))))];
      ents.forEach((e) => mentions.set(e, (mentions.get(e) ?? 0) + 1));
      for (let i = 0; i < ents.length; i++)
        for (let j = i + 1; j < ents.length; j++) {
          const k = [ents[i], ents[j]].sort().join(" ↔ ");
          pair.set(k, (pair.get(k) ?? 0) + 1);
        }
    }
    return { mentions: [...mentions.entries()].sort((a, b) => b[1] - a[1]), pairs: [...pair.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8) };
  }, [data]);

  async function runProbe() {
    if (query.trim().length < 2) return;
    setProbing(true);
    setProbeErr(null);
    try {
      const r = await api.post<{ hits: MemoryHit[]; ms: number; query: string }>(`/customers/${customerId}/recall`, { query });
      setProbe(r);
    } catch (e) {
      setProbeErr(e instanceof Error ? e.message : String(e));
    } finally {
      setProbing(false);
    }
  }

  const customerName = customers?.find((c) => c.id === customerId)?.name ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Memory Explorer"
        subtitle="Exactly what RevenueOS remembers about an account, straight from its Hindsight memory bank."
        action={
          <div className="flex items-center gap-2">
            <Select value={customerId} onChange={(v) => setParams({ customer: v })}>
              {customers?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Button variant="outline" onClick={reload}>
              Refresh
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniStat label="Memory bank" value={<span className="font-mono text-[12px]">{data?.bank ?? "…"}</span>} />
        <MiniStat label="Memories" value={data?.total ?? "…"} />
        <MiniStat label="Interactions retained" value={data ? `${data.interactions.filter((i) => i.memory_status === "stored").length} / ${data.interactions.length}` : "…"} />
        <MiniStat label="Observations" value={counts.observation ?? 0} hint="consolidated by Hindsight" />
      </div>

      {last && last.customerId === customerId && last.memories.length > 0 && (
        <Card
          className="border-mem/25"
          title={
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-mem" /> Recalled for the last answer
            </span>
          }
          subtitle={`${last.source} · “${last.question}”`}
        >
          <div className="grid gap-2 md:grid-cols-2">
            {[...last.memories]
              .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
              .slice(0, 10)
              .map((m) => (
                <div key={m.id + (m.ref ?? "")}>
                  <MemoryRow m={m} refLabel={m.ref} compact />
                  {m.score != null && (
                    <div className="mt-1 h-1 overflow-hidden rounded bg-white/5">
                      <div className="h-full bg-gradient-to-r from-accent-2 to-mem" style={{ width: `${Math.min(100, m.score * 100)}%` }} />
                    </div>
                  )}
                </div>
              ))}
          </div>
        </Card>
      )}

      <Card title="Recall probe" subtitle={`Run a live Hindsight recall against ${customerName}'s bank: semantic + keyword + graph + temporal retrieval, reranked.`}>
        <div className="flex gap-2">
          <input
            className={inputCls}
            placeholder="e.g. what did the CTO ask about integration?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runProbe()}
          />
          <Button onClick={runProbe} loading={probing}>
            <Search className="h-3.5 w-3.5" /> Recall
          </Button>
        </div>
        {probeErr && (
          <div className="mt-3">
            <ErrorBox error={probeErr} />
          </div>
        )}
        {probe && (
          <div className="mt-4 space-y-2">
            <div className="text-xs text-mute">
              {probe.hits.length} memories in {probe.ms} ms
            </div>
            {probe.hits.length === 0 && <div className="text-sm text-mute">Nothing relevant remembered.</div>}
            {probe.hits.map((h, i) => (
              <div key={h.id} className="grid grid-cols-[1fr_150px] items-start gap-3">
                <MemoryRow m={h} refLabel={`#${i + 1}`} compact />
                <ScoreBars h={h} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card
          title="Everything remembered"
          action={
            <div className="flex flex-wrap gap-1">
              {TYPES.map(([k, l]) => (
                <button key={k} onClick={() => setType(k)} className={clsx("rounded-md px-2 py-1 text-[11px]", type === k ? "bg-white/10 text-white" : "text-mute hover:text-white")}>
                  {l} {k !== "all" && <span className="font-mono">{counts[k] ?? 0}</span>}
                </button>
              ))}
            </div>
          }
        >
          {error && <ErrorBox error={error} onRetry={reload} />}
          {data?.error && <ErrorBox error={data.error} />}
          {loading && !data ? (
            <Skeleton className="h-64" />
          ) : items.length === 0 ? (
            <Empty icon={<Database className="h-6 w-6" />} title="No memories yet">
              Log an interaction for this account. Hindsight extracts facts, links entities and builds observations as it learns.
            </Empty>
          ) : (
            <div className="space-y-2">
              {[...items]
                .sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""))
                .map((m) => (
                  <MemoryRow key={m.id} m={m} />
                ))}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Timeline" subtitle="Interactions that fed this memory">
            {data?.interactions.length ? (
              <ol className="relative space-y-4 border-l border-line pl-4">
                {[...data.interactions].reverse().map((i) => (
                  <li key={i.id}>
                    <span className={clsx("absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full border-2 border-ink", i.memory_status === "stored" ? "bg-mem" : "bg-mute")} />
                    <div className="text-[11px] text-mute">
                      {fmtDate(i.occurred_at)} · {i.rep_name} · {i.kind}
                    </div>
                    <div className="mt-0.5 line-clamp-3 text-[12.5px] text-soft">{i.analysis?.summary ?? i.raw_text}</div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="text-xs text-mute">No interactions.</div>
            )}
          </Card>
          <Card title="People & relationships" subtitle="Entities Hindsight linked across memories">
            {graph.mentions.length === 0 ? (
              <div className="text-xs text-mute">No linked people yet.</div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  {graph.mentions.map(([n, c]) => {
                    const s = data?.stakeholders.find((x) => x.name === n || n.includes(x.name.split(" ")[0]));
                    return (
                      <div key={n} className="flex items-center justify-between text-[13px]">
                        <span className="text-white">
                          {n} {s?.role && <span className="text-xs text-mute">· {s.role}</span>}
                        </span>
                        <Badge tone="mem">{c} memories</Badge>
                      </div>
                    );
                  })}
                </div>
                {graph.pairs.length > 0 && (
                  <div className="border-t border-line pt-3">
                    <div className="mb-1.5 text-[11px] uppercase tracking-[0.08em] text-mute">Appear together</div>
                    {graph.pairs.map(([k, c]) => (
                      <div key={k} className="flex justify-between text-xs text-soft">
                        <span>{k}</span>
                        <span className="font-mono text-mute">{c}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel/80 px-4 py-3">
      <div className="text-[10.5px] uppercase tracking-[0.08em] text-mute">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold text-white">{value}</div>
      {hint && <div className="text-[10.5px] text-mute">{hint}</div>}
    </div>
  );
}

function ScoreBars({ h }: { h: MemoryHit }) {
  const rows: [string, number | null | undefined][] = [
    ["final", h.score],
    ["semantic", h.scoreBreakdown?.semantic],
    ["keyword", h.scoreBreakdown?.keyword],
    ["rerank", h.scoreBreakdown?.reranker],
  ];
  return (
    <div className="space-y-1 pt-1">
      {rows
        .filter(([, v]) => v != null)
        .map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 text-[10px] text-mute">
            <span className="w-12">{k}</span>
            <div className="h-1 flex-1 overflow-hidden rounded bg-white/5">
              <div className={clsx("h-full", k === "final" ? "bg-mem" : "bg-accent-2/70")} style={{ width: `${Math.max(2, Math.min(100, (v as number) * 100))}%` }} />
            </div>
            <span className="w-8 text-right font-mono">{(v as number).toFixed(2)}</span>
          </div>
        ))}
    </div>
  );
}
