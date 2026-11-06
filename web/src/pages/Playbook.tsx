import { useState } from "react";
import clsx from "clsx";
import { BookOpenCheck, EyeOff, RefreshCw, Sparkles, ThumbsDown, ThumbsUp, Trophy } from "lucide-react";
import { api, fmtDate, fmtMoney, type Deal, type MemoryHit } from "../api";
import { useApi } from "../hooks";
import { Badge, Button, Card, Disclosure, Empty, ErrorBox, MD, MemoryRow, PageHeader, SectionTitle, Segmented, Select, Skeleton, Spinner, StatusDot, inputCls } from "../components/ui";

interface Lesson {
  id: string;
  outcome: "won" | "lost";
  profile: string;
  industry: string | null;
  blocker: string;
  theme: { id: string; label: string };
  tactics: string;
  why: string;
  lesson: string | null;
  recordedAt: string | null;
}
interface Pattern {
  id: string;
  label: string;
  outcomes: number;
  won: number;
  lost: number;
  confidence: "strong" | "moderate" | "limited";
  winning: { id: string; tactics: string; why: string; lesson: string | null }[];
  losing: { id: string; tactics: string; why: string; lesson: string | null }[];
}
interface PlaybookData {
  bank: string;
  mentalModel: { id: string; name: string; content: string | null; lastRefreshedAt: string | null } | null;
  lessons: Lesson[];
  patterns: Pattern[];
  observations: MemoryHit[];
}

const CONF = {
  strong: { tone: "good" as const, label: "Strong evidence", note: "3+ recorded outcomes" },
  moderate: { tone: "warn" as const, label: "Moderate evidence", note: "2 recorded outcomes" },
  limited: { tone: "neutral" as const, label: "Limited observation", note: "1 recorded outcome" },
};

