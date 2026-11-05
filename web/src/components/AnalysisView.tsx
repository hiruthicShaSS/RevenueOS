import { ArrowRightLeft, CalendarClock, Link2, ShieldAlert, Users } from "lucide-react";
import type { Analysis } from "../api";
import { Badge, MemoryRow } from "./ui";

/** Renders what the AI extracted from one interaction, including links to prior memory. */
export default function AnalysisView({ a }: { a: Analysis }) {
  return (
    <div className="space-y-4 fade-in">
      <p className="text-[13.5px] leading-relaxed text-soft">{a.summary}</p>
      <div className="flex flex-wrap gap-1.5">
        <Badge tone={a.risk === "high" ? "bad" : a.risk === "medium" ? "warn" : "good"}>risk {a.risk}</Badge>
        <Badge>sentiment {a.sentiment}</Badge>
        {a.primary_blocker && <Badge tone="mem">real blocker: {a.primary_blocker}</Badge>}
      </div>

      {a.contradictions.length > 0 && (
        <Section icon={<ArrowRightLeft className="h-3.5 w-3.5" />} title="What changed vs. what we knew" tone="text-warn">
          {a.contradictions.map((c, i) => (
            <div key={i} className="rounded-xl border border-warn/20 bg-warn/[0.04] p-3 text-[13px]">
              <div className="text-mute">
                Before: <span className="text-soft">{c.previously}</span>
              </div>
              <div className="mt-1 text-mute">
                Now: <span className="text-white">{c.now}</span>
              </div>
              <div className="mt-1 text-xs text-warn">{c.significance}</div>
            </div>
          ))}
        </Section>
      )}

      {a.connections.length > 0 && (
        <Section icon={<Link2 className="h-3.5 w-3.5" />} title="Connected to earlier memories" tone="text-mem">
          {a.connections.map((c, i) => (
            <div key={i} className="space-y-1.5">
              <div className="text-xs text-mem">{c.explanation}</div>
              <MemoryRow m={c.memory} compact />
            </div>
          ))}
        </Section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {a.objections.length > 0 && (
          <Section icon={<ShieldAlert className="h-3.5 w-3.5" />} title="Objections">
            {a.objections.map((o, i) => (
              <div key={i} className="text-[13px] text-soft">
                <Badge tone="bad" className="mr-1.5">
                  {o.category}
                </Badge>
                {o.description}
                {o.raised_by && <span className="text-mute"> — {o.raised_by}</span>}
              </div>
            ))}
          </Section>
        )}
        {a.commitments.length > 0 && (
          <Section icon={<CalendarClock className="h-3.5 w-3.5" />} title="Promises detected">
            {a.commitments.map((c, i) => (
              <div key={i} className="text-[13px] text-soft">
                <span className="text-white">{c.owner}</span> → {c.promised_to ?? "customer"}: {c.description}
                {c.due_date && <Badge tone="warn" className="ml-1.5">due {c.due_date}</Badge>}
              </div>
            ))}
          </Section>
        )}
        {a.stakeholders.length > 0 && (
          <Section icon={<Users className="h-3.5 w-3.5" />} title="Stakeholders">
            {a.stakeholders.map((s, i) => (
              <div key={i} className="text-[13px] text-soft">
                <span className="text-white">{s.name}</span>
                {s.role && <span className="text-mute"> · {s.role}</span>}
                {s.stance !== "unknown" && (
                  <Badge className="ml-1.5" tone={s.stance === "champion" || s.stance === "supporter" ? "good" : s.stance === "blocker" || s.stance === "skeptic" ? "bad" : "neutral"}>
                    {s.stance}
                  </Badge>
                )}
                {s.priorities && <div className="text-xs text-mute">{s.priorities}</div>}
              </div>
            ))}
          </Section>
        )}
        {a.offers.length > 0 && (
          <Section title="Offers">
            {a.offers.map((o, i) => (
              <div key={i} className="text-[13px] text-soft">
                {o.description} <Badge tone={o.response === "rejected" ? "bad" : o.response === "accepted" ? "good" : "neutral"}>{o.response}</Badge>
              </div>
            ))}
          </Section>
        )}
      </div>

      {a.next_actions.length > 0 && (
        <Section title="Recommended next actions">
          <ol className="space-y-1.5">
            {a.next_actions.map((n, i) => (
              <li key={i} className="text-[13px] text-soft">
                <span className="mr-2 font-mono text-xs text-accent">{i + 1}.</span>
                <span className="text-white">{n.action}</span>
                {n.owner && <span className="text-mute"> ({n.owner})</span>}
                <div className="ml-5 text-xs text-mute">{n.why}</div>
              </li>
            ))}
          </ol>
        </Section>
      )}
    </div>
  );
}

function Section({ title, icon, children, tone }: { title: string; icon?: React.ReactNode; children: React.ReactNode; tone?: string }) {
  return (
    <div>
      <div className={`mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${tone ?? "text-mute"}`}>
        {icon}
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
