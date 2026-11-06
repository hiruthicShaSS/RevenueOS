import type { ReactNode } from "react";
import { ArrowRightLeft, BadgeDollarSign, CalendarClock, CheckCheck, Link2, ListChecks, ShieldAlert, Sparkles, Users } from "lucide-react";
import clsx from "clsx";
import type { Analysis } from "../api";
import { Badge, MemoryRow, StatusDot } from "./ui";

const stanceTone = (s: string) => (s === "champion" || s === "supporter" ? "good" : s === "blocker" || s === "skeptic" ? "bad" : "neutral");

/** What the AI extracted from one interaction or document, set against what memory already knew. */
export default function AnalysisView({ a, showConnections = true }: { a: Analysis; showConnections?: boolean }) {
  const repeated = a.repeated_facts ?? [];
  // Money talk only: amounts, discounts, prices, quotes. A bare percentage (e.g. an accuracy rate) is not pricing.
  const pricingFacts = a.facts.filter((f) => /\$\s?\d|\d+\s?%\s*(off|discount)|discount|pric(e|ing)|quote|cost|renewal|payment terms|\barr\b/i.test(f));
  return (
    <div className="fade-in space-y-6">
      <div>
        <p className="max-w-[72ch] text-[14.5px] leading-relaxed text-fg">{a.summary}</p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
          <StatusDot tone={a.risk === "high" ? "bad" : a.risk === "medium" ? "warn" : "good"} label={`${a.risk} risk`} />
          <StatusDot tone="neutral" label={`${a.sentiment} sentiment`} />
          {a.primary_blocker && <StatusDot tone="mem" label={`Real blocker: ${a.primary_blocker}`} />}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <FactColumn icon={<Sparkles className="h-4 w-4" />} title="New information" tone="text-good" items={a.facts} empty="Nothing new beyond what memory had." />
        <FactColumn icon={<CheckCheck className="h-4 w-4" />} title="Already in memory" tone="text-mute" items={repeated} empty="No repeated facts." muted />
        <div className="min-w-0">
          <Heading icon={<ArrowRightLeft className="h-4 w-4" />} title="Changed or contradicted" tone="text-warn" count={a.contradictions.length} />
          {a.contradictions.length === 0 ? (
            <p className="text-[13px] text-mute">Consistent with earlier memory.</p>
          ) : (
            <div className="space-y-2.5">
              {a.contradictions.map((c, i) => (
                <div key={i} className="rounded-xl border border-warn/25 bg-warn/[0.06] p-3 text-[13px] leading-relaxed">
                  <div className="text-mute">
                    Before: <span className="text-soft">{c.previously}</span>
                  </div>
                  <div className="mt-1 text-mute">
                    Now: <span className="text-fg">{c.now}</span>
                  </div>
                  <div className="mt-1.5 text-[12.5px] text-warn">{c.significance}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {a.stakeholders.length > 0 && (
          <Block icon={<Users className="h-4 w-4" />} title="Stakeholders">
            {a.stakeholders.map((s, i) => (
              <div key={i} className="text-[13.5px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-fg">{s.name}</span>
                  {s.role && <span className="text-mute">{s.role}</span>}
                  {s.stance !== "unknown" && <Badge tone={stanceTone(s.stance)}>{s.stance}</Badge>}
                </div>
                {s.priorities && <div className="mt-0.5 text-[13px] text-soft">{s.priorities}</div>}
              </div>
            ))}
          </Block>
        )}
        {(a.objections.length > 0 || a.requirements.length > 0) && (
          <Block icon={<ShieldAlert className="h-4 w-4" />} title="Objections & requirements">
            {a.objections.map((o, i) => (
              <div key={i} className="text-[13.5px] leading-relaxed text-soft">
                <Badge tone="bad" className="mr-2">
                  {o.category.replace("_", " ")}
                </Badge>
                {o.description}
                {o.raised_by && <span className="text-mute"> · {o.raised_by}</span>}
              </div>
            ))}
            {a.requirements.map((r, i) => (
              <div key={`r${i}`} className="text-[13.5px] leading-relaxed text-soft">
                <Badge className="mr-2">requirement</Badge>
                {r}
              </div>
            ))}
          </Block>
        )}
        {a.commitments.length > 0 && (
          <Block icon={<CalendarClock className="h-4 w-4" />} title="Promises & deadlines" tone="text-warn">
            {a.commitments.map((c, i) => (
              <div key={i} className="text-[13.5px] leading-relaxed text-soft">
                <span className="font-medium text-fg">{c.owner}</span> to {c.promised_to ?? "customer"}: {c.description}
                {c.due_date && <span className="ml-2 whitespace-nowrap text-[12.5px] text-warn">due {c.due_date}</span>}
              </div>
            ))}
          </Block>
        )}
        {(a.offers.length > 0 || pricingFacts.length > 0) && (
          <Block icon={<BadgeDollarSign className="h-4 w-4" />} title="Pricing & negotiation">
            {a.offers.map((o, i) => (
              <div key={i} className="text-[13.5px] leading-relaxed text-soft">
                {o.description}{" "}
                <Badge tone={o.response === "rejected" ? "bad" : o.response === "accepted" ? "good" : "neutral"}>{o.response}</Badge>
              </div>
            ))}
            {a.offers.length === 0 &&
              pricingFacts.map((f, i) => (
                <div key={i} className="text-[13.5px] leading-relaxed text-soft">
                  {f}
                </div>
              ))}
          </Block>
        )}
      </div>

      {showConnections && a.connections.length > 0 && (
        <Block icon={<Link2 className="h-4 w-4" />} title="Connected to earlier memories" tone="text-mem">
          {a.connections.map((c, i) => (
            <div key={i} className="space-y-1.5">
              <div className="text-[13px] text-mem">{c.explanation}</div>
              {c.memory && <MemoryRow m={c.memory} compact />}
            </div>
          ))}
        </Block>
      )}

      {a.next_actions.length > 0 && (
        <Block icon={<ListChecks className="h-4 w-4" />} title="Recommended next actions">
          <ol className="space-y-2.5">
            {a.next_actions.map((n, i) => (
              <li key={i} className="flex gap-3 text-[13.5px]">
                <span className="mt-px font-mono text-[12.5px] text-mute">{i + 1}</span>
                <div>
                  <span className="font-medium text-fg">{n.action}</span>
                  {n.owner && <span className="text-mute"> · {n.owner}</span>}
                  <div className="mt-0.5 leading-relaxed text-mute">{n.why}</div>
                </div>
              </li>
            ))}
          </ol>
        </Block>
      )}
    </div>
  );
}

function Heading({ icon, title, tone, count }: { icon: ReactNode; title: string; tone?: string; count?: number }) {
  return (
    <div className={clsx("mb-2.5 flex items-center gap-2 text-[13px] font-semibold", tone ?? "text-fg")}>
      {icon}
      <span className={tone ? undefined : "text-fg"}>{title}</span>
      {count !== undefined && <span className="font-normal text-mute">{count}</span>}
    </div>
  );
}

function FactColumn({ icon, title, tone, items, empty, muted }: { icon: ReactNode; title: string; tone: string; items: string[]; empty: string; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <Heading icon={icon} title={title} tone={tone} count={items.length} />
      {items.length === 0 ? (
        <p className="text-[13px] text-mute">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((f, i) => (
            <li key={i} className={clsx("flex gap-2 text-[13.5px] leading-relaxed", muted ? "text-mute" : "text-soft")}>
              <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-current opacity-60" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Block({ title, icon, children, tone }: { title: string; icon?: ReactNode; children: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <Heading icon={icon} title={title} tone={tone} />
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}
