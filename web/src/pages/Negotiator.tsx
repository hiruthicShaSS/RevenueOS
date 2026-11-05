import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Ban, BookOpenCheck, Footprints, ShieldAlert, Users } from "lucide-react";
import clsx from "clsx";
import { api, fmtDate, type BriefResult, type Evidence } from "../api";
import { setLastRetrieval, useApi } from "../hooks";
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Select, Skeleton, inputCls } from "../components/ui";

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

  useEffect(() => setResult(null), [customerId]);

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
  return (
    <div className="space-y-6">
      <PageHeader title="Deal Negotiator" subtitle="Advice grounded in everything this account has told us, plus what has won and lost on other deals." />
      <Card>
        <div className="grid gap-3 md:grid-cols-[240px_1fr_auto]">
          <Select value={customerId} onChange={(v) => setParams({ customer: v })}>
            {openCustomers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <input
            className={inputCls}
            placeholder='Optional: the move you are considering, e.g. "Offer 25% off to close this month"'
            value={proposal}
            onChange={(e) => setProposal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
          />
          <Button onClick={run} loading={busy}>
            {busy ? "Recalling history…" : "Get brief"}
          </Button>
        </div>
        {proposal === "" && (
          <div className="mt-3 flex flex-wrap gap-2">
            {["Offer a 25% discount to close this month", "Push for signature next week", "Bring in our CTO for an executive call"].map((s) => (
              <button key={s} onClick={() => setProposal(s)} className="rounded-full border border-line-2 px-3 py-1 text-xs text-mute hover:text-white">
                {s}
              </button>
            ))}
          </div>
        )}
      </Card>

      {error && <ErrorBox error={error} onRetry={run} />}
      {busy && !result && <Skeleton className="h-80" />}
      {result?.empty && <Empty title="Nothing remembered yet">{result.message}</Empty>}

      {b && (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px] fade-in">
          <div className="space-y-6">
            <div className="rounded-2xl border border-mem/25 bg-gradient-to-br from-mem/[0.07] to-transparent p-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={b.verdict === "hold" ? "bad" : b.verdict === "proceed" ? "good" : "warn"} className="uppercase">
                  {b.verdict}
                </Badge>
                <Badge>confidence {b.confidence}</Badge>
                {result.recalled && (
                  <span className="text-xs text-mute">
                    built on {result.recalled.account} account memories · {result.recalled.playbook} playbook lessons
                  </span>
                )}
              </div>
              <h2 className="mt-3 text-lg font-semibold leading-snug text-white">{b.headline}</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {b.stated_blocker && (
                  <div className="rounded-xl border border-line bg-black/30 p-3">
                    <div className="text-[11px] uppercase tracking-[0.08em] text-mute">What they say</div>
                    <div className="mt-1 text-[13px] text-soft">{b.stated_blocker}</div>
                  </div>
                )}
                <div className="rounded-xl border border-mem/30 bg-black/30 p-3">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-mem">What the history shows</div>
                  <div className="mt-1 text-[13px] text-white">{b.real_blocker}</div>
                </div>
              </div>
              {b.proposal_assessment && (
                <div className="mt-4 rounded-xl border border-line bg-black/30 p-3 text-[13px] text-soft">
                  <span className="text-mute">Your proposed move: </span>
                  {b.proposal_assessment}
                </div>
              )}
            </div>

            {b.do_not.length > 0 && (
              <Block icon={<Ban className="h-4 w-4 text-bad" />} title="Don't">
                {b.do_not.map((d, i) => (
                  <Item key={i} title={d.action} why={d.why} ev={d.evidence} onEv={setFocus} focus={focus} tone="bad" />
                ))}
              </Block>
            )}
            <Block icon={<Footprints className="h-4 w-4 text-good" />} title="Recommended strategy">
              {b.strategy.map((s, i) => (
                <Item key={i} n={i + 1} title={s.step} why={s.why} ev={s.evidence} onEv={setFocus} focus={focus} />
              ))}
            </Block>
            <div className="grid gap-6 md:grid-cols-2">
              <Block icon={<ShieldAlert className="h-4 w-4 text-warn" />} title="Risks">
                {b.risks.map((r, i) => (
                  <Item key={i} title={r.risk} badge={r.severity} ev={r.evidence} onEv={setFocus} focus={focus} />
                ))}
              </Block>
              <Block icon={<Users className="h-4 w-4 text-accent" />} title="Stakeholder plan">
                {b.stakeholder_plan.map((s, i) => (
                  <Item key={i} title={s.name} why={s.approach} ev={s.evidence} onEv={setFocus} focus={focus} />
                ))}
              </Block>
            </div>
            {b.playbook_insight && (
              <Block icon={<BookOpenCheck className="h-4 w-4 text-mem" />} title="Learned from other deals">
                <Item title={b.playbook_insight.text} ev={b.playbook_insight.evidence} onEv={setFocus} focus={focus} />
              </Block>
            )}
          </div>

          <EvidencePanel evidence={result.evidence} focus={focus} />
        </div>
      )}
    </div>
  );
}

