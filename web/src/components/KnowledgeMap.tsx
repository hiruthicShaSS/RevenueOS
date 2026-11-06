import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Building2, ChevronRight, Crosshair, FileText, Link2, X } from "lucide-react";
import { fmtDate, fmtMoney, type Commitment } from "../api";
import { useTokens, type Tokens } from "../theme";
import { Badge, StatusDot, typeLabel } from "./ui";

/* ------------------------------------------------------------------ data */

export interface MapNode {
  id: string;
  text: string;
  type: string | null;
  occurredAt: string | null;
  category: string;
  stakeholders: string[];
  entities: string[];
  tags: string[];
  proofCount: number | null;
  source: {
    interactionId: string | null;
    kind: string | null;
    rep: string | null;
    repTitle: string | null;
    date: string | null;
    summary: string | null;
    file: string | null;
    pages: number | null;
    context: string | null;
  };
}
export interface MapData {
  customer: { id: string; name: string; industry: string; hq: string };
  bank: string;
  total: number;
  lastUpdated: string | null;
  categories: { id: string; label: string; count: number }[];
  nodes: MapNode[];
  links: { source: string; target: string; type: string; weight: number; entity: string | null }[];
  stakeholders: { id: string; name: string; role: string | null }[];
  commitments: Commitment[];
  deals: { id: string; name: string; stage: string; status: string; amount: number }[];
}

export interface MapFilters {
  q: string;
  category: string;
  stakeholder: string;
  since: string; // "" | ISO date
}

/** One colour per category, shared by nodes, shortcuts and the legend. */
export function categoryColor(id: string, t: Tokens, dark: boolean) {
  const extra = dark ? { blue: "#5aa8ff", cyan: "#38c6e8", pink: "#e77fd0" } : { blue: "#2f6fbe", cyan: "#16819a", pink: "#b24c97" };
  return (
    {
      profile: t.accentStrong,
      people: extra.blue,
      conversations: t.mute,
      negotiation: t.good,
      objections: t.bad,
      commitments: t.warn,
      deals: extra.cyan,
      preferences: extra.pink,
      decisions: t.mem,
    } as Record<string, string>
  )[id] ?? t.mute;
}

const LINK_LABEL: Record<string, string> = {
  semantic: "Similar meaning",
  temporal: "Close in time",
  caused_by: "Cause and effect",
  entity: "Same person or organisation",
};

const RIGHT = ["profile", "people", "conversations", "negotiation", "objections"];
const W = { center: 230, cat: 210, mem: 260 };
const H = { center: 76, cat: 58, mem: 82 };
const GAP = { mem: 14, cat: 34 };
const POS_X = { cat: 320, mem: 320 + 210 + 80 };

export function titleOf(text: string) {
  const first = text.split(/(?<=[.!?])\s|\s\|\s/)[0];
  return first.length > 90 ? first.slice(0, 88) + "…" : first;
}

export function matchesFilters(n: MapNode, f: MapFilters) {
  if (f.category && n.category !== f.category) return false;
  if (f.stakeholder && !n.stakeholders.includes(f.stakeholder)) return false;
  if (f.since && (!n.occurredAt || n.occurredAt.slice(0, 10) < f.since)) return false;
  if (f.q && !`${n.text} ${n.stakeholders.join(" ")} ${n.source.file ?? ""}`.toLowerCase().includes(f.q.toLowerCase())) return false;
  return true;
}

/* ------------------------------------------------------------------ nodes */

type CenterData = { name: string; sub: string; total: number };
type CatData = { label: string; count: number; shown: number; color: string; expanded: boolean; side: 1 | -1 };
type MemData = { node: MapNode; color: string; selected: boolean; related: boolean; side: 1 | -1 };

const hidden = "!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent";

const CenterNode = memo(({ data }: NodeProps<Node<CenterData>>) => (
  <div className="flex items-center gap-3 rounded-2xl border-2 border-accent bg-raised px-5 py-3.5 shadow-card" style={{ width: W.center, height: H.center }}>
    <Handle type="source" position={Position.Right} id="r" className={hidden} />
    <Handle type="source" position={Position.Left} id="l" className={hidden} />
    <Building2 className="h-5 w-5 shrink-0 text-accent-strong dark:text-accent" />
    <div className="min-w-0">
      <div className="truncate text-[15px] font-semibold text-fg">{data.name}</div>
      <div className="truncate text-[11.5px] text-mute">
        {data.total} memories · {data.sub}
      </div>
    </div>
  </div>
));

