import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Brain, ChevronDown, Handshake, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { api, fmtDate, fmtMoney, type AccountSnapshot, type IngestResult } from "../api";
import { useUser } from "../auth";
import { useApi } from "../hooks";
import AnalysisView from "../components/AnalysisView";
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Select, Skeleton, inputCls } from "../components/ui";

const KINDS = [
  ["meeting", "Meeting notes"],
  ["call", "Call transcript / notes"],
  ["email", "Email"],
  ["note", "Manual note"],
  ["follow_up", "Follow-up"],
];

export default function CustomerDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi<AccountSnapshot>(`/customers/${id}`, [id]);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Skeleton className="h-96" />;
  if (!data) return null;
  const c = data.customer;
  const deal = data.deals.find((d) => d.status === "open") ?? data.deals[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title={c.name}
        subtitle={`${c.industry} · ${c.employees?.toLocaleString()} employees · ${c.hq}`}
        action={
          <div className="flex gap-2">
            <Link to={`/memory?customer=${c.id}`}>
              <Button variant="outline">
                <Brain className="h-3.5 w-3.5" /> Memory
              </Button>
            </Link>
            <Link to={`/negotiate?customer=${c.id}`}>
              <Button>
                <Handshake className="h-3.5 w-3.5" /> Negotiation brief
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <LogInteraction customerId={c.id} onDone={reload} />
          <Card title="Interaction history" subtitle="Each one is retained in this account's Hindsight bank">
            {data.interactions.length === 0 ? (
              <Empty title="No interactions yet">Log a meeting, call or email above. RevenueOS will extract facts and start remembering.</Empty>
            ) : (
              <div className="space-y-3">
                {data.interactions.map((i) => (
                  <InteractionItem key={i.id} i={i} onRetried={reload} />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {deal && (
            <Card title="Deal">
              <div className="text-[13px] font-medium text-white">{deal.name}</div>
              <div className="mt-1 font-mono text-xl text-white">{fmtMoney(Number(deal.amount))}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge>{deal.stage}</Badge>
                <Badge>{deal.probability}%</Badge>
                <Badge tone={deal.risk === "high" ? "bad" : deal.risk === "medium" ? "warn" : "good"}>risk {deal.risk}</Badge>
              </div>
              {deal.primary_blocker && <div className="mt-3 text-xs text-mem">Real blocker: {deal.primary_blocker}</div>}
              <div className="mt-3 text-xs text-mute">
                Owner {deal.owner_name} · close {fmtDate(deal.close_date)}
              </div>
            </Card>
          )}
          <Card title="Stakeholders">
            {data.stakeholders.length === 0 ? (
              <div className="text-xs text-mute">None identified yet.</div>
            ) : (
              <div className="space-y-3">
                {data.stakeholders.map((s) => (
                  <div key={s.id}>
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="font-medium text-white">{s.name}</span>
                      {s.stance && s.stance !== "unknown" && (
                        <Badge tone={s.stance === "champion" || s.stance === "supporter" ? "good" : s.stance === "blocker" || s.stance === "skeptic" ? "bad" : "neutral"}>{s.stance}</Badge>
                      )}
                    </div>
                    <div className="text-xs text-mute">{s.role}</div>
                    {s.priorities && <div className="text-xs text-soft">{s.priorities}</div>}
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Promises">
            {data.commitments.length === 0 ? (
              <div className="text-xs text-mute">No commitments tracked.</div>
            ) : (
              <div className="space-y-2.5">
                {data.commitments.map((cm) => (
                  <div key={cm.id} className="text-[13px]">
                    <div className={clsx(cm.status === "done" ? "text-mute line-through" : "text-soft")}>{cm.description}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-mute">
                      {cm.owner} → {cm.promised_to ?? "customer"}
                      <Badge tone={cm.status === "done" ? "good" : cm.overdue ? "bad" : "warn"}>{cm.status === "done" ? "done" : cm.overdue ? `overdue · ${fmtDate(cm.due_date)}` : `due ${fmtDate(cm.due_date)}`}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Objections & offers">
            <div className="space-y-2">
              {data.objections.map((o) => (
                <div key={o.id} className={clsx("text-[13px]", o.status === "resolved" ? "text-mute line-through" : "text-soft")}>
                  <Badge tone={o.status === "resolved" ? "good" : "bad"} className="mr-1.5">
                    {o.status === "resolved" ? "resolved" : o.category}
                  </Badge>
                  {o.description}
                </div>
              ))}
              {data.offers.map((o) => (
                <div key={o.id} className="text-[13px] text-soft">
                  <Badge tone={o.response === "rejected" ? "bad" : "neutral"} className="mr-1.5">
                    offer {o.response}
                  </Badge>
                  {o.description}
                </div>
              ))}
              {data.objections.length + data.offers.length === 0 && <div className="text-xs text-mute">Nothing recorded.</div>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function LogInteraction({ customerId, onDone }: { customerId: string; onDone: () => void }) {
  const me = useUser();
  const [kind, setKind] = useState("meeting");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.post<IngestResult>(`/customers/${customerId}/interactions`, {
        kind,
        text,
        occurredAt: new Date(`${date}T12:00:00Z`).toISOString(),
      });
      setResult(r);
      setText("");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Log an interaction" subtitle="Meeting notes, a call transcript, an email or a quick note. RevenueOS extracts what matters and remembers it.">
      <div className="mb-3 text-xs text-mute" title={me.email}>
        Logging as <span className="text-soft">{me.name}</span> · {me.title}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select value={kind} onChange={setKind}>
          {KINDS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <textarea
        className={`${inputCls} mt-3 min-h-[120px] resize-y leading-relaxed`}
        placeholder="e.g. Call with their CFO. She said the price is fine if we can guarantee go-live before their Q1 peak season. I promised to send a phased rollout plan by Thursday…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="text-xs text-mute">{busy ? "Recalling prior memory → extracting → writing to Hindsight…" : `${text.length} characters`}</div>
        <Button onClick={submit} loading={busy} disabled={text.trim().length < 15}>
          Analyse & remember
        </Button>
      </div>
      {error && (
        <div className="mt-3">
          <ErrorBox error={error} />
        </div>
      )}
      {result && (
        <div className="mt-5 border-t border-line pt-5">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-mute">
            <Badge tone={result.memoryStatus === "stored" ? "mem" : "bad"}>{result.memoryStatus === "stored" ? "stored in Hindsight" : "memory write failed"}</Badge>
            recalled {result.recalledCount} prior memories for context
            {result.memoryError && <span className="text-bad">{result.memoryError}</span>}
          </div>
          <AnalysisView a={result.analysis} />
        </div>
      )}
    </Card>
  );
}

function InteractionItem({ i, onRetried }: { i: AccountSnapshot["interactions"][number]; onRetried: () => void }) {
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  return (
    <div className="rounded-xl border border-line bg-white/[0.015] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-mute">
          <Badge tone="accent">{i.kind.replace("_", " ")}</Badge>
          <span className="text-soft">{i.rep_name}</span>{i.rep_title && <span className="text-mute">({i.rep_title})</span>}
          <span>{fmtDate(i.occurred_at)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={i.memory_status === "stored" ? "mem" : i.memory_status === "failed" ? "bad" : "neutral"}>
            {i.memory_status === "stored" ? "in memory" : i.memory_status === "failed" ? "memory failed" : "not yet in memory"}
          </Badge>
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
              <RefreshCw className="h-3 w-3" /> Store
            </Button>
          )}
        </div>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-soft">{i.raw_text}</p>
      {i.memory_error && <div className="mt-1 text-[11px] text-bad">{i.memory_error}</div>}
      {i.analysis && (
        <>
          <button onClick={() => setOpen(!open)} className="mt-2 flex items-center gap-1 text-xs text-mute hover:text-white">
            AI analysis <ChevronDown className={clsx("h-3.5 w-3.5 transition", open && "rotate-180")} />
          </button>
          {open && (
            <div className="mt-3 border-t border-line pt-3">
              <AnalysisView a={i.analysis} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