function Block({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card title={<span className="flex items-center gap-2">{icon}{title}</span>}>
      <div className="space-y-3">{children}</div>
    </Card>
  );
}

function Item({ n, title, why, ev, onEv, focus, tone, badge }: { n?: number; title: string; why?: string; ev: string[]; onEv: (r: string) => void; focus: string | null; tone?: "bad"; badge?: string }) {
  return (
    <div className="flex gap-3">
      {n && <div className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-good/15 font-mono text-[11px] text-good">{n}</div>}
      <div className="flex-1">
        <div className={clsx("text-[13.5px] font-medium", tone === "bad" ? "text-bad" : "text-white")}>
          {title} {badge && <Badge tone={badge === "high" ? "bad" : badge === "medium" ? "warn" : "neutral"}>{badge}</Badge>}
        </div>
        {why && <div className="mt-0.5 text-[13px] leading-relaxed text-mute">{why}</div>}
        {ev.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {ev.map((r) => (
              <button
                key={r}
                onMouseEnter={() => onEv(r)}
                onClick={() => onEv(r)}
                className={clsx(
                  "rounded border px-1.5 py-0.5 font-mono text-[10.5px] transition",
                  focus === r ? "border-mem bg-mem/20 text-white" : r.startsWith("C") ? "border-warn/30 text-warn" : r.startsWith("P") ? "border-accent/30 text-accent" : "border-mem/30 text-mem"
                )}
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EvidencePanel({ evidence, focus }: { evidence: Evidence; focus: string | null }) {
  const entries = Object.entries(evidence);
  return (
    <div className="lg:sticky lg:top-4 lg:self-start">
      <Card title="Evidence" subtitle="M = account memory · C = CRM promise · P = playbook lesson">
        <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
          {entries.map(([ref, e]) => (
            <div key={ref} className={clsx("rounded-xl border p-3 transition", focus === ref ? "border-mem bg-mem/10" : "border-line bg-white/[0.015]")}>
              <div className="flex items-center gap-1.5 text-[11px] text-mute">
                <span className="font-mono text-white">{ref}</span>
                {e.kind === "commitment" ? (
                  <>
                    <Badge tone={(e as any).overdue ? "bad" : (e as any).status === "done" ? "good" : "warn"}>{(e as any).overdue ? "overdue promise" : `promise · ${(e as any).status}`}</Badge>
                    <span>due {fmtDate((e as any).due_date)}</span>
                  </>
                ) : (
                  <>
                    <Badge tone={e.kind === "playbook_memory" ? "accent" : "mem"}>{e.kind === "playbook_memory" ? "playbook" : (e as any).type ?? "memory"}</Badge>
                    {(e as any).occurredAt && <span>{fmtDate((e as any).occurredAt)}</span>}
                    {(e as any).score != null && <span className="font-mono">rel {(e as any).score.toFixed(2)}</span>}
                  </>
                )}
              </div>
              <div className="mt-1 text-[12.5px] leading-snug text-soft">
                {e.kind === "commitment" ? `${(e as any).owner} → ${(e as any).promised_to ?? "customer"}: ${(e as any).description}` : (e as any).text}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