const CategoryNode = memo(({ data }: NodeProps<Node<CatData>>) => (
  <div
    className={clsx("flex cursor-pointer items-center gap-2.5 rounded-xl border bg-raised px-3.5 shadow-card transition hover:brightness-[1.03]", data.count === 0 && "opacity-45")}
    style={{ width: W.cat, height: H.cat, borderColor: data.color }}
  >
    <Handle type="target" position={data.side > 0 ? Position.Left : Position.Right} id="in" className={hidden} />
    <Handle type="source" position={data.side > 0 ? Position.Right : Position.Left} id="out" className={hidden} />
    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: data.color }} />
    <div className="min-w-0 flex-1">
      <div className="truncate text-[13px] font-semibold text-fg">{data.label}</div>
      <div className="text-[11px] text-mute">{data.shown === data.count ? `${data.count} memories` : `${data.shown} of ${data.count} shown`}</div>
    </div>
    {data.count > 0 && <ChevronRight className={clsx("h-4 w-4 shrink-0 text-mute transition", data.expanded && (data.side > 0 ? "rotate-0" : "rotate-180"), !data.expanded && "rotate-90")} />}
  </div>
));

const MemoryNode = memo(({ data }: NodeProps<Node<MemData>>) => {
  const n = data.node;
  return (
    <div
      className={clsx(
        "cursor-pointer rounded-xl border bg-raised px-3 py-2 shadow-card transition",
        data.selected ? "ring-2 ring-mem" : data.related ? "ring-1 ring-mem/60" : "hover:border-line-2"
      )}
      style={{ width: W.mem, height: H.mem, borderLeft: `3px solid ${data.color}` }}
    >
      <Handle type="target" position={Position.Left} id="l-in" className={hidden} />
      <Handle type="target" position={Position.Right} id="r-in" className={hidden} />
      <Handle type="source" position={Position.Left} id="l-out" className={hidden} />
      <Handle type="source" position={Position.Right} id="r-out" className={hidden} />
      <div className="flex items-center gap-1.5 text-[10.5px] text-mute">
        <span>{typeLabel(n.type)}</span>
        {n.occurredAt && <span>· {fmtDate(n.occurredAt).replace(/, \d{4}/, "")}</span>}
        {n.stakeholders[0] && <span className="truncate">· {n.stakeholders.join(", ")}</span>}
      </div>
      <div className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-fg">{n.text}</div>
    </div>
  );
});

const nodeTypes = { center: CenterNode, category: CategoryNode, memory: MemoryNode };

/* ------------------------------------------------------------------ map */

export default function KnowledgeMap(props: {
  data: MapData;
  filters: MapFilters;
  expanded: Set<string>;
  onToggle: (cat: string) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  focusCategory: string | null;
  dark: boolean;
}) {
  return (
    <ReactFlowProvider>
      <MapInner {...props} />
    </ReactFlowProvider>
  );
}

