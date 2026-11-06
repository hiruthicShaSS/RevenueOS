import clsx from "clsx";
import { AlertTriangle, Brain, ChevronDown, Loader2 } from "lucide-react";
import Markdown from "react-markdown";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { fmtDate, type MemoryHit } from "../api";

/* ------------------------------------------------------------------ surfaces */

export function Card({
  className,
  children,
  title,
  action,
  subtitle,
  bodyClassName,
  tone,
}: {
  className?: string;
  children: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  bodyClassName?: string;
  /** "mem" marks AI / memory-derived content. */
  tone?: "mem";
}) {
  return (
    <section className={clsx("min-w-0 rounded-2xl border bg-panel shadow-card", tone === "mem" ? "border-mem/30" : "border-line", className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-6 pt-5">
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold leading-snug text-fg">{title}</h3>
            {subtitle && <p className="mt-1 text-[13px] leading-relaxed text-mute">{subtitle}</p>}
          </div>
          {action && <div className="min-w-0 max-w-full">{action}</div>}
        </header>
      )}
      <div className={clsx("px-6 pb-6", title || action ? "pt-4" : "pt-6", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-9 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 max-w-3xl">
        <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.02em] text-fg md:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-2.5 text-[15px] leading-relaxed text-mute">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-3">{action}</div>}
    </div>
  );
}

export function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div>
        <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-fg">{title}</h2>
        {subtitle && <p className="mt-1.5 text-[13.5px] leading-relaxed text-mute">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ badges & status */

const tones = {
  neutral: "bg-fg/[0.05] text-soft border-line",
  accent: "bg-accent/10 text-accent-strong dark:text-accent border-accent/25",
  good: "bg-good/10 text-good border-good/25",
  warn: "bg-warn/10 text-warn border-warn/25",
  bad: "bg-bad/10 text-bad border-bad/25",
  mem: "bg-mem/10 text-mem border-mem/25",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

export function StatusDot({ tone, label }: { tone: Tone; label: ReactNode }) {
  const dot = { neutral: "bg-mute", accent: "bg-accent", good: "bg-good", warn: "bg-warn", bad: "bg-bad", mem: "bg-mem" }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-soft">
      <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ controls */

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  loading,
  className,
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "outline" | "danger" | "mem";
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  type?: "button" | "submit";
  title?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      title={title}
      disabled={disabled || loading}
      className={clsx(
        "press inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-[13.5px] font-medium disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-accent text-on-accent hover:bg-accent-strong dark:hover:bg-accent-strong",
        variant === "mem" && "bg-mem text-white hover:opacity-90",
        variant === "outline" && "border border-line-2 bg-raised text-soft hover:border-accent/40 hover:text-fg",
        variant === "ghost" && "text-mute hover:bg-fg/5 hover:text-fg",
        variant === "danger" && "border border-bad/30 bg-bad/10 text-bad hover:bg-bad/15",
        className
      )}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  size?: "sm" | "md";
}) {
  // A single thumb slides under the active option instead of each option toggling its own background.
  const wrap = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [animate, setAnimate] = useState(false);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const btn = el.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (btn) setThumb({ x: btn.offsetLeft, y: btn.offsetTop, w: btn.offsetWidth, h: btn.offsetHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, options.length]);
  useEffect(() => {
    const t = window.setTimeout(() => setAnimate(true), 50); // no slide on first paint
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div ref={wrap} className="relative inline-flex max-w-full flex-wrap rounded-lg border border-line bg-fg/[0.03] p-0.5">
      {thumb && (
        <span
          aria-hidden
          className="absolute rounded-md bg-raised shadow-card"
          style={{
            transform: `translate(${thumb.x}px, ${thumb.y}px)`,
            width: thumb.w,
            height: thumb.h,
            left: 0,
            top: 0,
            transition: animate ? "transform var(--t-med) var(--ease), width var(--t-med) var(--ease)" : "none",
          }}
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "press relative z-10 inline-flex items-center gap-1.5 whitespace-nowrap rounded-md font-medium",
            size === "sm" ? "px-2 py-1 text-[12px]" : "px-3 py-1.5 text-[13px]",
            value === o.value ? "text-fg" : "text-mute hover:text-fg"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select({ value, onChange, children, className }: { value: string; onChange: (v: string) => void; children: ReactNode; className?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={clsx("min-w-0 rounded-lg border border-line-2 bg-raised px-3 py-2 text-[13.5px] text-fg outline-none transition focus:border-accent", className)}
    >
      {children}
    </select>
  );
}

export const inputCls =
  "w-full rounded-lg border border-line-2 bg-raised px-3.5 py-2.5 text-[14px] text-fg placeholder:text-mute/80 outline-none transition focus:border-accent";

/** Summary line always visible; longer explanation on demand. */
export function Disclosure({ summary, children, defaultOpen = false }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="group flex w-full items-start gap-2 text-left" aria-expanded={open}>
        <ChevronDown className={clsx("mt-[3px] h-4 w-4 shrink-0 text-mute transition-transform duration-[var(--t-med)] ease-[var(--ease)]", open ? "rotate-0" : "-rotate-90")} />
        <div className="min-w-0 flex-1">{summary}</div>
      </button>
      <Collapse open={open}>
        <div className="pl-6 pt-2">{children}</div>
      </Collapse>
    </div>
  );
}

/** Animated expand/collapse. Children stay mounted, so state inside survives toggling. */
export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={clsx("collapse", className)} data-open={open} aria-hidden={!open} inert={!open || undefined}>
      <div>{children}</div>
    </div>
  );
}

/** Counts up to a number on first show and eases between later values. */
export function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString("en-US"), duration = 900 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(a + (value - a) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    // Frames can be throttled (background tab, hidden window): always land on the real value.
    const done = window.setTimeout(() => {
      cancelAnimationFrame(raf);
      setShown(value);
      from.current = value;
    }, duration + 150);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(done);
    };
  }, [value, duration]);
  return <span className="tabular-nums">{format(shown)}</span>;
}

