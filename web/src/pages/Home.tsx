import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { AlertTriangle, ArrowUp, ArrowUpRight, Brain, Info, Sparkles, X } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, daysAgo, fmtDate, fmtMoney, type AskResult, type Commitment, type Deal, type Rep } from "../api";
import { setLastRetrieval, useApi } from "../hooks";
import { useUser } from "../auth";
import { Badge, Card, ErrorBox, MD, MemoryRow, Select, Skeleton, Spinner, Stat } from "../components/ui";

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

interface Turn {
  q: string;
  r?: AskResult;
  error?: string;
}

const SUGGESTIONS = [
  "Why is Halcyon Logistics not closing?",
  "What have I promised customers that is still open?",
  "Which deals are at risk and why?",
  "What did Meridian's CISO ask for?",
  "Have we offered Solace a discount before?",
];

const tooltipStyle = { background: "#0b0c10", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12, color: "#e7e9ee" };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Home() {
  const me = useUser();
  const { data, error, loading, reload } = useApi<OverviewData>("/overview");
  const { data: team } = useApi<(Rep & { interactions: number })[]>("/reps");
  const m = data?.metrics;

  return (
    <div className="space-y-10">
      <section className="mx-auto max-w-3xl pt-6 text-center md:pt-12">
        <div className="text-sm text-mute">
          {greeting()}, <span className="text-soft">{me.name.split(" ")[0]}</span>
        </div>
        <h1 className="mt-2 text-[30px] font-semibold tracking-tight text-white md:text-[36px]">What do you want to know about your deals?</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-mute">Answers come from everything your team has logged with each customer, with the memories behind every answer.</p>
        <AskBox />
      </section>

      <section className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-white">Pipeline at a glance</h2>
            <p className="mt-0.5 text-xs text-mute">Your CRM remembers what happened. RevenueOS remembers why, and what you promised to do next.</p>
          </div>
        </div>

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

        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-3" title="AI insights" subtitle="Found by connecting CRM state with what customers actually said">
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

          <Card className="lg:col-span-2" title="Promises coming due" subtitle="Tracked from what the team said in meetings">
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
                    <Badge tone={c.overdue ? "bad" : "warn"}>{fmtDate(c.due_date)}</Badge>
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

        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Pipeline by stage">
            <div className="h-52">
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
            <div className="h-52">
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
          <Card title="Your team" subtitle="Everyone logging into the shared customer memory">
            {!team ? (
              <Skeleton className="h-40" />
            ) : (
              <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                {[...team]
                  .sort((a, b) => b.interactions - a.interactions)
                  .map((r) => (
                    <div key={r.id} className="flex items-center gap-3">
                      <div className={clsx("grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold", r.id === me.id ? "bg-accent-2/40 text-white" : "bg-white/[0.06] text-soft")}>
                        {r.name
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((p) => p[0])
                          .join("")
                          .toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] text-soft">
                          {r.name}
                          {r.id === me.id && <span className="text-mute"> (you)</span>}
                        </div>
                        <div className="truncate text-[11px] text-mute">{r.title}</div>
                      </div>
                      <span className="font-mono text-xs text-mute">{r.interactions}</span>
                    </div>
                  ))}
              </div>
            )}
          </Card>
        </div>

        <Card title="Open deals" subtitle="Negotiation status across the pipeline">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] [&_td]:pr-4 [&_th]:pr-4">
              <thead className="text-[11px] uppercase tracking-[0.08em] text-mute">
                <tr>
                  <th className="pb-3 font-medium">Account</th>
                  <th className="pb-3 font-medium">Stage</th>
                  <th className="pb-3 font-medium">Amount</th>
                  <th className="pb-3 font-medium">Real blocker</th>
                  <th className="pb-3 font-medium">Last touch</th>
                  <th className="pb-3 font-medium">Risk</th>
                  <th className="pb-3" />
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
                      <td className="whitespace-nowrap py-2.5 font-mono text-soft">{fmtMoney(d.amount)}</td>
                      <td className="max-w-[260px] py-2.5 text-xs text-soft">{d.primaryBlocker ?? <span className="text-mute">—</span>}</td>
                      <td className="py-2.5 text-xs text-mute">{d.lastTouch ? `${daysAgo(d.lastTouch)}d ago` : "never"}</td>
                      <td className="py-2.5">
                        <Badge tone={d.risk === "high" ? "bad" : d.risk === "medium" ? "warn" : "good"}>{d.risk}</Badge>
                      </td>
                      <td className="whitespace-nowrap py-2.5 text-right">
                        <Link to={`/negotiate?customer=${d.customerId}`} className="text-xs text-accent hover:underline">
                          Negotiate →
                        </Link>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </div>
  );
}