function MapInner({ data, filters, expanded, onToggle, selected, onSelect, focusCategory, dark }: Parameters<typeof KnowledgeMap>[0]) {
  const t = useTokens();
  const rf = useReactFlow();
  const [showAllLinks, setShowAllLinks] = useState(false);

  const visible = useMemo(() => data.nodes.filter((n) => matchesFilters(n, filters)), [data, filters]);
  const relatedIds = useMemo(() => {
    if (!selected) return new Set<string>();
    const s = new Set<string>();
    for (const l of data.links) {
      if (l.source === selected) s.add(l.target);
      if (l.target === selected) s.add(l.source);
    }
    return s;
  }, [data.links, selected]);

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    nodes.push({
      id: "center",
      type: "center",
      position: { x: -W.center / 2, y: -H.center / 2 },
      data: { name: data.customer.name, sub: data.customer.industry, total: data.total },
      draggable: false,
    });
    const pos = new Map<string, { x: number; y: number; side: 1 | -1 }>();
    for (const side of [1, -1] as const) {
      const cats = data.categories.filter((c) => (side > 0 ? RIGHT.includes(c.id) : !RIGHT.includes(c.id)));
      const blocks = cats.map((c) => {
        const mems = expanded.has(c.id) ? visible.filter((n) => n.category === c.id) : [];
        const h = Math.max(H.cat, mems.length * (H.mem + GAP.mem) - GAP.mem);
        return { c, mems, h };
      });
      const total = blocks.reduce((s, b) => s + b.h, 0) + GAP.cat * (blocks.length - 1);
      let y = -total / 2;
      for (const { c, mems, h } of blocks) {
        const color = categoryColor(c.id, t, dark);
        const catX = side > 0 ? POS_X.cat : -POS_X.cat - W.cat;
        const shown = visible.filter((n) => n.category === c.id).length;
        nodes.push({
          id: `cat:${c.id}`,
          type: "category",
          position: { x: catX, y: y + h / 2 - H.cat / 2 },
          data: { label: c.label, count: c.count, shown, color, expanded: expanded.has(c.id), side },
          draggable: false,
        });
        edges.push({
          id: `e:center:${c.id}`,
          source: "center",
          sourceHandle: side > 0 ? "r" : "l",
          target: `cat:${c.id}`,
          targetHandle: "in",
          style: { stroke: color, strokeWidth: 1.5, opacity: c.count ? 0.7 : 0.25 },
        });
        mems.forEach((n, i) => {
          const mx = side > 0 ? POS_X.mem : -POS_X.mem - W.mem;
          const my = y + i * (H.mem + GAP.mem);
          pos.set(n.id, { x: mx, y: my, side });
          nodes.push({
            id: n.id,
            type: "memory",
            position: { x: mx, y: my },
            data: { node: n, color, selected: n.id === selected, related: relatedIds.has(n.id), side },
            draggable: false,
          });
          edges.push({
            id: `e:${c.id}:${n.id}`,
            source: `cat:${c.id}`,
            sourceHandle: "out",
            target: n.id,
            targetHandle: side > 0 ? "l-in" : "r-in",
            style: { stroke: color, strokeWidth: 1, opacity: 0.45 },
          });
        });
        y += h + GAP.cat;
      }
    }

    // Relationships Hindsight recorded between memories: for the selected memory, or all of them on request.
    const seen = new Set<string>();
    for (const l of data.links) {
      const forSelected = selected && (l.source === selected || l.target === selected);
      if (!forSelected && !(showAllLinks && l.type !== "entity")) continue;
      const a = pos.get(l.source);
      const b = pos.get(l.target);
      if (!a || !b) continue;
      const key = [l.source, l.target].sort().join("|") + l.type;
      if (seen.has(key)) continue;
      seen.add(key);
      const sameColumn = a.side === b.side;
      edges.push({
        id: `rel:${key}`,
        source: l.source,
        target: l.target,
        sourceHandle: sameColumn ? (a.side > 0 ? "r-out" : "l-out") : a.x < b.x ? "r-out" : "l-out",
        targetHandle: sameColumn ? (b.side > 0 ? "r-in" : "l-in") : a.x < b.x ? "l-in" : "r-in",
        type: "default",
        animated: !!forSelected && l.type !== "entity",
        style: {
          stroke: t.mem,
          strokeWidth: forSelected ? 1.6 : 1,
          opacity: forSelected ? 0.9 : 0.35,
          strokeDasharray: l.type === "entity" ? "2 4" : undefined,
        },
      });
    }
    return { nodes, edges };
  }, [data, visible, expanded, selected, relatedIds, showAllLinks, t, dark]);

  // Fit to a category when a shortcut is used, or to the selected memory on deep link.
  useEffect(() => {
    if (!focusCategory) return;
    const ids = [`cat:${focusCategory}`, ...visible.filter((n) => n.category === focusCategory).map((n) => n.id)];
    const tm = window.setTimeout(() => rf.fitView({ nodes: ids.map((id) => ({ id })), duration: 450, padding: 0.25, maxZoom: 1.1 }), 60);
    return () => window.clearTimeout(tm);
  }, [focusCategory, rf, visible]);

  const recenter = useCallback(() => rf.fitView({ duration: 450, padding: 0.15 }), [rf]);

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.22 }}
        minZoom={0.15}
        maxZoom={1.75}
        nodesConnectable={false}
        elementsSelectable={false}
        onNodeClick={(_e, n) => {
          if (n.type === "category") onToggle(n.id.slice(4));
          else if (n.type === "memory") onSelect(n.id === selected ? null : n.id);
          else onSelect(null);
        }}
        onPaneClick={() => onSelect(null)}
      >
        <Background gap={22} size={1} color={t.line} />
        <Controls showInteractive={false} position="top-right" />
        <MiniMap pannable zoomable position="bottom-right" nodeColor={(n) => (n.type === "memory" ? (n.data as MemData).color : n.type === "category" ? (n.data as CatData).color : t.accent)} maskColor="transparent" style={{ width: 150, height: 100, border: `1px solid ${t.line}` }} />
      </ReactFlow>

      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2">
        <button onClick={recenter} className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 py-1.5 text-[12px] font-medium text-soft shadow-card hover:text-fg">
          <Crosshair className="h-3.5 w-3.5" /> Back to {data.customer.name.split(" ")[0]}
        </button>
        <label className="pointer-events-auto flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 py-1.5 text-[12px] text-soft shadow-card">
          <input type="checkbox" checked={showAllLinks} onChange={(e) => setShowAllLinks(e.target.checked)} className="accent-[var(--mem)]" />
          Show all recorded links
        </label>
      </div>
      <Legend data={data} t={t} dark={dark} />
    </div>
  );
}

