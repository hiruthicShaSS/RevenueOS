import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import clsx from "clsx";
import { Brain, ChevronDown, ExternalLink, FileText, Handshake, Mail, MessageSquare, Phone, RefreshCw, StickyNote, Users } from "lucide-react";
import { api, fmtDate, fmtMoney, type AccountSnapshot, type MemoryHit } from "../api";
import { useApi } from "../hooks";
import AnalysisView from "../components/AnalysisView";
import LogInteraction from "../components/LogInteraction";
import { Badge, Button, Card, Collapse, Empty, ErrorBox, MemoryRow, PageHeader, Skeleton, StatusDot } from "../components/ui";

const SECTIONS = [
  ["overview", "Overview"],
  ["stakeholders", "Stakeholders"],
  ["deals", "Deals"],
  ["objections", "Objections"],
  ["conversations", "Conversations"],
  ["commitments", "Commitments"],
  ["memory", "Memory"],
] as const;

const stanceTone = (s: string | null) => (s === "champion" || s === "supporter" ? "good" : s === "blocker" || s === "skeptic" ? "bad" : "neutral");
const riskTone = (r: string) => (r === "high" ? "bad" : r === "medium" ? "warn" : "good") as "bad" | "warn" | "good";

export default function CustomerDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi<AccountSnapshot>(`/customers/${id}`, [id]);
  const mem = useApi<{ items: MemoryHit[]; total: number; error: string | null }>(id ? `/customers/${id}/memory?limit=6&type=observation` : null, [id]);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Skeleton className="h-96" />;
  if (!data) return null;
  const c = data.customer;
  const openDeals = data.deals.filter((d) => d.status === "open");
  const closedDeals = data.deals.filter((d) => d.status !== "open");
  const openObjections = data.objections.filter((o) => o.status !== "resolved");
  const openCommitments = data.commitments.filter((x) => x.status !== "done");
  const go = (sid: string) => document.getElementById(sid)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="stagger">
      <PageHeader
        title={c.name}
        subtitle={
          <>
            {c.industry} · {c.employees?.toLocaleString("en-US")} employees · {c.hq}
            {c.website && (
              <>
                {" · "}
                <a href={`https://${c.website}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-fg">
                  {c.website} <ExternalLink className="h-3 w-3" />
                </a>
              </>
            )}
          </>
        }
        action={
          <>
            <Link to={`/memory?customer=${c.id}`}>
              <Button variant="outline">
                <Brain className="h-4 w-4" /> Explore memory
              </Button>
            </Link>
            <Link to={`/negotiate?customer=${c.id}`}>
              <Button>
                <Handshake className="h-4 w-4" /> Negotiation brief
              </Button>
            </Link>
          </>
        }
      />

      <nav className="sticky top-0 z-20 -mx-1 mb-8 flex gap-1 overflow-x-auto bg-bg/90 px-1 py-2 backdrop-blur">
        {SECTIONS.map(([sid, label]) => (
          <button key={sid} onClick={() => go(sid)} className="press whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] text-soft hover:bg-fg/5 hover:text-fg">
            {label}
          </button>
        ))}
      </nav>

      <div className="space-y-10">
        {/* overview */}
        <section id="overview" className="scroll-mt-16">
          <div className="stagger grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Open pipeline" value={fmtMoney(openDeals.reduce((s, d) => s + Number(d.amount), 0))} hint={`${openDeals.length} open deal${openDeals.length === 1 ? "" : "s"}`} />
            <Fact label="Conversations" value={data.interactions.length} hint={data.interactions[0] ? `Last ${fmtDate(data.interactions[0].occurred_at)}` : "None yet"} />
            <Fact label="Open objections" value={openObjections.length} hint={`${data.objections.length - openObjections.length} resolved`} tone={openObjections.length ? "warn" : undefined} />
            <Fact label="Open promises" value={openCommitments.length} hint={`${openCommitments.filter((x) => x.overdue).length} overdue`} tone={openCommitments.some((x) => x.overdue) ? "bad" : undefined} />
          </div>
          {c.summary && <p className="mt-5 max-w-[80ch] text-[14.5px] leading-relaxed text-soft">{c.summary}</p>}
        </section>

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-10">
            <LogInteraction customerId={c.id} customerName={c.name} onDone={() => (reload(), mem.reload())} />

            <section id="conversations" className="scroll-mt-16">
              <Card title="Conversations" subtitle="Every interaction the team logged, newest first. Each is retained in this account's Hindsight memory.">
                {data.interactions.length === 0 ? (
                  <Empty title="No conversations yet">Log a meeting, call, email or document above. RevenueOS will extract what matters and start remembering.</Empty>
                ) : (
                  <ol className="relative space-y-6 before:absolute before:bottom-3 before:left-[17px] before:top-3 before:w-px before:bg-line">
                    {data.interactions.map((i) => (
                      <TimelineItem key={i.id} i={i} onRetried={reload} />
                    ))}
                  </ol>
                )}
              </Card>
            </section>
          </div>

          <div className="min-w-0 space-y-8">
            <section id="stakeholders" className="scroll-mt-16">
              <Card title="Stakeholders" subtitle="Who matters and where they stand">
                {data.stakeholders.length === 0 ? (
                  <p className="text-[13.5px] text-mute">None identified yet.</p>
                ) : (
                  <ul className="space-y-4">
                    {data.stakeholders.map((s) => (
                      <li key={s.id}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-medium text-fg">{s.name}</span>
                          {s.stance && s.stance !== "unknown" && <Badge tone={stanceTone(s.stance)}>{s.stance}</Badge>}
                        </div>
                        {s.role && <div className="mt-0.5 text-[12.5px] text-mute">{s.role}</div>}
                        {s.priorities && <div className="mt-1 text-[13px] leading-relaxed text-soft">{s.priorities}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>

            <section id="deals" className="scroll-mt-16">
              <Card title="Active deals">
                {openDeals.length === 0 ? (
                  <p className="text-[13.5px] text-mute">No open deals.</p>
                ) : (
                  <ul className="space-y-5">
                    {openDeals.map((d) => (
                      <li key={d.id}>
                        <div className="text-[14px] font-medium text-fg">{d.name}</div>
                        <div className="mt-1 font-mono text-[22px] font-semibold tracking-tight text-fg">{fmtMoney(Number(d.amount))}</div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                          <StatusDot tone="neutral" label={`${d.stage} · ${d.probability}%`} />
                          <StatusDot tone={riskTone(d.risk)} label={`${d.risk} risk`} />
                        </div>
                        {d.primary_blocker && (
                          <div className="mt-3 rounded-lg bg-mem/[0.07] px-3 py-2 text-[13px] text-soft">
                            <span className="font-medium text-mem">Real blocker</span> · {d.primary_blocker}
                          </div>
                        )}
                        <div className="mt-2.5 text-[12.5px] text-mute">
                          Owner {d.owner_name ?? "unassigned"} · expected close {fmtDate(d.close_date)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-6 border-t border-line pt-5">
                  <div className="text-[13px] font-semibold text-fg">Purchase history</div>
                  {closedDeals.length === 0 ? (
                    <p className="mt-2 text-[13px] text-mute">No closed deals with this account yet.</p>
                  ) : (
                    <ul className="mt-3 space-y-3">
                      {closedDeals.map((d) => (
                        <li key={d.id} className="flex items-start justify-between gap-3 text-[13.5px]">
                          <div className="min-w-0">
                            <div className="text-soft">{d.name}</div>
                            {d.outcome_reason && <div className="mt-0.5 text-[12.5px] leading-relaxed text-mute">{d.outcome_reason}</div>}
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="font-mono text-fg">{fmtMoney(Number(d.amount))}</div>
                            <StatusDot tone={d.status === "won" ? "good" : "bad"} label={d.status === "won" ? "Won" : "Lost"} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            </section>

            <section id="objections" className="scroll-mt-16">
              <Card title="Objections & offers">
                <Objections data={data} />
              </Card>
            </section>

            <section id="commitments" className="scroll-mt-16">
              <Card
                title="Commitments"
                action={
                  <Link to="/commitments" className="text-[13px] font-medium text-accent-strong hover:underline dark:text-accent">
                    All
                  </Link>
                }
              >
                {data.commitments.length === 0 ? (
                  <p className="text-[13.5px] text-mute">No commitments tracked.</p>
                ) : (
                  <ul className="space-y-3.5">
                    {data.commitments.map((cm) => (
                      <li key={cm.id} className="text-[13.5px]">
                        <div className={clsx("leading-snug", cm.status === "done" ? "text-mute line-through" : "text-fg")}>{cm.description}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-mute">
                          <span>
                            {cm.owner} → {cm.promised_to ?? "customer"}
                          </span>
                          <StatusDot
                            tone={cm.status === "done" ? "good" : cm.overdue ? "bad" : "warn"}
                            label={cm.status === "done" ? "Kept" : cm.overdue ? `Overdue · ${fmtDate(cm.due_date)}` : cm.due_date ? `Due ${fmtDate(cm.due_date)}` : "Open"}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>

            <section id="memory" className="scroll-mt-16">
              <Card
                tone="mem"
                title="Customer memory"
                subtitle="Patterns Hindsight consolidated from this account's conversations"
                action={
                  <Link to={`/memory?customer=${c.id}`} className="text-[13px] font-medium text-mem hover:underline">
                    Explore
                  </Link>
                }
              >
                {mem.loading && !mem.data ? (
                  <Skeleton className="h-32" />
                ) : mem.data?.error ? (
                  <ErrorBox error={mem.data.error} />
                ) : !mem.data?.items.length ? (
                  <p className="text-[13.5px] text-mute">No consolidated observations yet. They form as more conversations are logged.</p>
                ) : (
                  <div className="space-y-2.5">
                    {mem.data.items.slice(0, 5).map((m) => (
                      <MemoryRow key={m.id} m={m} compact />
                    ))}
                  </div>
                )}
              </Card>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "warn" | "bad" }) {
  return (
    <div className="rounded-2xl border border-line bg-panel px-5 py-4 shadow-card">
      <div className="text-[12.5px] text-mute">{label}</div>
      <div className={clsx("mt-1.5 text-[24px] font-semibold tracking-tight", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-fg")}>{value}</div>
      {hint && <div className="mt-1 text-[12.5px] text-mute">{hint}</div>}
    </div>
  );
}

function Objections({ data }: { data: AccountSnapshot }) {
  const [showResolved, setShowResolved] = useState(false);
  const open = data.objections.filter((o) => o.status !== "resolved");
  const resolved = data.objections.filter((o) => o.status === "resolved");
  if (data.objections.length + data.offers.length === 0) return <p className="text-[13.5px] text-mute">Nothing recorded.</p>;
  return (
    <div className="space-y-5">
      {open.length > 0 && (
        <ul className="space-y-3">
          {open.map((o) => (
            <li key={o.id} className="text-[13.5px] leading-relaxed text-soft">
              <Badge tone="bad" className="mr-2">
                {o.category.replace("_", " ")}
              </Badge>
              {o.description}
              {o.raised_by && <span className="text-mute"> · {o.raised_by}</span>}
            </li>
          ))}
        </ul>
      )}
      {data.offers.length > 0 && (
        <div>
          <div className="mb-2 text-[12.5px] font-medium text-mute">Offers</div>
          <ul className="space-y-2.5">
            {data.offers.map((o) => (
              <li key={o.id} className="text-[13.5px] leading-relaxed text-soft">
                {o.description} <Badge tone={o.response === "rejected" ? "bad" : o.response === "accepted" ? "good" : "neutral"}>{o.response}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
      {resolved.length > 0 && (
        <div>
          <button onClick={() => setShowResolved((s) => !s)} className="flex items-center gap-1 text-[12.5px] font-medium text-mute hover:text-fg">
            <ChevronDown className={clsx("h-3.5 w-3.5 transition-transform duration-[var(--t-med)]", !showResolved && "-rotate-90")} />
            {resolved.length} resolved objection{resolved.length === 1 ? "" : "s"}
          </button>
          <Collapse open={showResolved}>
            <ul className="mt-2.5 space-y-2 border-l border-line pl-3">
              {resolved.map((o) => (
                <li key={o.id} className="text-[13px] leading-relaxed text-mute">
                  <span className="line-through decoration-mute/50">{o.description}</span>
                  <span className="ml-1.5 text-good">resolved</span>
                </li>
              ))}
            </ul>
          </Collapse>
        </div>
      )}
    </div>
  );
}

const KIND_STYLE: Record<string, { icon: typeof Mail; cls: string; label: string }> = {
  meeting: { icon: Users, cls: "text-accent-strong dark:text-accent border-accent/30", label: "Meeting" },
  call: { icon: Phone, cls: "text-good border-good/30", label: "Call" },
  email: { icon: Mail, cls: "text-warn border-warn/30", label: "Email" },
  document: { icon: FileText, cls: "text-mem border-mem/30", label: "Document" },
  note: { icon: StickyNote, cls: "text-soft border-line-2", label: "Note" },
  follow_up: { icon: MessageSquare, cls: "text-soft border-line-2", label: "Follow-up" },
};

function TimelineItem({ i, onRetried }: { i: AccountSnapshot["interactions"][number]; onRetried: () => void }) {
  const [openText, setOpenText] = useState(false);
  const [openAnalysis, setOpenAnalysis] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const k = KIND_STYLE[i.kind] ?? KIND_STYLE.note;
  const Icon = k.icon;
  const src = i.analysis?.source;
  return (
    <li className="relative flex gap-4">
      <div className={clsx("relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full border bg-raised", k.cls)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
            <span className="font-medium text-fg">{src ? src.fileName : k.label}</span>
            <span className="text-mute">
              {fmtDate(i.occurred_at)} · {i.rep_name}
              {i.rep_title && `, ${i.rep_title}`}
              {src?.pages ? ` · ${src.pages} pages` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <StatusDot tone={i.memory_status === "stored" ? "mem" : i.memory_status === "failed" ? "bad" : "neutral"} label={i.memory_status === "stored" ? "In memory" : i.memory_status === "failed" ? "Memory failed" : "Not in memory"} />
            {i.memory_status !== "stored" && (
              <Button
                variant="ghost"
                loading={retrying}
                onClick={async () => {
                  setRetrying(true);
                  try {
                    await api.post(`/interactions/${i.id}/retry-memory`);
                  } catch {
                    /* status shown after reload */
                  }
                  setRetrying(false);
                  onRetried();
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Store
              </Button>
            )}
          </div>
        </div>
        {i.analysis?.summary && <p className="mt-2 max-w-[72ch] text-[14px] leading-relaxed text-fg">{i.analysis.summary}</p>}
        <div className={clsx("mt-2 max-w-[72ch] whitespace-pre-line text-[13.5px] leading-relaxed text-soft", !openText && "line-clamp-3")}>{i.raw_text}</div>
        {i.memory_error && <div className="mt-1 text-[12.5px] text-bad">{i.memory_error}</div>}
        <div className="mt-2 flex gap-4">
          {i.raw_text.length > 240 && (
            <button onClick={() => setOpenText((o) => !o)} className="text-[12.5px] font-medium text-mute hover:text-fg">
              {openText ? "Show less" : src ? "Show extracted text" : "Show full note"}
            </button>
          )}
          {i.analysis && (
            <button onClick={() => setOpenAnalysis((o) => !o)} className="flex items-center gap-1 text-[12.5px] font-medium text-mem hover:underline">
              AI analysis <ChevronDown className={clsx("h-3.5 w-3.5 transition-transform duration-[var(--t-med)]", openAnalysis && "rotate-180")} />
            </button>
          )}
        </div>
        {i.analysis && (
          <Collapse open={openAnalysis}>
            <div className="mt-4 rounded-xl border border-line bg-raised p-5">{openAnalysis && <AnalysisView a={i.analysis} />}</div>
          </Collapse>
        )}
      </div>
    </li>
  );
}
