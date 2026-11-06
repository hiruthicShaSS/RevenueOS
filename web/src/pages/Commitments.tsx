import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import clsx from "clsx";
import { api, fmtDate, type Commitment } from "../api";
import { useApi } from "../hooks";
import { Button, Card, Empty, ErrorBox, PageHeader, Segmented, Skeleton, StatusDot } from "../components/ui";

type Status = "overdue" | "upcoming" | "open" | "done";
type Filter = "active" | "overdue" | "upcoming" | "done" | "all";

const in7 = () => new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
function statusOf(c: Commitment): Status {
  if (c.status === "done") return "done";
  if (c.overdue) return "overdue";
  if (c.due_date && c.due_date <= in7()) return "upcoming";
  return "open";
}
const STATUS: Record<Status, { tone: "bad" | "warn" | "neutral" | "good"; label: (c: Commitment) => string }> = {
  overdue: { tone: "bad", label: (c) => `Overdue · ${fmtDate(c.due_date)}` },
  upcoming: { tone: "warn", label: (c) => `Due ${fmtDate(c.due_date)}` },
  open: { tone: "neutral", label: (c) => (c.due_date ? `Due ${fmtDate(c.due_date)}` : "No due date") },
  done: { tone: "good", label: (c) => (c.completed_at ? `Kept ${fmtDate(c.completed_at)}` : "Kept") },
};

export default function Commitments() {
  const { data, error, loading, reload } = useApi<Commitment[]>("/commitments");
  const [filter, setFilter] = useState<Filter>("active");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const all = data ?? [];
  const count = (f: Filter) => all.filter((c) => match(c, f)).length;
  const rows = all.filter((c) => match(c, filter));

  async function complete(c: Commitment) {
    setBusy(c.id);
    setMsg(null);
    try {
      const r = await api.post<{ memoryError: string | null }>(`/commitments/${c.id}/complete`);
      setMsg(r.memoryError ? { ok: false, text: `Marked kept, but the memory write failed: ${r.memoryError}` } : { ok: true, text: `Marked kept and added to ${c.customer}'s memory: "${c.description}"` });
      await reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Commitments"
        subtitle="Every promise made in a meeting is detected, tracked and remembered, including when it's kept. Unkept promises are the fastest way to lose a negotiation."
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "active", label: <>Open <Count n={count("active")} /></> },
            { value: "overdue", label: <>Overdue <Count n={count("overdue")} /></> },
            { value: "upcoming", label: <>Due this week <Count n={count("upcoming")} /></> },
            { value: "done", label: <>Kept <Count n={count("done")} /></> },
            { value: "all", label: <>All <Count n={count("all")} /></> },
          ]}
        />
      </div>

      {msg && <div className={clsx("mb-5 rounded-xl px-4 py-3 text-[13.5px]", msg.ok ? "bg-good/10 text-good" : "bg-bad/10 text-bad")}>{msg.text}</div>}
      {error && <ErrorBox error={error} onRetry={reload} />}

      <Card bodyClassName="!p-0">
        {loading && !data ? (
          <div className="p-6">
            <Skeleton className="h-60" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <Empty icon={<CheckCircle2 className="h-6 w-6" />} title={filter === "overdue" ? "Nothing overdue" : "No commitments here"} />
          </div>
        ) : (
          <>
            <table className="hidden w-full table-fixed text-left text-[13.5px] lg:table">
              <colgroup>
                <col />
                <col className="w-[21%]" />
                <col className="w-[16%]" />
                <col className="w-[15%]" />
                <col className="w-[13%]" />
                <col className="w-[128px]" />
              </colgroup>
              <thead className="text-[12px] text-mute">
                <tr className="border-b border-line">
                  <th className="px-6 py-3.5 font-medium">Promise</th>
                  <th className="py-3.5 pr-4 font-medium">Made by → to</th>
                  <th className="py-3.5 pr-4 font-medium">Account</th>
                  <th className="py-3.5 pr-4 font-medium">Status</th>
                  <th className="py-3.5 pr-4 font-medium">Source</th>
                  <th className="py-3.5 pr-6" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const s = statusOf(c);
                  return (
                    <tr key={c.id} className={clsx("border-b border-line align-top last:border-0", s === "overdue" && "bg-bad/[0.035]")}>
                      <td className={clsx("px-6 py-4 leading-relaxed", s === "done" ? "text-mute line-through decoration-mute/40" : "text-fg")}>{c.description}</td>
                      <td className="py-4 pr-4 leading-relaxed text-soft">
                        {c.owner} <span className="text-mute">→</span> {c.promised_to ?? "customer"}
                      </td>
                      <td className="py-4 pr-4">
                        <Link to={`/customers/${c.customer_id}`} className="text-soft hover:text-fg hover:underline">
                          {c.customer}
                        </Link>
                      </td>
                      <td className="py-4 pr-4">
                        <StatusDot tone={STATUS[s].tone} label={STATUS[s].label(c)} />
                      </td>
                      <td className="py-4 pr-4 text-[12.5px] leading-relaxed text-mute">{c.source_kind ? `${c.source_kind.replace("_", " ")}, ${fmtDate(c.source_date)}` : "CRM"}</td>
                      <td className="py-3 pr-6 text-right">
                        {c.status === "open" && (
                          <Button variant="outline" className="!px-3 !py-1.5" loading={busy === c.id} onClick={() => complete(c)}>
                            <CheckCircle2 className="h-3.5 w-3.5" /> Mark kept
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <ul className="divide-y divide-line lg:hidden">
              {rows.map((c) => {
                const s = statusOf(c);
                return (
                  <li key={c.id} className="px-5 py-4">
                    <div className={clsx("text-[14px] leading-relaxed", s === "done" ? "text-mute line-through" : "text-fg")}>{c.description}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-mute">
                      <StatusDot tone={STATUS[s].tone} label={STATUS[s].label(c)} />
                      <Link to={`/customers/${c.customer_id}`} className="hover:text-fg">
                        {c.customer}
                      </Link>
                      <span>
                        {c.owner} → {c.promised_to ?? "customer"}
                      </span>
                    </div>
                    {c.status === "open" && (
                      <Button variant="outline" className="mt-3 !px-3 !py-1.5" loading={busy === c.id} onClick={() => complete(c)}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Mark kept
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}

function match(c: Commitment, f: Filter) {
  const s = statusOf(c);
  if (f === "all") return true;
  if (f === "active") return s !== "done";
  return s === f;
}

const Count = ({ n }: { n: number }) => <span className="font-mono text-[11.5px] text-mute">{n}</span>;