function Legend({ data, t, dark }: { data: MapData; t: Tokens; dark: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute bottom-3 left-3 w-[250px] rounded-xl border border-line bg-raised/95 px-3 py-2.5 text-[11.5px] text-soft shadow-card backdrop-blur">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between font-semibold text-fg">
        Legend <ChevronRight className={clsx("h-3.5 w-3.5 transition", open ? "rotate-90" : "")} />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {data.categories.map((c) => (
              <span key={c.id} className="flex items-center gap-1.5 truncate">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: categoryColor(c.id, t, dark) }} />
                {c.label.split(" ")[0].replace("&", "")}
              </span>
            ))}
          </div>
          <div className="space-y-1 border-t border-line pt-2">
            <div className="flex items-center gap-2">
              <svg width="26" height="6">
                <line x1="0" y1="3" x2="26" y2="3" stroke={t.mem} strokeWidth="1.6" />
              </svg>
              Link recorded by Hindsight
            </div>
            <div className="flex items-center gap-2">
              <svg width="26" height="6">
                <line x1="0" y1="3" x2="26" y2="3" stroke={t.mem} strokeWidth="1.6" strokeDasharray="2 4" />
              </svg>
              Same person or organisation
            </div>
            <div className="text-mute">Categories are grouped by RevenueOS from each memory's text and tags.</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ detail panel */

const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
function overlap(a: string, b: string) {
  const x = tokens(a);
  const y = tokens(b);
  let n = 0;
  x.forEach((w) => y.has(w) && n++);
  return n / Math.max(1, Math.min(x.size, y.size));
}

