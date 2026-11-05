import { useState } from "react";
import { BookOpenCheck, RefreshCw, Trophy } from "lucide-react";
import { api, fmtDate, fmtMoney, type Deal, type MemoryHit } from "../api";
import { useApi } from "../hooks";
import { Badge, Button, Card, Empty, ErrorBox, MD, MemoryRow, PageHeader, Select, Skeleton, inputCls } from "../components/ui";

interface PlaybookData {
  bank: string;
  mentalModel: { id: string; name: string; content: string | null; lastRefreshedAt: string | null } | null;
  memories: MemoryHit[];
  total: number;
}

export default function Playbook() {
  const { data, error, loading, reload } = useApi<PlaybookData>("/playbook");
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    setMsg(null);
    try {
      await api.post("/playbook/refresh");
      setMsg("Refresh queued in Hindsight. The model regenerates from all lessons in the background — reload in a moment.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  const lessons = (data?.memories ?? []).filter((m) => m.type !== "observation");
  const observations = (data?.memories ?? []).filter((m) => m.type === "observation");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Negotiation playbook"
        subtitle="Every closed deal teaches RevenueOS what works. Lessons are anonymised into a shared Hindsight bank and used by the Deal Negotiator on every other account."
      />
      {error && <ErrorBox error={error} onRetry={reload} />}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card
            title={
              <span className="flex items-center gap-2">
                <BookOpenCheck className="h-4 w-4 text-mem" /> What wins, by blocker
              </span>
            }
            subtitle={data?.mentalModel?.lastRefreshedAt ? `Hindsight mental model · refreshed ${fmtDate(data.mentalModel.lastRefreshedAt)}` : "Hindsight mental model, regenerated as new outcomes are consolidated"}
            action={
              <Button variant="outline" onClick={refresh} loading={refreshing}>
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
            }
          >
            {msg && <div className="mb-3 text-xs text-mem">{msg}</div>}
            {loading && !data ? (
              <Skeleton className="h-48" />
            ) : data?.mentalModel?.content ? (
              <MD>{data.mentalModel.content}</MD>
            ) : (
              <Empty title="Not generated yet">Seed playbook memory or record a deal outcome, then refresh.</Empty>
            )}
          </Card>

          {observations.length > 0 && (
            <Card title="Patterns Hindsight consolidated" subtitle="Observations formed across multiple deals">
              <div className="space-y-2">
                {observations.map((m) => (
                  <MemoryRow key={m.id} m={m} />
                ))}
              </div>
            </Card>
          )}

          <Card title={`Deal lessons (${lessons.length})`} subtitle={data?.bank}>
            {lessons.length === 0 ? (
              <Empty title="No lessons yet" />
            ) : (
              <div className="space-y-2">
                {lessons.map((m) => (
                  <MemoryRow key={m.id} m={m} compact />
                ))}
              </div>
            )}
          </Card>
        </div>
        <RecordOutcome onDone={reload} />
      </div>
    </div>
  );
}

function RecordOutcome({ onDone }: { onDone: () => void }) {
  const { data } = useApi<{ deals: Deal[] }>("/overview");
  const open = (data?.deals ?? []).filter((d) => d.status === "open");
  const [dealId, setDealId] = useState("");
  const [outcome, setOutcome] = useState<"won" | "lost">("won");
  const [blocker, setBlocker] = useState("");
  const [tactics, setTactics] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const deal = open.find((d) => d.id === dealId);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<{ ok: boolean; errors: string[] }>(`/deals/${dealId}/outcome`, { outcome, primaryBlocker: blocker, tactics, reason });
      setMsg(r.ok ? { ok: true, text: "Outcome recorded in the account's memory and the shared playbook." } : { ok: false, text: r.errors.join("; ") });
      setDealId("");
      setBlocker("");
      setTactics("");
      setReason("");
      onDone();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lg:sticky lg:top-4 lg:self-start">
      <Card
        title={
          <span className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-warn" /> Close a deal & teach the playbook
          </span>
        }
      >
        <div className="space-y-3">
          <Select
            value={dealId}
            onChange={(v) => {
              setDealId(v);
              const d = open.find((x) => x.id === v);
              if (d?.primaryBlocker) setBlocker(d.primaryBlocker);
            }}
            className="w-full"
          >
            <option value="">Select an open deal…</option>
            {open.map((d) => (
              <option key={d.id} value={d.id}>
                {d.customer} — {fmtMoney(d.amount)}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            {(["won", "lost"] as const).map((o) => (
              <button
                key={o}
                onClick={() => setOutcome(o)}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs capitalize ${outcome === o ? (o === "won" ? "border-good/40 bg-good/10 text-good" : "border-bad/40 bg-bad/10 text-bad") : "border-line text-mute"}`}
              >
                {o}
              </button>
            ))}
          </div>
          <input className={inputCls} placeholder="Primary blocker (e.g. SAP integration risk)" value={blocker} onChange={(e) => setBlocker(e.target.value)} />
          <textarea className={`${inputCls} min-h-[70px]`} placeholder="Tactics used (e.g. sandbox demo with CTO, 30-day milestone plan, no discount)" value={tactics} onChange={(e) => setTactics(e.target.value)} />
          <textarea className={`${inputCls} min-h-[60px]`} placeholder="Why it was won / lost" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button onClick={submit} loading={busy} disabled={!dealId || !blocker.trim() || !tactics.trim()} className="w-full">
            Record outcome
          </Button>
          {deal && <div className="text-[11px] text-mute">Writes to {deal.customer}'s bank and, anonymised, to the playbook bank.</div>}
          {msg && <div className={`text-xs ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</div>}
          <div className="flex flex-wrap gap-1.5 border-t border-line pt-3">
            <Badge tone="mem">Hindsight retain</Badge>
            <Badge tone="mem">observations</Badge>
            <Badge tone="mem">mental model</Badge>
          </div>
        </div>
      </Card>
    </div>
  );
}
