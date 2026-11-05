import { Link } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, Info } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { daysAgo, fmtDate, fmtMoney, type Commitment, type Deal } from "../api";
import { useApi } from "../hooks";
import GuidedDemo from "../components/GuidedDemo";
import { Badge, Card, ErrorBox, PageHeader, Skeleton, Stat } from "../components/ui";

interface OverviewData {
  metrics: {
    pipeline: number;
    expected: number;
    openDeals: number;
    atRiskCount: number;
    atRiskAmount: number;
    awaitingFollowUp: number;
    objectionExposure: number;
    overdueCommitments: number;
    upcomingCommitments: number;
  };
  byStage: { stage: string; amount: number; count: number }[];
  engagement: { week: string; interactions: number }[];
  insights: { severity: "high" | "medium" | "info"; title: string; detail: string; customerId?: string }[];
  atRisk: Deal[];
  upcoming: Commitment[];
  overdue: Commitment[];
  deals: Deal[];
}

const tooltipStyle = { background: "#0b0c10", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12, color: "#e7e9ee" };

export default function Overview() {
  const { data, error, loading, reload } = useApi<OverviewData>("/overview");
  const m = data?.metrics;

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" subtitle="Your CRM remembers what happened. RevenueOS remembers why — and what you promised to do next." />

      {error && <ErrorBox error={error} onRetry={reload} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {loading && !m ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)
        ) : m ? (
          <>
            <Stat label="Open pipeline" value={fmtMoney(m.pipeline)} hint={`${m.openDeals} open deals`} />
            <Stat label="Expected revenue" value={fmtMoney(m.expected)} hint="probability-weighted" />
            <Stat label="Deals at risk" value={m.atRiskCount} tone={m.atRiskCount ? "bad" : undefined} hint={`${fmtMoney(m.atRiskAmount)} exposed`} />
            <Stat label="Unresolved objections" value={fmtMoney(m.objectionExposure)} tone="warn" hint="pipeline with open objections" />
            <Stat label="Promises overdue" value={m.overdueCommitments} tone={m.overdueCommitments ? "bad" : "good"} hint={`${m.upcomingCommitments} due in 7 days`} />
          </>
        ) : null}
      </div>

      <GuidedDemo onChange={reload} />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="AI insights" subtitle="Patterns found by connecting CRM state with what customers actually said">
          {!data ? (
            <Skeleton className="h-40" />
          ) : data.insights.length === 0 ? (
            <div className="text-sm text-mute">No risks detected.</div>
          ) : (
            <div className="space-y-2.5">
              {data.insights.map((i, k) => (
                <Link
                  key={k}
                  to={i.customerId ? `/customers/${i.customerId}` : "#"}
                  className="group flex gap-3 rounded-xl border border-line bg-white/[0.015] p-3.5 transition hover:border-line-2 hover:bg-white/[0.03]"
                >
                  {i.severity === "high" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-bad" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-warn" />}
                  <div className="flex-1">
                    <div className="text-[13px] font-medium text-white">{i.title}</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-mute">{i.detail}</div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-mute opacity-0 transition group-hover:opacity-100" />
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2" title="Promises coming due" subtitle="Tracked from what reps said in meetings">
          {!data ? (
            <Skeleton className="h-40" />
          ) : (
            <div className="space-y-2">
              {[...data.overdue, ...data.upcoming].slice(0, 7).map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-3 border-b border-line pb-2 last:border-0">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] text-soft">{c.description}</div>
                    <div className="text-[11px] text-mute">
                      {c.customer} · {c.owner} → {c.promised_to ?? "customer"}
                    </div>
                  </div>
                  <Badge tone={c.due_date && c.due_date < new Date().toISOString().slice(0, 10) ? "bad" : "warn"}>{fmtDate(c.due_date)}</Badge>
                </div>
              ))}
              {data.overdue.length + data.upcoming.length === 0 && <div className="text-sm text-mute">Nothing due this week.</div>}
              <Link to="/commitments" className="block pt-1 text-xs text-accent hover:underline">
                All commitments →
              </Link>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Pipeline by stage">
          <div className="h-56">
            {data && (
              <ResponsiveContainer>
                <BarChart data={data.byStage.filter((s) => !s.stage.startsWith("Closed"))} margin={{ left: -10 }}>
                  <XAxis dataKey="stage" tick={{ fill: "#8a8f9c", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => fmtMoney(v)} tick={{ fill: "#8a8f9c", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.03)" }} formatter={(v) => fmtMoney(Number(v))} />
                  <Bar dataKey="amount" fill="#6366f1" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
        <Card title="Customer engagement" subtitle="Logged interactions per week">
          <div className="h-56">
            {data && (
              <ResponsiveContainer>
                <AreaChart data={data.engagement} margin={{ left: -20 }}>
                  <defs>
                    <linearGradient id="eng" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#c084fc" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#c084fc" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="week" tickFormatter={(w) => fmtDate(w).replace(/, \d{4}/, "")} tick={{ fill: "#8a8f9c", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: "#8a8f9c", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area dataKey="interactions" stroke="#c084fc" fill="url(#eng)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <Card title="Open deals" subtitle="Negotiation status across the pipeline">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-[0.08em] text-mute">
              <tr>
                <th className="pb-3 font-medium">Account</th>
                <th className="pb-3 font-medium">Stage</th>
                <th className="pb-3 font-medium">Amount</th>
                <th className="pb-3 font-medium">Real blocker</th>
                <th className="pb-3 font-medium">Last touch</th>
                <th className="pb-3 font-medium">Risk</th>
              </tr>
            </thead>
            <tbody>
              {data?.deals
                .filter((d) => d.status === "open")
                .map((d) => (
                  <tr key={d.id} className="border-t border-line">
                    <td className="py-2.5">
                      <Link to={`/customers/${d.customerId}`} className="font-medium text-white hover:text-accent">
                        {d.customer}
                      </Link>
                      <div className="text-[11px] text-mute">{d.owner}</div>
                    </td>
                    <td className="py-2.5 text-soft">
                      {d.stage} <span className="text-mute">· {d.probability}%</span>
                    </td>
                    <td className="py-2.5 font-mono text-soft">{fmtMoney(d.amount)}</td>
                    <td className="max-w-[260px] py-2.5 text-xs text-soft">{d.primaryBlocker ?? <span className="text-mute">—</span>}</td>
                    <td className="py-2.5 text-xs text-mute">{d.lastTouch ? `${daysAgo(d.lastTouch)}d ago` : "never"}</td>
                    <td className="py-2.5">
                      <Badge tone={d.risk === "high" ? "bad" : d.risk === "medium" ? "warn" : "good"}>{d.risk}</Badge>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
