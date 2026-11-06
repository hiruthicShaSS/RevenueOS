import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { AlertTriangle, ArrowRight, ArrowUp, Brain, FileText, Info, Mail, MessageSquare, Phone, StickyNote, Users, X } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, daysAgo, fmtDate, fmtMoney, type AskResult, type Commitment, type Deal, type Rep } from "../api";
import { setLastRetrieval, useApi } from "../hooks";
import { useUser } from "../auth";
import { useTokens, type Tokens } from "../theme";
import { AnimatedNumber, Badge, Card, ErrorBox, MD, MemoryRow, SectionTitle, Select, Skeleton, Spinner, Stat, StatusDot } from "../components/ui";

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
    wonAmount: number;
  };
  byStage: { stage: string; amount: number; count: number }[];
  engagement: { week: string; interactions: number }[];
  insights: { severity: "high" | "medium" | "info"; title: string; detail: string; customerId?: string }[];
  upcoming: Commitment[];
  overdue: Commitment[];
  deals: Deal[];
  recentActivity: { id: string; kind: string; occurredAt: string; customerId: string; customer: string; rep: string | null; repTitle: string | null; summary: string | null; file: string | null }[];
  accountActivity: { customerId: string; customer: string; last30: number; lastTouch: string | null; risk: string | null; amount: number }[];
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
];