function AskBox() {
  const { data: customers } = useApi<{ id: string; name: string }[]>("/customers");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState("");
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Grow the textarea with its content (up to a limit).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [q]);

  async function send(question = q) {
    if (!question.trim() || busy) return;
    setQ("");
    setBusy(true);
    setTurns((t) => [{ q: question }, ...t]);
    try {
      const r = await api.post<AskResult>("/ask", { question, customerId: scope || null, compare });
      setTurns((t) => t.map((x, i) => (i === 0 ? { ...x, r } : x)));
      setLastRetrieval({ source: "Ask RevenueOS", question, customerId: r.customer?.id ?? null, at: new Date().toISOString(), memories: r.evidence });
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === 0 ? { ...x, error: e instanceof Error ? e.message : String(e) } : x)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 text-left">
      <div className="rounded-3xl border border-line-2 bg-panel/90 p-2 shadow-[0_30px_80px_-30px_rgb(99_102_241/0.45)] backdrop-blur transition focus-within:border-accent/40">
        <textarea
          ref={inputRef}
          rows={2}
          className="block w-full resize-none bg-transparent px-4 pt-3 text-[15px] leading-relaxed text-white outline-none placeholder:text-mute"
          placeholder="Why is this deal stuck? What did their CTO ask for? What did I promise them?"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-2 px-2 pb-1 pt-2">
          <Select value={scope} onChange={setScope} className="rounded-full !py-1.5 text-xs">
            <option value="">All accounts · auto-detect</option>
            {customers?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <label className="flex cursor-pointer items-center gap-2 rounded-full border border-line-2 px-3 py-1.5 text-xs text-mute transition hover:text-soft">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="accent-indigo-500" />
            Compare with no-memory answer
          </label>
          <button
            onClick={() => send()}
            disabled={!q.trim() || busy}
            aria-label="Ask"
            className="ml-auto grid h-9 w-9 place-items-center rounded-full bg-accent-2 text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>

      {turns.length === 0 && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full border border-line bg-white/[0.02] px-3.5 py-1.5 text-xs text-soft transition hover:border-accent/40 hover:text-white"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {turns.length > 0 && (
        <div className="mt-6 space-y-6">
          <div className="flex justify-end">
            <button onClick={() => setTurns([])} disabled={busy} className="flex items-center gap-1 text-[11px] text-mute hover:text-soft disabled:opacity-40">
              <X className="h-3 w-3" /> Clear answers
            </button>
          </div>
          {turns.map((t, i) => (
            <AnswerTurn key={turns.length - i} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function AnswerTurn({ t }: { t: Turn }) {
  return (
    <div className="fade-in space-y-3">
      <div className="flex items-start gap-2 text-[14px] font-medium text-white">
        <Sparkles className="mt-1 h-3.5 w-3.5 shrink-0 text-accent" />
        {t.q}
      </div>
      {!t.r && !t.error && <Spinner label="Recalling and reasoning over the team's memory…" />}
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
              <Brain className="h-3.5 w-3.5 text-mem" />
              <Badge tone="mem">{t.r.scope === "account" ? t.r.customer?.name : "all accounts"}</Badge>
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
  );
}
