import { useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { daysAgo, fmtMoney } from "../api";
import { useApi } from "../hooks";
import { Badge, ErrorBox, PageHeader, Skeleton, inputCls } from "../components/ui";

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

export default function Customers() {
  const { data, error, loading, reload } = useApi<CustomerRow[]>("/customers");
  const [q, setQ] = useState("");
  const rows = (data ?? []).filter((c) => `${c.name} ${c.industry}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Every account has its own isolated Hindsight memory bank."
        action={
          <div className="relative w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-mute" />
            <input className={`${inputCls} pl-9`} placeholder="Search accounts" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        }
      />
      {error && <ErrorBox error={error} onRetry={reload} />}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {loading && !data
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)
          : rows.map((c) => (
              <Link key={c.id} to={`/customers/${c.id}`} className="group rounded-2xl border border-line bg-panel/80 p-5 transition hover:border-line-2 hover:bg-panel-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[15px] font-semibold text-white group-hover:text-accent">{c.name}</div>
                    <div className="text-xs text-mute">
                      {c.industry} · {c.employees.toLocaleString()} employees · {c.hq}
                    </div>
                  </div>
                  {c.deal && <Badge tone={c.deal.status === "won" ? "good" : c.deal.status === "lost" ? "neutral" : c.deal.risk === "high" ? "bad" : c.deal.risk === "medium" ? "warn" : "good"}>{c.deal.status === "open" ? `risk ${c.deal.risk}` : c.deal.status}</Badge>}
                </div>
                {c.deal && (
                  <div className="mt-4 flex items-baseline justify-between">
                    <div className="text-xs text-soft">
                      {c.deal.stage} <span className="text-mute">· {c.deal.probability}%</span>
                    </div>
                    <div className="font-mono text-sm text-white">{fmtMoney(Number(c.deal.amount))}</div>
                  </div>
                )}
                {c.deal?.primary_blocker && <div className="mt-2 line-clamp-1 text-xs text-mem">Blocker: {c.deal.primary_blocker}</div>}
                <div className="mt-4 flex gap-4 border-t border-line pt-3 text-[11px] text-mute">
                  <span>{c.interaction_count} interactions</span>
                  <span>{c.open_commitments} open promises</span>
                  <span>{c.last_touch ? `${daysAgo(c.last_touch)}d since touch` : "no touches"}</span>
                </div>
              </Link>
            ))}
      </div>
    </div>
  );
}
