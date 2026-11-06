import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Search } from "lucide-react";
import { daysAgo, fmtMoney } from "../api";
import { useApi } from "../hooks";
import { ErrorBox, PageHeader, Segmented, Skeleton, StatusDot, inputCls } from "../components/ui";

interface CustomerRow {
  id: string;
  name: string;
  industry: string;
  employees: number;
  hq: string;
  deal: { name: string; amount: number; stage: string; probability: number; status: string; risk: string; primary_blocker: string | null } | null;
  last_touch: string | null;
  interaction_count: number;
  open_commitments: number;
}

type Filter = "all" | "open" | "risk" | "closed";

const dealTone = (c: CustomerRow) =>
  !c.deal ? "neutral" : c.deal.status === "won" ? "good" : c.deal.status === "lost" ? "neutral" : c.deal.risk === "high" ? "bad" : c.deal.risk === "medium" ? "warn" : "good";
const dealLabel = (c: CustomerRow) => (!c.deal ? "No deal" : c.deal.status === "open" ? `${c.deal.risk} risk` : c.deal.status === "won" ? "Won" : "Lost");

export default function Customers() {
  const { data, error, loading, reload } = useApi<CustomerRow[]>("/customers");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const rows = useMemo(
    () =>
      (data ?? [])
        .filter((c) => `${c.name} ${c.industry} ${c.hq}`.toLowerCase().includes(q.toLowerCase()))
        .filter((c) =>
          filter === "all" ? true : filter === "open" ? c.deal?.status === "open" : filter === "risk" ? c.deal?.status === "open" && c.deal.risk === "high" : c.deal && c.deal.status !== "open"
        ),
    [data, q, filter]
  );

  return (
    <div className="stagger">
      <PageHeader title="Customers" subtitle="Every account keeps its own private Hindsight memory. Open one to see what the team knows and log what happened next." />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-mute" />
          <input className={`${inputCls} pl-10`} placeholder="Search by name, industry or city" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "open", label: "Open deals" },
            { value: "risk", label: "High risk" },
            { value: "closed", label: "Closed" },
          ]}
        />
        <span className="ml-auto text-[13px] text-mute">{rows.length} accounts</span>
      </div>

      {error && <ErrorBox error={error} onRetry={reload} />}

      <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-card">
        <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1.6fr)_minmax(0,0.9fr)_24px] gap-4 border-b border-line px-6 py-3 text-[12px] font-medium text-mute lg:grid">
          <span>Account</span>
          <span>Deal</span>
          <span>Value</span>
          <span>Real blocker</span>
          <span>Activity</span>
          <span />
        </div>
        {loading && !data ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-10 text-center text-[14px] text-mute">No accounts match.</div>
        ) : (
          <ul className="stagger divide-y divide-line">
            {rows.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/customers/${c.id}`}
                  className="group grid gap-x-4 gap-y-2 px-6 py-4 transition hover:bg-fg/[0.025] lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1.6fr)_minmax(0,0.9fr)_24px] lg:items-center"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-medium text-fg">{c.name}</div>
                    <div className="mt-0.5 truncate text-[12.5px] text-mute">
                      {c.industry} · {c.employees.toLocaleString("en-US")} employees · {c.hq}
                    </div>
                  </div>
                  <div className="min-w-0 text-[13.5px]">
                    {c.deal ? (
                      <>
                        <div className="truncate text-soft">
                          {c.deal.stage} <span className="text-mute">· {c.deal.probability}%</span>
                        </div>
                        <div className="mt-1">
                          <StatusDot tone={dealTone(c)} label={dealLabel(c)} />
                        </div>
                      </>
                    ) : (
                      <span className="text-mute">No deal</span>
                    )}
                  </div>
                  <div className="font-mono text-[14px] text-fg">{c.deal ? fmtMoney(Number(c.deal.amount)) : "—"}</div>
                  <div className="min-w-0 text-[13px] leading-snug text-soft">
                    {c.deal?.primary_blocker ? <span className="line-clamp-2">{c.deal.primary_blocker}</span> : <span className="text-mute">Not identified</span>}
                  </div>
                  <div className="text-[12.5px] leading-relaxed text-mute">
                    <div>{c.interaction_count} interactions</div>
                    <div>{c.last_touch ? `${daysAgo(c.last_touch)}d since touch` : "No touches"}</div>
                    {c.open_commitments > 0 && <div className="text-warn">{c.open_commitments} open promises</div>}
                  </div>
                  <ChevronRight className="hidden h-4 w-4 text-mute transition group-hover:translate-x-0.5 group-hover:text-fg lg:block" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