export default function Playbook() {
  const { data, error, loading, reload } = useApi<PlaybookData>("/playbook");
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [theme, setTheme] = useState("all");

  async function refresh() {
    setRefreshing(true);
    setMsg(null);
    try {
      await api.post("/playbook/refresh");
      setMsg("Refresh queued. Hindsight regenerates the summary from every lesson in the background; reload in a minute.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  const patternOf = (l: Lesson) => data?.patterns.find((p) => p.id === l.theme.id);
  const lessons = (data?.lessons ?? []).filter((l) => theme === "all" || l.theme.id === theme);

  return (
    <div>
      <PageHeader
        title="Negotiation playbook"
        subtitle="Every closed deal contributes to RevenueOS's collective intelligence. We extract negotiation patterns, anonymise customer-specific information and use these lessons to improve future recommendations across accounts."
      />
      {error && <ErrorBox error={error} onRetry={reload} />}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-10">
          <div className="flex items-start gap-3 rounded-2xl border border-line bg-panel px-5 py-4 text-[13.5px] leading-relaxed text-soft shadow-card">
            <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-mem" />
            <div>
              <span className="font-medium text-fg">Private by design.</span> Customer memories stay in each account's own bank. Lessons here carry no customer, stakeholder or rep names, no exact amounts or dates, and
              never the raw conversation: only industry, size band, the type of blocker, what was tried and why it worked. They come only from recorded won or lost outcomes.
            </div>
          </div>

          <section>
            <SectionTitle title="What wins, by blocker" subtitle="Recorded outcomes grouped by the blocker they faced" />
            {loading && !data ? (
              <div className="grid gap-5 md:grid-cols-2">
                <Skeleton className="h-48" />
                <Skeleton className="h-48" />
              </div>
            ) : !data?.patterns.length ? (
              <Empty title="No outcomes yet">Close a deal on the right to record the first lesson.</Empty>
            ) : (
              <div className="grid gap-5 md:grid-cols-2">
                {data.patterns.map((p) => (
                  <PatternCard key={p.id} p={p} />
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionTitle
              title="Lessons"
              subtitle={data ? `${data.lessons.length} anonymised outcomes in the shared playbook memory` : undefined}
              action={
                data && data.patterns.length > 1 ? (
                  <Select value={theme} onChange={setTheme}>
                    <option value="all">All blockers</option>
                    {data.patterns.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                ) : undefined
              }
            />
            <div className="space-y-4">
              {lessons.map((l) => {
                const p = patternOf(l);
                return (
                  <article key={l.id} className="rounded-2xl border border-line bg-panel p-6 shadow-card">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <StatusDot tone={l.outcome === "won" ? "good" : "bad"} label={l.outcome === "won" ? "Won" : "Lost"} />
                      <Badge>{l.theme.label}</Badge>
                      {p && <Badge tone={CONF[p.confidence].tone}>{CONF[p.confidence].label}</Badge>}
                      <span className="ml-auto text-[12.5px] text-mute">{l.recordedAt ? `Recorded ${fmtDate(l.recordedAt)}` : ""}</span>
                    </div>
                    {l.lesson && <p className="mt-4 text-[15px] font-medium leading-relaxed text-fg">{l.lesson}</p>}
                    <dl className="mt-4 grid gap-x-8 gap-y-3 text-[13.5px] md:grid-cols-2">
                      <Field label="Primary blocker">{l.blocker}</Field>
                      <Field label={l.outcome === "won" ? "Winning tactic" : "Tactic that failed"}>{l.tactics}</Field>
                      <Field label={l.outcome === "won" ? "Why it worked" : "Why it failed"} wide>
                        {l.why || "Not recorded"}
                      </Field>
                    </dl>
                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 text-[12.5px] text-mute">
                      <span>Evidence: {l.profile}</span>
                      {p && (
                        <span>
                          {p.outcomes} relevant outcome{p.outcomes === 1 ? "" : "s"} for this blocker ({p.won} won, {p.lost} lost)
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section>
            <Card
              tone="mem"
              title={
                <span className="flex items-center gap-2">
                  <BookOpenCheck className="h-4 w-4 text-mem" /> Hindsight summary
                </span>
              }
              subtitle={
                data?.mentalModel?.lastRefreshedAt
                  ? `Mental model regenerated from every lesson · ${fmtDate(data.mentalModel.lastRefreshedAt)}`
                  : "A Hindsight mental model regenerated from every lesson"
              }
              action={
                <Button variant="outline" onClick={refresh} loading={refreshing}>
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh
                </Button>
              }
            >
              {msg && <div className="mb-3 text-[13px] text-mem">{msg}</div>}
              {loading && !data ? (
                <Skeleton className="h-40" />
              ) : data?.mentalModel?.content ? (
                <Disclosure summary={<span className="text-[13.5px] font-medium text-soft">Show the full summary</span>}>
                  <MD>{data.mentalModel.content}</MD>
                </Disclosure>
              ) : (
                <p className="text-[13.5px] text-mute">Not generated yet. Record an outcome, then refresh.</p>
              )}
              {data && data.observations.length > 0 && (
                <div className="mt-5 border-t border-line pt-4">
                  <Disclosure summary={<span className="text-[13.5px] font-medium text-soft">Patterns Hindsight consolidated across deals ({data.observations.length})</span>}>
                    <div className="space-y-2">
                      {data.observations.slice(0, 12).map((m) => (
                        <MemoryRow key={m.id} m={m} compact />
                      ))}
                    </div>
                  </Disclosure>
                </div>
              )}
            </Card>
          </section>
        </div>

        <RecordOutcome onDone={reload} />
      </div>
    </div>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={clsx(wide && "md:col-span-2")}>
      <dt className="text-[12.5px] text-mute">{label}</dt>
      <dd className="mt-0.5 leading-relaxed text-soft">{children}</dd>
    </div>
  );
}

function PatternCard({ p }: { p: Pattern }) {
  const c = CONF[p.confidence];
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-panel p-6 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[16px] font-semibold text-fg">{p.label}</div>
          <div className="mt-1 text-[12.5px] text-mute">
            {p.outcomes} outcome{p.outcomes === 1 ? "" : "s"} · {p.won} won · {p.lost} lost
          </div>
        </div>
        <Badge tone={c.tone}>{c.label}</Badge>
      </div>
      <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-fg/[0.06]">
        <div className="bg-good" style={{ width: `${(p.won / p.outcomes) * 100}%` }} />
        <div className="bg-bad/70" style={{ width: `${(p.lost / p.outcomes) * 100}%` }} />
      </div>
      {p.winning.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-good">
            <ThumbsUp className="h-3.5 w-3.5" /> What won
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {p.winning.map((w) => (
              <li key={w.id} className="text-[13.5px] leading-relaxed text-soft">
                {w.lesson ?? w.tactics}
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.losing.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-bad">
            <ThumbsDown className="h-3.5 w-3.5" /> What lost
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {p.losing.map((w) => (
              <li key={w.id} className="text-[13.5px] leading-relaxed text-soft">
                {w.lesson ?? w.tactics}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface SavedLesson {
  blocker: string;
  tactics: string;
  why: string;
  lesson: string;
  outcome: "won" | "lost";
  industry: string;
  size: string;
}

function RecordOutcome({ onDone }: { onDone: () => void }) {
  const { data, reload: reloadDeals } = useApi<{ deals: Deal[] }>("/overview");
  const open = (data?.deals ?? []).filter((d) => d.status === "open");
  const [dealId, setDealId] = useState("");
  const [outcome, setOutcome] = useState<"won" | "lost">("won");
  const [blocker, setBlocker] = useState("");
  const [tactics, setTactics] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<null | "draft" | "save">(null);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedLesson | null>(null);
  const deal = open.find((d) => d.id === dealId);

  async function draft() {
    setBusy("draft");
    setErr(null);
    setDraftNote(null);
    try {
      const r = await api.post<{ draft: { primary_blocker: string; tactics: string; reason: string } | null; evidence: unknown[]; message: string | null }>(`/deals/${dealId}/outcome-draft`, { outcome });
      if (r.draft) {
        setBlocker(r.draft.primary_blocker);
        setTactics(r.draft.tactics);
        setReason(r.draft.reason);
        setDraftNote(`Drafted from ${r.evidence.length} of this account's memories. Check it before saving.`);
      } else setDraftNote(r.message);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    setBusy("save");
    setErr(null);
    setSaved(null);
    try {
      const r = await api.post<{ ok: boolean; errors: string[]; lesson: SavedLesson }>(`/deals/${dealId}/outcome`, { outcome, primaryBlocker: blocker, tactics, reason });
      if (!r.ok) setErr(r.errors.join("; "));
      setSaved(r.lesson);
      setDealId("");
      setBlocker("");
      setTactics("");
      setReason("");
      setDraftNote(null);
      onDone();
      reloadDeals();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <aside className="min-w-0 xl:sticky xl:top-4 xl:self-start">
      <Card
        title={
          <span className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-warn" /> Close a deal and teach the playbook
          </span>
        }
        subtitle="The full outcome stays in the account's memory. An anonymised lesson goes to the shared playbook."
      >
        <div className="space-y-4">
          <Select
            value={dealId}
            onChange={(v) => {
              setDealId(v);
              setSaved(null);
              const d = open.find((x) => x.id === v);
              setBlocker(d?.primaryBlocker ?? "");
            }}
            className="w-full !py-2.5"
          >
            <option value="">Select an open deal…</option>
            {open.map((d) => (
              <option key={d.id} value={d.id}>
                {d.customer} · {fmtMoney(d.amount)}
              </option>
            ))}
          </Select>
          <Segmented<"won" | "lost">
            value={outcome}
            onChange={setOutcome}
            options={[
              { value: "won", label: "Won" },
              { value: "lost", label: "Lost" },
            ]}
          />
          <Button variant="mem" className="w-full" onClick={draft} loading={busy === "draft"} disabled={!dealId}>
            <Sparkles className="h-4 w-4" /> Draft from account memory
          </Button>
          {busy === "draft" && <Spinner label="Recalling the account's history…" />}
          {draftNote && <p className="text-[12.5px] leading-relaxed text-mem">{draftNote}</p>}
          <label className="block">
            <span className="text-[12.5px] text-mute">Primary blocker</span>
            <input className={`${inputCls} mt-1.5`} placeholder="e.g. SAP integration risk" value={blocker} onChange={(e) => setBlocker(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-[12.5px] text-mute">Tactics used</span>
            <textarea className={`${inputCls} mt-1.5 min-h-[80px]`} placeholder="e.g. sandbox demo with their CTO, 30-day milestone plan, no discount" value={tactics} onChange={(e) => setTactics(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-[12.5px] text-mute">Why it was {outcome}</span>
            <textarea className={`${inputCls} mt-1.5 min-h-[70px]`} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <Button onClick={submit} loading={busy === "save"} disabled={!dealId || !blocker.trim() || !tactics.trim()} className="w-full">
            {busy === "save" ? "Anonymising and saving…" : "Record outcome"}
          </Button>
          {deal && <p className="text-[12.5px] leading-relaxed text-mute">Names, amounts and dates are removed before anything reaches the shared playbook.</p>}
          {err && <ErrorBox error={err} />}
          {saved && (
            <div className="fade-in rounded-xl border border-good/30 bg-good/[0.07] p-4">
              <div className="text-[13px] font-medium text-good">Saved. This anonymised lesson is now in the playbook:</div>
              {saved.lesson && <p className="mt-2 text-[13.5px] font-medium leading-relaxed text-fg">{saved.lesson}</p>}
              <dl className="mt-2 space-y-1 text-[12.5px] leading-relaxed text-soft">
                <div>
                  <span className="text-mute">Blocker:</span> {saved.blocker}
                </div>
                <div>
                  <span className="text-mute">Tactics:</span> {saved.tactics}
                </div>
                <div>
                  <span className="text-mute">Why:</span> {saved.why}
                </div>
                <div className="text-mute">
                  {saved.industry} · {saved.size}
                </div>
              </dl>
            </div>
          )}
        </div>
      </Card>
    </aside>
  );
}
