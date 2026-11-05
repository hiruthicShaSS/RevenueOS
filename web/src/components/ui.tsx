import clsx from "clsx";
import { AlertTriangle, Brain, Loader2 } from "lucide-react";
import Markdown from "react-markdown";
import type { ReactNode } from "react";
import { fmtDate, type MemoryHit } from "../api";

export function Card({ className, children, title, action, subtitle }: { className?: string; children: ReactNode; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <section className={clsx("rounded-2xl border border-line bg-panel/80 backdrop-blur", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h3 className="text-[13px] font-semibold tracking-wide text-white">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-mute">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

const tones = {
  neutral: "bg-white/5 text-soft border-line-2",
  accent: "bg-accent/10 text-accent border-accent/25",
  good: "bg-good/10 text-good border-good/25",
  warn: "bg-warn/10 text-warn border-warn/25",
  bad: "bg-bad/10 text-bad border-bad/25",
  mem: "bg-mem/10 text-mem border-mem/25",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium", tones[tone], className)}>{children}</span>;
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  loading,
  className,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "outline" | "danger";
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-accent-2 text-white shadow-[0_0_0_1px_rgb(255_255_255/0.08)_inset,0_8px_24px_-8px_rgb(99_102_241/0.6)] hover:bg-accent-2/90",
        variant === "outline" && "border border-line-2 bg-white/[0.02] text-soft hover:bg-white/5 hover:text-white",
        variant === "ghost" && "text-mute hover:bg-white/5 hover:text-white",
        variant === "danger" && "border border-bad/30 bg-bad/10 text-bad hover:bg-bad/20",
        className
      )}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-2xl border border-line bg-panel/80 px-5 py-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-mute">{label}</div>
      <div className={clsx("mt-2 text-2xl font-semibold tracking-tight", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-white")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-mute">{hint}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-mute">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("shimmer rounded-lg", className)} />;
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-bad/25 bg-bad/5 px-4 py-3 text-sm text-bad">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1 break-words">{error}</div>
      {onRetry && (
        <button onClick={onRetry} className="text-xs underline underline-offset-2">
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
      <div className="text-sm font-medium text-soft">{title}</div>
      {children && <div className="mt-1 max-w-md text-xs text-mute">{children}</div>}
    </div>
  );
}

export function MD({ children }: { children: string }) {
  return (
    <div className="prose-dark text-[13.5px] leading-relaxed text-soft">
      <Markdown>{children}</Markdown>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-mute">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export const typeTone = (t: string | null): Tone => (t === "observation" ? "mem" : t === "experience" ? "accent" : t === "world" ? "neutral" : "neutral");

export function MemoryRow({ m, refLabel, compact }: { m: MemoryHit; refLabel?: string; compact?: boolean }) {
  const invalid = m.state === "invalidated";
  return (
    <div className={clsx("rounded-xl border border-line bg-white/[0.015] px-3.5 py-2.5", invalid && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-mute">
        {refLabel && <Badge tone="accent">{refLabel}</Badge>}
        <Badge tone={typeTone(m.type)}>{m.type ?? "memory"}</Badge>
        {m.occurredAt && <span>{fmtDate(m.occurredAt)}</span>}
        {m.score != null && <span className="font-mono">relevance {m.score.toFixed(2)}</span>}
        {invalid && <Badge tone="bad">superseded</Badge>}
      </div>
      <div className={clsx("mt-1.5 text-[13px] leading-snug text-soft", invalid && "line-through", compact && "line-clamp-3")}>{m.text}</div>
      {invalid && m.invalidationReason && <div className="mt-1 text-[11px] text-bad">{m.invalidationReason}</div>}
      {!compact && m.entities.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {m.entities.slice(0, 6).map((e) => (
            <span key={e} className="rounded bg-white/5 px-1.5 py-0.5 text-[10.5px] text-mute">
              {e}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Select({ value, onChange, children, className }: { value: string; onChange: (v: string) => void; children: ReactNode; className?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={clsx("rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-[13px] text-white outline-none focus:border-accent/50", className)}
    >
      {children}
    </select>
  );
}

export const inputCls =
  "w-full rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-[13px] text-white placeholder:text-mute/70 outline-none focus:border-accent/50";