/* ------------------------------------------------------------------ data display */

export function Stat({
  label,
  value,
  hint,
  tone,
  emphasis,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  /** The one or two numbers that matter most. */
  emphasis?: boolean;
}) {
  return (
    <div className={clsx("min-w-0 rounded-2xl border bg-panel px-6 py-5 shadow-card", emphasis ? "border-accent/35" : "border-line")}>
      <div className="text-[12.5px] font-medium text-mute">{label}</div>
      <div
        className={clsx(
          "mt-2 font-semibold tracking-[-0.02em]",
          emphasis ? "text-[32px] leading-none" : "text-[26px] leading-none",
          tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-fg"
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-2.5 text-[12.5px] text-mute">{hint}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-[13.5px] text-mute">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("shimmer rounded-xl", className)} />;
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-bad/25 bg-bad/[0.06] px-4 py-3 text-[13.5px] text-bad">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 break-words">{error}</div>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 text-xs font-medium underline underline-offset-2">
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-2 px-6 py-10 text-center">
      <div className="mb-3 text-mute">{icon ?? <Brain className="h-6 w-6" />}</div>
      <div className="text-[14px] font-medium text-soft">{title}</div>
      {children && <div className="mt-1.5 max-w-md text-[13px] leading-relaxed text-mute">{children}</div>}
    </div>
  );
}

export function MD({ children, className }: { children: string; className?: string }) {
  return (
    <div className={clsx("prose-rich max-w-[72ch] text-[14.5px] text-soft", className)}>
      <Markdown>{children}</Markdown>
    </div>
  );
}

/* ------------------------------------------------------------------ memory */

export const typeTone = (t: string | null): Tone => (t === "observation" ? "mem" : t === "experience" ? "accent" : "neutral");
export const typeLabel = (t: string | null) => (t === "observation" ? "observation" : t === "experience" ? "experience" : t === "world" ? "fact" : t ?? "memory");

/** Where a memory came from, from its Hindsight tags and context. */
export function memorySource(m: Pick<MemoryHit, "tags" | "context">) {
  const tag = (p: string) => m.tags.find((t) => t.startsWith(p))?.slice(p.length);
  const kind = tag("kind:");
  const rep = tag("rep:");
  const file = tag("file:");
  const parts = [kind && kind.replace("_", " "), file, rep && `by ${rep}`].filter(Boolean);
  return parts.length ? parts.join(" · ") : m.context && m.context !== "N/A" ? m.context : null;
}

export function MemoryRow({ m, refLabel, compact }: { m: MemoryHit; refLabel?: string; compact?: boolean }) {
  const invalid = m.state === "invalidated";
  const src = memorySource(m);
  return (
    <div className={clsx("rounded-xl border border-line bg-raised px-4 py-3", invalid && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-mute">
        {refLabel && <Badge tone="accent">{refLabel}</Badge>}
        <Badge tone={typeTone(m.type)}>{typeLabel(m.type)}</Badge>
        {m.occurredAt && <span>{fmtDate(m.occurredAt)}</span>}
        {m.score != null && <span className="font-mono">relevance {m.score.toFixed(2)}</span>}
        {src && <span className="truncate">· {src}</span>}
        {invalid && <Badge tone="bad">superseded</Badge>}
      </div>
      <div className={clsx("mt-1.5 text-[13.5px] leading-relaxed text-soft", invalid && "line-through", compact && "line-clamp-3")}>{m.text}</div>
      {invalid && m.invalidationReason && <div className="mt-1 text-[12px] text-bad">{m.invalidationReason}</div>}
      {!compact && m.entities.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {m.entities.slice(0, 6).map((e) => (
            <span key={e} className="rounded bg-fg/[0.05] px-1.5 py-0.5 text-[11px] text-mute">
              {e}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