const riskTone = (r: string | null) => (r === "high" ? "bad" : r === "medium" ? "warn" : "good") as "bad" | "warn" | "good";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Home() {
  const me = useUser();
  const t = useTokens();
  const { data, error, loading, reload } = useApi<OverviewData>("/overview");
  const { data: team } = useApi<(Rep & { interactions: number })[]>("/reps");
  const m = data?.metrics;

  return (
    <div className="space-y-12">
      <section className="stagger mx-auto max-w-3xl pt-2 text-center md:pt-6">
        <div className="text-[14px] text-mute">
          {greeting()}, <span className="font-medium text-soft">{me.name.split(" ")[0]}</span>
        </div>
        <h1 className="mt-3 text-[30px] font-semibold leading-[1.15] tracking-[-0.025em] text-fg md:text-[36px]">What do you want to know about your deals?</h1>
        <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-mute">
          Answers draw on everything your team has logged with each customer, and show the memories behind them.
        </p>
        <AskBox />
      </section>

      <section>
        <SectionTitle title="Pipeline at a glance" subtitle="Your CRM remembers what happened. RevenueOS remembers why, and what you promised to do next." />
        {error && <ErrorBox error={error} onRetry={reload} />}

        <div className="stagger grid grid-cols-2 gap-5 lg:grid-cols-[1.25fr_1.25fr_1fr_1fr_1fr]">
          {loading && !m ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[118px]" />)
          ) : m ? (
            <>
              <Stat emphasis label="Open pipeline" value={<AnimatedNumber value={m.pipeline} format={fmtMoney} />} hint={`${m.openDeals} open deals`} />
              <Stat emphasis label="Expected revenue" value={<AnimatedNumber value={m.expected} format={fmtMoney} />} hint="Probability-weighted" tone="good" />
              <Stat label="Deals at risk" value={<AnimatedNumber value={m.atRiskCount} />} tone={m.atRiskCount ? "bad" : undefined} hint={`${fmtMoney(m.atRiskAmount)} exposed`} />
              <Stat label="Open objections" value={<AnimatedNumber value={m.objectionExposure} format={fmtMoney} />} tone="warn" hint="Pipeline affected" />
              <Stat label="Promises overdue" value={<AnimatedNumber value={m.overdueCommitments} />} tone={m.overdueCommitments ? "bad" : "good"} hint={`${m.upcomingCommitments} due in 7 days`} />
            </>
          ) : null}
        </div>

        <div className="stagger mt-6 grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-3" tone="mem" title="AI insights" subtitle="Found by connecting CRM state with what customers actually said">
            {!data ? (
              <Skeleton className="h-48" />
            ) : data.insights.length === 0 ? (
              <div className="text-[14px] text-mute">No risks detected.</div>
            ) : (
              <div className="stagger space-y-2.5">
                {data.insights.slice(0, 5).map((i, k) => (
                  <Link
                    key={k}
                    to={i.customerId ? `/customers/${i.customerId}` : "#"}
                    className="lift group flex gap-3.5 rounded-xl border border-line bg-raised px-4 py-3.5 hover:border-line-2"
                  >
                    {i.severity === "high" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-bad" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-warn" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-medium text-fg">{i.title}</div>
                      <div className="mt-1 text-[13px] leading-relaxed text-mute">{i.detail}</div>
                    </div>
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-mute opacity-0 transition group-hover:opacity-100" />
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card
            className="lg:col-span-2"
            title="Promises coming due"
            subtitle="Tracked from what the team said in meetings"
            action={
              <Link to="/commitments" className="text-[13px] font-medium text-accent-strong hover:underline dark:text-accent">
                View all
              </Link>
            }
          >
            {!data ? (
              <Skeleton className="h-48" />
            ) : data.overdue.length + data.upcoming.length === 0 ? (
              <div className="text-[14px] text-mute">Nothing due this week.</div>
            ) : (
              <ul className="divide-y divide-line">
                {[...data.overdue, ...data.upcoming].slice(0, 6).map((c) => {
                  const overdue = !!c.due_date && c.due_date < new Date().toISOString().slice(0, 10);
                  return (
                    <li key={c.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <div className="text-[14px] leading-snug text-fg">{c.description}</div>
                        <div className="mt-1 truncate text-[12.5px] text-mute">
                          {c.customer} · {c.owner}
                        </div>
                      </div>
                      <StatusDot tone={overdue ? "bad" : "warn"} label={(overdue ? "Overdue " : "Due ") + fmtDate(c.due_date).replace(/, \d{4}/, "")} />
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="stagger mt-6 grid gap-6 lg:grid-cols-3">
          <Card title="Pipeline by stage" subtitle="Open deal value">
            <div className="h-56">{data && <StageChart data={data.byStage.filter((s) => !s.stage.startsWith("Closed"))} t={t} />}</div>
          </Card>
          <Card title="Customer engagement" subtitle="Interactions logged per week">
            <div className="h-56">{data && <EngagementChart data={data.engagement} t={t} />}</div>
          </Card>
          <Card title="Customer activity" subtitle="Touches in the last 30 days">
            {!data ? (
              <Skeleton className="h-56" />
            ) : (
              <ul className="space-y-3.5">
                {data.accountActivity.slice(0, 6).map((a) => {
                  const max = Math.max(1, ...data.accountActivity.map((x) => x.last30));
                  return (
                    <li key={a.customerId}>
                      <div className="flex items-center justify-between gap-3 text-[13.5px]">
                        <Link to={`/customers/${a.customerId}`} className="truncate text-fg hover:underline">
                          {a.customer}
                        </Link>
                        <span className="shrink-0 font-mono text-[12.5px] text-mute">{a.last30}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fg/[0.06]">
                        <div
                          className={clsx("bar-grow h-full rounded-full", a.risk === "high" ? "bg-bad/70" : a.risk === "medium" ? "bg-warn/70" : "bg-good/70")}
                          style={{ width: `${Math.max(4, (a.last30 / max) * 100)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="stagger mt-6 grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2" title="Recent activity" subtitle="What the team logged most recently">
            {!data ? (
              <Skeleton className="h-60" />
            ) : data.recentActivity.length === 0 ? (
              <div className="text-[14px] text-mute">Nothing logged yet.</div>
            ) : (
              <ol className="stagger relative space-y-5 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-line">
                {data.recentActivity.slice(0, 6).map((r) => (
                  <li key={r.id} className="relative flex gap-4">
                    <KindIcon kind={r.kind} />
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
                        <Link to={`/customers/${r.customerId}`} className="font-medium text-fg hover:underline">
                          {r.customer}
                        </Link>
                        <span className="text-mute">
                          {r.file ? `document · ${r.file}` : r.kind.replace("_", " ")} · {r.rep ?? "unknown"} · {fmtDate(r.occurredAt)}
                        </span>
                      </div>
                      {r.summary && <p className="mt-1 line-clamp-2 text-[13.5px] leading-relaxed text-soft">{r.summary}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Card title="Your team" subtitle="Everyone writing into shared customer memory">
            {!team ? (
              <Skeleton className="h-60" />
            ) : (
              <ul className="space-y-3">
                {[...team]
                  .sort((a, b) => b.interactions - a.interactions)
                  .slice(0, 7)
                  .map((r) => (
                    <li key={r.id} className="flex items-center gap-3">
                      <div
                        className={clsx(
                          "grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                          r.id === me.id ? "bg-accent text-on-accent" : "bg-fg/[0.07] text-soft"
                        )}
                      >
                        {r.name
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((p) => p[0])
                          .join("")
                          .toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] text-fg">
                          {r.name}
                          {r.id === me.id && <span className="text-mute"> (you)</span>}
                        </div>
                        <div className="truncate text-[12px] text-mute">{r.title}</div>
                      </div>
                      <span className="font-mono text-[12.5px] text-mute" title="Interactions logged">
                        {r.interactions}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </div>

        <Card className="mt-6" title="Open deals" subtitle="Negotiation status across the pipeline">
          {!data ? <Skeleton className="h-60" /> : <DealsTable deals={data.deals.filter((d) => d.status === "open")} />}
        </Card>
      </section>
    </div>
  );
}

function KindIcon({ kind }: { kind: string }) {
  const Icon = kind === "email" ? Mail : kind === "call" ? Phone : kind === "document" ? FileText : kind === "meeting" ? Users : kind === "note" ? StickyNote : MessageSquare;
  return (
    <div className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-raised text-mute">
      <Icon className="h-3.5 w-3.5" />
    </div>
  );
}

function DealsTable({ deals }: { deals: Deal[] }) {
  return (
    <>
      <table className="hidden w-full table-fixed text-left text-[13.5px] md:table">
        <colgroup>
          <col className="w-[23%]" />
          <col className="w-[16%]" />
          <col className="w-[11%]" />
          <col />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[96px]" />
        </colgroup>
        <thead className="text-[12px] text-mute">
          <tr className="border-b border-line">
            <th className="pb-3 pr-4 font-medium">Account</th>
            <th className="pb-3 pr-4 font-medium">Stage</th>
            <th className="pb-3 pr-4 font-medium">Amount</th>
            <th className="pb-3 pr-4 font-medium">Real blocker</th>
            <th className="pb-3 pr-4 font-medium">Last touch</th>
            <th className="pb-3 pr-4 font-medium">Risk</th>
            <th className="pb-3" />
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => (
            <tr key={d.id} className="border-b border-line last:border-0">
              <td className="py-3.5 pr-4 align-top">
                <Link to={`/customers/${d.customerId}`} className="font-medium text-fg hover:underline">
                  {d.customer}
                </Link>
                <div className="mt-0.5 text-[12.5px] text-mute">{d.owner}</div>
              </td>
              <td className="py-3.5 pr-4 align-top text-soft">
                {d.stage} <span className="text-mute">· {d.probability}%</span>
              </td>
              <td className="whitespace-nowrap py-3.5 pr-4 align-top font-mono text-fg">{fmtMoney(d.amount)}</td>
              <td className="py-3.5 pr-4 align-top text-[13px] leading-relaxed text-soft">{d.primaryBlocker ?? <span className="text-mute">Not identified</span>}</td>
              <td className="whitespace-nowrap py-3.5 pr-4 align-top text-[13px] text-mute">{d.lastTouch ? `${daysAgo(d.lastTouch)}d ago` : "never"}</td>
              <td className="py-3.5 pr-4 align-top">
                <StatusDot tone={riskTone(d.risk)} label={d.risk} />
              </td>
              <td className="py-3.5 text-right align-top">
                <Link to={`/negotiate?customer=${d.customerId}`} className="whitespace-nowrap text-[13px] font-medium text-accent-strong hover:underline dark:text-accent">
                  Negotiate
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="space-y-3 md:hidden">
        {deals.map((d) => (
          <li key={d.id} className="rounded-xl border border-line bg-raised p-4">
            <div className="flex items-start justify-between gap-3">
              <Link to={`/customers/${d.customerId}`} className="font-medium text-fg">
                {d.customer}
              </Link>
              <span className="font-mono text-[13.5px] text-fg">{fmtMoney(d.amount)}</span>
            </div>
            <div className="mt-1 text-[12.5px] text-mute">
              {d.stage} · {d.probability}% · {d.owner}
            </div>
            {d.primaryBlocker && <div className="mt-2 text-[13px] text-soft">{d.primaryBlocker}</div>}
            <div className="mt-3 flex items-center justify-between">
              <StatusDot tone={riskTone(d.risk)} label={`${d.risk} risk`} />
              <Link to={`/negotiate?customer=${d.customerId}`} className="text-[13px] font-medium text-accent-strong dark:text-accent">
                Negotiate
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

const tooltip = (t: Tokens) => ({
  contentStyle: { background: t.raised, border: `1px solid ${t.line}`, borderRadius: 10, fontSize: 12.5, color: t.fg, boxShadow: "none", padding: "8px 12px" },
  labelStyle: { color: t.mute, marginBottom: 4 },
  itemStyle: { color: t.fg },
});

function StageChart({ data, t }: { data: { stage: string; amount: number; count: number }[]; t: Tokens }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={t.grid} />
        <XAxis
          dataKey="stage"
          tick={{ fill: t.mute, fontSize: 11.5 }}
          axisLine={false}
          tickLine={false}
          interval={0}
          tickFormatter={(s: string) => (s === "Qualification" ? "Qualif." : s === "Negotiation" ? "Negot." : s)}
        />
        <YAxis width={52} tickFormatter={(v) => fmtMoney(v)} tick={{ fill: t.mute, fontSize: 11.5 }} axisLine={false} tickLine={false} />
        <Tooltip {...tooltip(t)} cursor={{ fill: t.grid }} formatter={(v) => [fmtMoney(Number(v)), "Value"]} />
        <Bar dataKey="amount" fill={t.accent} radius={[6, 6, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function EngagementChart({ data, t }: { data: { week: string; interactions: number }[]; t: Tokens }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="eng" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={t.good} stopOpacity={0.25} />
            <stop offset="100%" stopColor={t.good} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={t.grid} />
        <XAxis dataKey="week" tickFormatter={(w) => fmtDate(w).replace(/, \d{4}/, "")} tick={{ fill: t.mute, fontSize: 11.5 }} axisLine={false} tickLine={false} minTickGap={16} />
        <YAxis width={28} allowDecimals={false} tick={{ fill: t.mute, fontSize: 11.5 }} axisLine={false} tickLine={false} />
        <Tooltip {...tooltip(t)} labelFormatter={(w) => `Week of ${fmtDate(String(w))}`} formatter={(v) => [v, "Interactions"]} />
        <Area dataKey="interactions" stroke={t.good} fill="url(#eng)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
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
    <div className="mt-9 text-left">
      <div className="rounded-2xl border border-line-2 bg-raised p-2 shadow-card transition focus-within:border-accent">
        <textarea
          ref={inputRef}
          rows={2}
          className="block w-full resize-none bg-transparent px-4 pt-3 text-[16px] leading-relaxed text-fg outline-none placeholder:text-mute"
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
        <div className="flex flex-wrap items-center gap-2.5 px-2 pb-1.5 pt-3">
          <Select value={scope} onChange={setScope} className="!py-1.5 text-[13px]">
            <option value="">All accounts (auto-detect)</option>
            {customers?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line-2 px-3 py-1.5 text-[13px] text-mute transition hover:text-fg">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="accent-[var(--accent)]" />
            Compare with a no-memory answer
          </label>
          <button
            onClick={() => send()}
            disabled={!q.trim() || busy}
            aria-label="Ask"
            className="press ml-auto grid h-10 w-10 place-items-center rounded-xl bg-accent text-on-accent hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUp className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      {turns.length === 0 && (
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s)} className="press rounded-full border border-line-2 bg-panel px-4 py-2 text-[13px] text-soft hover:border-accent hover:text-fg">
              {s}
            </button>
          ))}
        </div>
      )}

      {turns.length > 0 && (
        <div className="mt-8 space-y-8">
          <div className="flex justify-end">
            <button onClick={() => setTurns([])} disabled={busy} className="flex items-center gap-1.5 text-[12.5px] text-mute hover:text-fg disabled:opacity-40">
              <X className="h-3.5 w-3.5" /> Clear answers
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
    <div className="fade-in space-y-3.5">
      <div className="text-[16px] font-medium text-fg">{t.q}</div>
      {!t.r && !t.error && <Spinner label="Recalling and reasoning over the team's memory…" />}
      {t.error && <ErrorBox error={t.error} />}
      {t.r && (
        <div className={clsx("grid gap-5", t.r.baseline && "lg:grid-cols-2")}>
          {t.r.baseline && (
            <div className="min-w-0 rounded-2xl border border-line bg-panel p-6">
              <div className="mb-3 text-[12.5px] font-medium text-mute">Without memory</div>
              <MD>{t.r.baseline}</MD>
            </div>
          )}
          <div className="min-w-0 rounded-2xl border border-mem/30 bg-panel p-6 shadow-card">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px] text-mute">
              <Brain className="h-4 w-4 text-mem" />
              <Badge tone="mem">{t.r.scope === "account" ? t.r.customer?.name : "All accounts"}</Badge>
              <span>{t.r.engine}</span>
              <span className="font-mono">{(t.r.ms / 1000).toFixed(1)}s</span>
            </div>
            <MD>{t.r.answer}</MD>
            {t.r.evidence.length > 0 && (
              <details className="mt-5 border-t border-line pt-4">
                <summary className="cursor-pointer text-[13px] font-medium text-mem">
                  {t.r.scope === "portfolio" ? `Playbook lessons consulted (${t.r.evidence.length})` : `Built on ${t.r.evidence.length} memories`}
                </summary>
                <div className="mt-3 space-y-2">
                  {t.r.evidence.map((m) => (
                    <MemoryRow key={m.id} m={m} compact />
                  ))}
                </div>
              </details>
            )}
            {t.r.accounts && t.r.accounts.length > 0 && <div className="mt-4 text-[12.5px] text-mute">Accounts referenced: {t.r.accounts.join(", ")}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
