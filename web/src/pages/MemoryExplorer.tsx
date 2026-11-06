import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { List, Network, RefreshCw, Search, X } from "lucide-react";
import { fmtDate } from "../api";
import { useApi, useLastRetrieval } from "../hooks";
import { useTheme, useTokens } from "../theme";
import KnowledgeMap, { categoryColor, matchesFilters, MemoryDetail, type MapData, type MapFilters } from "../components/KnowledgeMap";
import MemoryList from "../components/MemoryList";
import { Button, ErrorBox, PageHeader, Segmented, Select, Skeleton, inputCls } from "../components/ui";

const SINCE = [
  ["", "Any time"],
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
  ["365", "Last year"],
] as const;

export default function MemoryExplorer() {
  const [params, setParams] = useSearchParams();
  const last = useLastRetrieval();
  const customerId = params.get("customer") ?? last?.customerId ?? "cus_halcyon";
  const deepMemory = params.get("memory");
  const view = params.get("view") === "list" ? "list" : "map";
  const { resolved } = useTheme();
  const t = useTokens();
  const dark = resolved === "dark";

  const { data: customers } = useApi<{ id: string; name: string }[]>("/customers");
  const [reloadKey, setReloadKey] = useState(0);
  const { data, error, loading, reload } = useApi<MapData>(`/customers/${customerId}/memory-map`, [customerId, reloadKey]);

  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [stakeholder, setStakeholder] = useState("");
  const [sinceDays, setSinceDays] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [focusCategory, setFocusCategory] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  // Isolation: everything resets when the account changes.
  useEffect(() => {
    setQ("");
    setCategory("");
    setStakeholder("");
    setSinceDays("");
    setExpanded(new Set());
    setSelected(null);
    setFocusCategory(null);
  }, [customerId]);

  const filters: MapFilters = useMemo(
    () => ({ q, category, stakeholder, since: sinceDays ? new Date(Date.now() - Number(sinceDays) * 864e5).toISOString().slice(0, 10) : "" }),
    [q, category, stakeholder, sinceDays]
  );
  const filtering = !!(q || category || stakeholder || sinceDays);

  // While filtering, open every category that has a match.
  useEffect(() => {
    if (!data || !filtering) return;
    setExpanded(new Set(data.nodes.filter((n) => matchesFilters(n, filters)).map((n) => n.category)));
  }, [data, filters, filtering]);

  // Deep link from the Negotiator / Ask: open the memory's category and select it.
  useEffect(() => {
    if (!data || !deepMemory) return;
    const n = data.nodes.find((x) => x.id === deepMemory);
    setMissing(!n);
    if (n) {
      setExpanded((s) => new Set([...s, n.category]));
      setSelected(n.id);
      setFocusCategory(n.category);
    }
  }, [data, deepMemory]);

  const setView = (v: "map" | "list") => {
    const p = new URLSearchParams(params);
    p.set("customer", customerId);
    if (v === "list") p.set("view", "list");
    else p.delete("view");
    setParams(p);
  };

  const toggle = (cat: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(cat)) n.delete(cat);
      else n.add(cat);
      return n;
    });

  const jump = (cat: string) => {
    setExpanded((s) => new Set([...s, cat]));
    setFocusCategory(null);
    window.setTimeout(() => setFocusCategory(cat), 0);
  };

  const select = (id: string | null) => {
    setSelected(id);
    if (id && data) {
      const n = data.nodes.find((x) => x.id === id);
      if (n && !expanded.has(n.category)) setExpanded((s) => new Set([...s, n.category]));
    }
  };

  const customerName = customers?.find((c) => c.id === customerId)?.name ?? data?.customer.name ?? "";
  const matchCount = data ? data.nodes.filter((n) => matchesFilters(n, filters)).length : 0;

  return (
    <div>
      <PageHeader
        title="Memory Explorer"
        subtitle="Explore what RevenueOS understands about an account, straight from its private Hindsight memory."
        action={
          <>
            <Select
              value={customerId}
              onChange={(v) => {
                const p = new URLSearchParams();
                p.set("customer", v);
                if (view === "list") p.set("view", "list");
                setParams(p);
              }}
              className="min-w-[220px]"
            >
              {customers?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "map", label: <><Network className="h-3.5 w-3.5" /> Knowledge map</> },
                { value: "list", label: <><List className="h-3.5 w-3.5" /> Memory list</> },
              ]}
            />
            <Button variant="ghost" onClick={() => (setReloadKey((k) => k + 1), reload())} title="Reload from Hindsight">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </>
        }
      />

      {view === "list" ? (
        <MemoryList customerId={customerId} customerName={customerName} reloadKey={reloadKey} />
      ) : (
        <>
          {error && <ErrorBox error={error} onRetry={reload} />}
          {loading && !data ? (
            <Skeleton className="h-[620px]" />
          ) : data ? (
            <div className="space-y-5">
              {/* summary + category shortcuts */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-mute">
                <span>
                  <span className="text-[20px] font-semibold text-fg">{data.total}</span> memories
                </span>
                <span>Last updated {data.lastUpdated ? fmtDate(data.lastUpdated) : "never"}</span>
                <span className="font-mono text-[12px]">{data.bank}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.categories.map((c) => (
                  <button
                    key={c.id}
                    disabled={!c.count}
                    onClick={() => jump(c.id)}
                    className={clsx(
                      "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] transition disabled:opacity-40",
                      expanded.has(c.id) ? "border-line-2 bg-raised text-fg shadow-card" : "border-line text-soft hover:border-line-2 hover:text-fg"
                    )}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: categoryColor(c.id, t, dark) }} />
                    {c.label}
                    <span className="font-mono text-[11px] text-mute">{c.count}</span>
                  </button>
                ))}
              </div>

              {/* search + filters */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative w-full max-w-xs">
                  <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-mute" />
                  <input className={`${inputCls} pl-10`} placeholder="Search all memories" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <Select value={category} onChange={setCategory}>
                  <option value="">All categories</option>
                  {data.categories.map((c) => (
                    <option key={c.id} value={c.id} disabled={!c.count}>
                      {c.label}
                    </option>
                  ))}
                </Select>
                <Select value={stakeholder} onChange={setStakeholder}>
                  <option value="">All stakeholders</option>
                  {data.stakeholders.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                <Select value={sinceDays} onChange={setSinceDays}>
                  {SINCE.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
                {filtering && (
                  <>
                    <span className="text-[13px] text-mute">{matchCount} match</span>
                    <button
                      onClick={() => {
                        setQ("");
                        setCategory("");
                        setStakeholder("");
                        setSinceDays("");
                        setExpanded(new Set());
                      }}
                      className="flex items-center gap-1 text-[13px] text-mute hover:text-fg"
                    >
                      <X className="h-3.5 w-3.5" /> Clear
                    </button>
                  </>
                )}
              </div>

              {missing && <div className="rounded-xl bg-warn/10 px-4 py-2.5 text-[13px] text-warn">The linked memory is no longer in this account's bank (Hindsight may have consolidated it).</div>}

              {data.total === 0 ? (
                <div className="rounded-2xl border border-dashed border-line-2 px-6 py-16 text-center text-[14px] text-mute">
                  Nothing remembered about {data.customer.name} yet. Log a conversation or upload a document on the customer page.
                </div>
              ) : (
                <div className={clsx("grid gap-5", selected && "xl:grid-cols-[minmax(0,1fr)_380px]")}>
                  <div className="h-[calc(100vh-330px)] min-h-[560px] min-w-0 overflow-hidden rounded-2xl border border-line bg-panel shadow-card">
                    <KnowledgeMap data={data} filters={filters} expanded={expanded} onToggle={toggle} selected={selected} onSelect={select} focusCategory={focusCategory} dark={dark} />
                  </div>
                  {selected && (
                    <aside className="h-[calc(100vh-330px)] min-h-[560px] min-w-0 overflow-hidden rounded-2xl border border-mem/30 bg-panel shadow-card">
                      <MemoryDetail data={data} id={selected} onSelect={select} onClose={() => setSelected(null)} dark={dark} />
                    </aside>
                  )}
                </div>
              )}
              <p className="text-[12.5px] text-mute">Click a category to expand it, a memory to see its source and relationships. Drag to pan, scroll to zoom.</p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