export function MemoryDetail({
  data,
  id,
  onSelect,
  onClose,
  dark,
}: {
  data: MapData;
  id: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  dark: boolean;
}) {
  const t = useTokens();
  const n = data.nodes.find((x) => x.id === id);
  if (!n) return null;
  const cat = data.categories.find((c) => c.id === n.category);
  const color = categoryColor(n.category, t, dark);

  const related = new Map<string, { node: MapNode; types: Set<string> }>();
  for (const l of data.links) {
    const other = l.source === id ? l.target : l.target === id ? l.source : null;
    if (!other) continue;
    const node = data.nodes.find((x) => x.id === other);
    if (!node) continue;
    const r = related.get(other) ?? { node, types: new Set<string>() };
    r.types.add(l.type);
    related.set(other, r);
  }
  const rank = (types: Set<string>) => (types.has("caused_by") ? 0 : types.has("semantic") ? 1 : types.has("temporal") ? 2 : 3);
  const relatedList = [...related.values()].sort((a, b) => rank(a.types) - rank(b.types)).slice(0, 8);

  const sameSource = n.source.interactionId ? data.commitments.filter((c) => c.interaction_id === n.source.interactionId) : [];
  const inferred = data.commitments.filter((c) => !sameSource.includes(c) && overlap(c.description, n.text) >= 0.34);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12px] font-medium" style={{ color }}>
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            {cat?.label}
          </div>
          <h3 className="mt-1.5 text-[15.5px] font-semibold leading-snug text-fg">{titleOf(n.text)}</h3>
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-mute hover:bg-fg/5 hover:text-fg">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 text-[13.5px]">
        <p className="leading-relaxed text-soft">{n.text}</p>

        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[13px]">
          <dt className="text-mute">Memory type</dt>
          <dd className="text-soft">
            <Badge tone={n.type === "observation" ? "mem" : n.type === "experience" ? "accent" : "neutral"}>{typeLabel(n.type)}</Badge>
            {n.proofCount && n.proofCount > 1 ? <span className="ml-2 text-mute">supported by {n.proofCount} facts</span> : null}
          </dd>
          <dt className="text-mute">Date learned</dt>
          <dd className="text-soft">{n.occurredAt ? fmtDate(n.occurredAt) : "Unknown"}</dd>
          <dt className="text-mute">Stakeholders</dt>
          <dd className="text-soft">{n.stakeholders.length ? n.stakeholders.join(", ") : <span className="text-mute">None named</span>}</dd>
          <dt className="text-mute">Memory ID</dt>
          <dd className="truncate font-mono text-[11.5px] text-mute" title={n.id}>
            {n.id}
          </dd>
        </dl>

        <section>
          <h4 className="mb-2 text-[12.5px] font-semibold text-fg">Source</h4>
          {n.source.interactionId || n.source.kind ? (
            <div className="rounded-xl border border-line bg-raised p-3.5">
              <div className="flex items-center gap-2 text-[13px] text-fg">
                {n.source.file ? <FileText className="h-4 w-4 text-mem" /> : <Link2 className="h-4 w-4 text-mute" />}
                <span className="font-medium">{n.source.file ?? (n.source.kind ?? "interaction").replace("_", " ")}</span>
              </div>
              <div className="mt-1 text-[12.5px] text-mute">
                {[n.source.date && fmtDate(n.source.date), n.source.rep && `logged by ${n.source.rep}${n.source.repTitle ? `, ${n.source.repTitle}` : ""}`, n.source.pages && `${n.source.pages} pages`]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {n.source.summary && <p className="mt-2 text-[12.5px] leading-relaxed text-soft">{n.source.summary}</p>}
              <Link to={`/customers/${data.customer.id}#conversations`} className="mt-2 inline-block text-[12.5px] font-medium text-mem hover:underline">
                Open the conversation
              </Link>
            </div>
          ) : (
            <p className="text-[12.5px] text-mute">{n.type === "observation" ? "Consolidated by Hindsight from several memories (see related memories)." : n.source.context ?? "No source recorded."}</p>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-[12.5px] font-semibold text-fg">
            Related memories <span className="font-normal text-mute">· recorded by Hindsight</span>
          </h4>
          {relatedList.length === 0 ? (
            <p className="text-[12.5px] text-mute">No recorded links.</p>
          ) : (
            <ul className="space-y-2">
              {relatedList.map(({ node, types }) => (
                <li key={node.id}>
                  <button onClick={() => onSelect(node.id)} className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-left transition hover:border-mem/50">
                    <div className="text-[11px] text-mem">{[...types].map((x) => LINK_LABEL[x] ?? x).join(" · ")}</div>
                    <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-soft">{node.text}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-[12.5px] font-semibold text-fg">Related commitments</h4>
          {sameSource.length + inferred.length === 0 ? (
            <p className="text-[12.5px] text-mute">None.</p>
          ) : (
            <ul className="space-y-2">
              {[...sameSource.map((c) => ({ c, how: "From the same conversation" })), ...inferred.map((c) => ({ c, how: "Inferred: similar wording" }))].map(({ c, how }) => (
                <li key={c.id} className="rounded-lg border border-line bg-raised px-3 py-2">
                  <div className="text-[11px] text-mute">{how}</div>
                  <div className="mt-0.5 text-[12.5px] leading-snug text-soft">{c.description}</div>
                  <div className="mt-1">
                    <StatusDot tone={c.status === "done" ? "good" : c.overdue ? "bad" : "warn"} label={c.status === "done" ? "Kept" : c.overdue ? "Overdue" : `Due ${fmtDate(c.due_date)}`} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-[12.5px] font-semibold text-fg">
            Related deals <span className="font-normal text-mute">· this account</span>
          </h4>
          <ul className="space-y-1.5">
            {data.deals.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                <span className="truncate text-soft">{d.name}</span>
                <span className="shrink-0 text-mute">
                  {d.stage} · {fmtMoney(d.amount)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
