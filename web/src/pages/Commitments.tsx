import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import clsx from "clsx";
import { api, fmtDate, type Commitment } from "../api";
import { useApi } from "../hooks";
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Skeleton } from "../components/ui";

const FILTERS = ["open", "overdue", "done", "all"] as const;

export default function Commitments() {
  const { data, error, loading, reload } = useApi<Commitment[]>("/commitments");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const rows = (data ?? []).filter((c) => (filter === "all" ? true : filter === "overdue" ? c.overdue : c.status === filter));
  const counts = {
    open: data?.filter((c) => c.status === "open").length ?? 0,
    overdue: data?.filter((c) => c.overdue).length ?? 0,
    done: data?.filter((c) => c.status === "done").length ?? 0,
    all: data?.length ?? 0,
  };

  async function complete(c: Commitment) {
    setBusy(c.id);
    setMsg(null);
    try {
      const r = await api.post<{ memoryError: string | null }>(`/commitments/${c.id}/complete`);
      setMsg(r.memoryError ? `Marked done, but memory write failed: ${r.memoryError}` : `Marked done and remembered: "${c.description}"`);
      await reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Never forget a promise" subtitle="Every commitment a rep makes in a meeting is detected, tracked and remembered — including when it's kept." />
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={clsx("rounded-lg border px-3 py-1.5 text-xs capitalize transition", filter === f ? "border-accent/40 bg-accent/10 text-white" : "border-line text-mute hover:text-white")}
          >
            {f} <span className="ml-1 font-mono text-mute">{counts[f]}</span>
          </button>
        ))}
      </div>
      {msg && <div className="rounded-xl border border-mem/25 bg-mem/5 px-4 py-2.5 text-sm text-mem">{msg}</div>}
      {error && <ErrorBox error={error} onRetry={reload} />}
      <Card>
        {loading && !data ? (
          <Skeleton className="h-60" />
        ) : rows.length === 0 ? (
          <Empty icon={<CheckCircle2 className="h-6 w-6" />} title={filter === "overdue" ? "Nothing overdue" : "No commitments here"} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-[0.08em] text-mute">
                <tr>
                  <th className="pb-3 font-medium">Promise</th>
                  <th className="pb-3 font-medium">Who → whom</th>
                  <th className="pb-3 font-medium">Account</th>
                  <th className="pb-3 font-medium">Due</th>
                  <th className="pb-3 font-medium">Source</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-t border-line align-top">
                    <td className={clsx("max-w-[340px] py-3 pr-4", c.status === "done" ? "text-mute line-through" : "text-white")}>{c.description}</td>
                    <td className="py-3 pr-4 text-soft">
                      {c.owner} <span className="text-mute">→</span> {c.promised_to ?? "customer"}
                    </td>
                    <td className="py-3 pr-4">
                      <Link to={`/customers/${c.customer_id}`} className="text-soft hover:text-accent">
                        {c.customer}
                      </Link>
                    </td>
                    <td className="py-3 pr-4">
                      <Badge tone={c.status === "done" ? "good" : c.overdue ? "bad" : "warn"}>{c.status === "done" ? "done" : c.overdue ? `overdue · ${fmtDate(c.due_date)}` : fmtDate(c.due_date)}</Badge>
                    </td>
                    <td className="py-3 pr-4 text-xs text-mute">{c.source_kind ? `${c.source_kind} · ${fmtDate(c.source_date)}` : "CRM"}</td>
                    <td className="py-3 text-right">
                      {c.status === "open" && (
                        <Button variant="outline" loading={busy === c.id} onClick={() => complete(c)}>
                          Mark kept
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
