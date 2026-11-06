import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { ArrowUpRight, Ban, BookOpenCheck, Footprints, MessageSquareQuote, ScanSearch, ShieldAlert, Target, Users } from "lucide-react";
import { api, fmtDate, type BriefResult, type Evidence } from "../api";
import { setLastRetrieval, useApi } from "../hooks";
import { Badge, Button, Card, Disclosure, Empty, ErrorBox, PageHeader, Select, Skeleton, StatusDot, inputCls, memorySource, typeLabel } from "../components/ui";

const VERDICT = {
  proceed: { label: "Proceed", tone: "good", note: "The evidence supports this move." },
  adjust: { label: "Adjust", tone: "warn", note: "Change the approach before moving forward." },
  hold: { label: "Hold", tone: "bad", note: "Don't make this move yet." },
} as const;

const SUGGESTIONS = ["Offer a 25% discount to close this month", "Push for signature next week", "Bring in our CTO for an executive call"];

export default function Negotiator() {
  const [params, setParams] = useSearchParams();
  const { data: customers } = useApi<{ id: string; name: string; deal: any }[]>("/customers");
  const openCustomers = (customers ?? []).filter((c) => c.deal?.status === "open");
  const customerId = params.get("customer") ?? "cus_halcyon";
  const [proposal, setProposal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BriefResult | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
  }, [customerId]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<BriefResult>(`/customers/${customerId}/negotiate`, { proposal });
      setResult(r);
      const mems = Object.entries(r.evidence)
        .filter(([, e]) => e.kind !== "commitment")
        .map(([ref, e]) => ({ ...(e as any), ref }));
      setLastRetrieval({ source: "Deal Negotiator", question: proposal || "How do I move this deal forward?", customerId, at: new Date().toISOString(), memories: mems });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const b = result?.brief;
  const v = b ? VERDICT[b.verdict] : null;
  const chips = (ev: string[]) => <EvidenceChips ev={ev} focus={focus} onFocus={setFocus} />;

  return (
    <div>
      <PageHeader title="Deal Negotiator" subtitle="Advice grounded in everything your team has heard from this account, plus what has won and lost on other deals. Every recommendation cites its evidence." />

      <Card>
        <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)_auto]">
          <Select value={customerId} onChange={(v) => setParams({ customer: v })} className="w-full !py-2.5">
            {openCustomers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <input
            className={inputCls}
            placeholder='The move you are considering (optional), e.g. "Offer 25% off to close this month"'
            value={proposal}
            onChange={(e) => setProposal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
          />
          <Button onClick={run} loading={busy} className="!py-2.5">
            {busy ? "Recalling history…" : "Get brief"}
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => setProposal(s)} className="rounded-full border border-line-2 px-3.5 py-1.5 text-[12.5px] text-soft transition hover:border-accent hover:text-fg">
              {s}
            </button>
          ))}
        </div>
      </Card>

      <div className="mt-8">
        {error && <ErrorBox error={error} onRetry={run} />}
        {busy && !result && (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Skeleton className="h-96" />
            <Skeleton className="h-96" />
          </div>
        )}
        {result?.empty && <Empty title="Nothing remembered yet">{result.message}</Empty>}

        {b && v && (
          <div className="fade-in grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 space-y-6">
              {/* 1-2: verdict and confidence */}
              <section className="rounded-2xl border border-line bg-panel p-7 shadow-card">
                <div className="flex flex-wrap items-start gap-x-10 gap-y-5">
                  <div>
                    <div className="text-[12.5px] text-mute">Deal verdict</div>
                    <div className={clsx("mt-1.5 text-[30px] font-semibold leading-none tracking-tight", v.tone === "good" ? "text-good" : v.tone === "warn" ? "text-warn" : "text-bad")}>{v.label}</div>
                    <div className="mt-2 text-[13px] text-mute">{v.note}</div>
                  </div>
                  <div>
                    <div className="text-[12.5px] text-mute">Confidence</div>
                    <ConfidenceMeter level={b.confidence} />
                  </div>
                  {result.recalled && (
                    <div className="ml-auto text-right text-[12.5px] leading-relaxed text-mute">
                      {result.recalled.account} account memories
                      <br />
                      {result.recalled.playbook} playbook lessons
                    </div>
                  )}
                </div>
                <h2 className="mt-6 max-w-[70ch] text-[19px] font-semibold leading-snug text-fg">{b.headline}</h2>
                {b.proposal_assessment && <p className="mt-3 max-w-[72ch] text-[14.5px] leading-relaxed text-soft">{b.proposal_assessment}</p>}
                {result.contributors && result.contributors.length > 0 && (
                  <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-[12.5px] text-mute">
                    <Users className="h-4 w-4" />
                    Built from notes logged by
                    {result.contributors.map((c) => (
                      <span key={c.name} className="rounded-full border border-line bg-raised px-2.5 py-0.5 text-soft" title={`${c.interactions} interaction(s), last ${fmtDate(c.last)}`}>
                        {c.name} <span className="text-mute">· {c.title}</span>
                      </span>
                    ))}
                  </div>
                )}
              </section>

              {/* 3-5: actual blocker, what they say, what memory reveals */}
              <div className="grid gap-5 md:grid-cols-3">
                <Tile icon={<Target className="h-4 w-4" />} label="Actual blocker" tone="mem">
                  <div className="text-[15px] font-medium leading-snug text-fg">{b.real_blocker}</div>
                </Tile>
                <Tile icon={<MessageSquareQuote className="h-4 w-4" />} label="What the customer says">
                  <div className="text-[14px] leading-relaxed text-soft">{b.stated_blocker || "No explicit objection recorded."}</div>
                </Tile>
                <Tile icon={<ScanSearch className="h-4 w-4" />} label="What memory reveals" tone="mem">
                  <div className="text-[14px] leading-relaxed text-soft">{b.memory_reveals?.text ?? "See the strategy and evidence below."}</div>
                  {b.memory_reveals?.evidence?.length ? <div className="mt-2.5">{chips(b.memory_reveals.evidence)}</div> : null}
                </Tile>
              </div>

              {/* 6: strategy */}
              <Card title={<Heading icon={<Footprints className="h-4 w-4 text-good" />}>Recommended strategy</Heading>} subtitle="In order. Expand a step for the reasoning and evidence.">
                <ol className="space-y-4">
                  {b.strategy.map((s, i) => (
                    <li key={i} className="flex gap-4">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-good/15 text-[13px] font-semibold text-good">{i + 1}</span>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <Disclosure
                          summary={
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <span className="text-[14.5px] font-medium text-fg">{s.step}</span>
                              {s.owner && <span className="text-[12.5px] text-mute">· {s.owner}</span>}
                            </div>
                          }
                        >
                          <p className="text-[13.5px] leading-relaxed text-soft">{s.why}</p>
                          <div className="mt-2">{chips(s.evidence)}</div>
                        </Disclosure>
                      </div>
                    </li>
                  ))}
                </ol>
              </Card>

              {/* 7: what not to do */}
              {b.do_not.length > 0 && (
                <Card title={<Heading icon={<Ban className="h-4 w-4 text-bad" />}>What not to do</Heading>}>
                  <ul className="space-y-4">
                    {b.do_not.map((d, i) => (
                      <li key={i}>
                        <Disclosure summary={<span className="text-[14.5px] font-medium text-fg">{d.action}</span>}>
                          <p className="text-[13.5px] leading-relaxed text-soft">{d.why}</p>
                          <div className="mt-2">{chips(d.evidence)}</div>
                        </Disclosure>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <div className="grid gap-6 lg:grid-cols-2">
                {/* 8: risks */}
                <Card title={<Heading icon={<ShieldAlert className="h-4 w-4 text-warn" />}>Risks</Heading>}>
                  {b.risks.length === 0 ? (
                    <p className="text-[13.5px] text-mute">No specific risks identified.</p>
                  ) : (
                    <ul className="space-y-4">
                      {b.risks.map((r, i) => (
                        <li key={i}>
                          <StatusDot tone={r.severity === "high" ? "bad" : r.severity === "medium" ? "warn" : "neutral"} label={`${r.severity} severity`} />
                          <p className="mt-1 text-[13.5px] leading-relaxed text-soft">{r.risk}</p>
                          <div className="mt-1.5">{chips(r.evidence)}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                {/* 9: stakeholder plan */}
                <Card title={<Heading icon={<Users className="h-4 w-4 text-accent-strong dark:text-accent" />}>Plan for each stakeholder</Heading>}>
                  {b.stakeholder_plan.length === 0 ? (
                    <p className="text-[13.5px] text-mute">No stakeholders identified yet.</p>
                  ) : (
                    <ul className="space-y-4">
                      {b.stakeholder_plan.map((s, i) => (
                        <li key={i}>
                          <div className="text-[14px] font-medium text-fg">{s.name}</div>
                          <p className="mt-1 text-[13.5px] leading-relaxed text-soft">{s.approach}</p>
                          <div className="mt-1.5">{chips(s.evidence)}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>

              {b.playbook_insight && (
                <Card title={<Heading icon={<BookOpenCheck className="h-4 w-4 text-accent-strong dark:text-accent" />}>What other deals teach</Heading>} subtitle="From the anonymised playbook shared across accounts">
                  <p className="text-[14px] leading-relaxed text-soft">{b.playbook_insight.text}</p>
                  <div className="mt-2">{chips(b.playbook_insight.evidence)}</div>
                </Card>
              )}
            </div>

            {/* 10: supporting evidence */}
            <EvidencePanel evidence={result.evidence} focus={focus} customerId={customerId} />
          </div>
        )}
      </div>
    </div>
  );
}

function Heading({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      {icon}
      {children}
    </span>
  );
}

function Tile({ icon, label, tone, children }: { icon: ReactNode; label: string; tone?: "mem"; children: ReactNode }) {
  return (
    <div className={clsx("min-w-0 rounded-2xl border bg-panel p-5 shadow-card", tone === "mem" ? "border-mem/30" : "border-line")}>
      <div className={clsx("mb-2.5 flex items-center gap-2 text-[12.5px] font-medium", tone === "mem" ? "text-mem" : "text-mute")}>
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

function ConfidenceMeter({ level }: { level: string }) {
  const n = level === "high" ? 3 : level === "medium" ? 2 : 1;
  return (
    <div className="mt-2.5 flex items-center gap-2.5">
      <div className="flex gap-1">
        {[1, 2, 3].map((i) => (
          <span key={i} className={clsx("h-2 w-7 rounded-full", i <= n ? "bg-accent" : "bg-fg/10")} />
        ))}
      </div>
      <span className="text-[14px] font-medium capitalize text-fg">{level}</span>
    </div>
  );
}

function EvidenceChips({ ev, focus, onFocus }: { ev: string[]; focus: string | null; onFocus: (r: string) => void }) {
  if (!ev.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {ev.map((r) => (
        <button
          key={r}
          onClick={() => onFocus(r)}
          title="Show this evidence"
          className={clsx(
            "rounded-md border px-1.5 py-0.5 font-mono text-[11.5px] transition",
            focus === r
              ? "border-mem bg-mem/15 text-fg"
              : r.startsWith("C")
                ? "border-warn/35 text-warn"
                : r.startsWith("P")
                  ? "border-accent/40 text-accent-strong dark:text-accent"
                  : "border-mem/35 text-mem"
          )}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

function EvidencePanel({ evidence, focus, customerId }: { evidence: Evidence; focus: string | null; customerId: string }) {
  const entries = Object.entries(evidence);
  const [filter, setFilter] = useState<"all" | "M" | "C" | "P">("all");
  useEffect(() => {
    if (focus) {
      setFilter("all");
      window.setTimeout(() => document.getElementById(`ev-${focus}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 30);
    }
  }, [focus]);
  const shown = entries.filter(([ref]) => filter === "all" || ref.startsWith(filter));
  return (
    <aside className="min-w-0 xl:sticky xl:top-4 xl:self-start">
      <Card title="Supporting evidence" subtitle="Every reference cited above, with its source" bodyClassName="!pt-3">
        <div className="mb-3 flex flex-wrap gap-1.5 text-[12px]">
          {(
            [
              ["all", `All ${entries.length}`],
              ["M", "Account memory"],
              ["C", "Promises"],
              ["P", "Playbook"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={clsx("rounded-md px-2 py-1 transition", filter === k ? "bg-fg/[0.08] font-medium text-fg" : "text-mute hover:text-fg")}>
              {l}
            </button>
          ))}
        </div>
        <div className="max-h-[72vh] space-y-2.5 overflow-y-auto pr-1">
          {shown.map(([ref, e]) => (
            <EvidenceCard key={ref} refId={ref} e={e} active={focus === ref} customerId={customerId} />
          ))}
        </div>
      </Card>
    </aside>
  );
}

function EvidenceCard({ refId, e, active, customerId }: { refId: string; e: Evidence[string]; active: boolean; customerId: string }) {
  const [open, setOpen] = useState(false);
  const isC = e.kind === "commitment";
  const x = e as any;
  const text: string = isC ? `${x.owner} → ${x.promised_to ?? "customer"}: ${x.description}` : x.text;
  const src = isC
    ? x.source_kind
      ? `${String(x.source_kind).replace("_", " ")} on ${fmtDate(x.source_date)}`
      : "CRM commitment"
    : e.kind === "playbook_memory"
      ? "Shared playbook (anonymised)"
      : memorySource(x) ?? "Account memory";
  const link = isC ? "/commitments" : e.kind === "playbook_memory" ? "/playbook" : `/memory?customer=${customerId}&memory=${encodeURIComponent(x.id)}`;
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);
  return (
    <div id={`ev-${refId}`} className={clsx("rounded-xl border p-3.5 transition", active ? "border-mem bg-mem/[0.07]" : "border-line bg-raised")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-mute">
        <span className="font-mono font-semibold text-fg">{refId}</span>
        {isC ? (
          <Badge tone={x.overdue ? "bad" : x.status === "done" ? "good" : "warn"}>{x.overdue ? "overdue promise" : x.status === "done" ? "kept promise" : "open promise"}</Badge>
        ) : (
          <Badge tone={e.kind === "playbook_memory" ? "accent" : "mem"}>{e.kind === "playbook_memory" ? "playbook" : typeLabel(x.type)}</Badge>
        )}
        <span>{fmtDate(isC ? x.due_date : x.occurredAt)}</span>
        {!isC && x.score != null && (
          <span className="ml-auto flex items-center gap-1.5 font-mono" title="Relevance to the brief">
            <span className="h-1 w-10 overflow-hidden rounded-full bg-fg/10">
              <span className="block h-full bg-mem" style={{ width: `${Math.min(100, x.score * 100)}%` }} />
            </span>
            {x.score.toFixed(2)}
          </span>
        )}
      </div>
      <button onClick={() => setOpen((o) => !o)} className={clsx("mt-1.5 block text-left text-[13px] leading-relaxed text-soft", !open && "line-clamp-2")}>
        {text}
      </button>
      <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-mute">
        <span className="truncate">{src}</span>
        <Link to={link} className="flex shrink-0 items-center gap-0.5 font-medium text-mem hover:underline">
          {isC ? "Commitments" : e.kind === "playbook_memory" ? "Playbook" : "Open in Memory"} <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
