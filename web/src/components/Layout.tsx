import clsx from "clsx";
import { BookOpenCheck, Brain, Building2, Handshake, Home, ListChecks, LogOut, Sparkles } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import ErrorBoundary from "./ErrorBoundary";
import { useApi } from "../hooks";
import type { Health } from "../api";
import { useAuth } from "../auth";

const NAV = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/customers", label: "Customers", icon: Building2 },
  { to: "/negotiate", label: "Deal Negotiator", icon: Handshake },
  { to: "/commitments", label: "Commitments", icon: ListChecks },
  { to: "/memory", label: "Memory Explorer", icon: Brain },
  { to: "/playbook", label: "Playbook", icon: BookOpenCheck },
];

export default function Layout() {
  const { data: health } = useApi<Health>("/health");
  const location = useLocation();
  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-black/40 px-3 py-5 md:flex">
        <div className="mb-8 flex items-center gap-2.5 px-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-accent-2 to-mem shadow-[0_8px_24px_-6px_rgb(99_102_241/0.7)]">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="text-[15px] font-semibold tracking-tight text-white">RevenueOS</div>
            <div className="text-[10.5px] text-mute">The sales brain that remembers</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition",
                  isActive ? "bg-white/[0.06] text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]" : "text-mute hover:bg-white/[0.03] hover:text-soft"
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <MemoryStatus health={health} />
        <UserCard />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* mobile nav */}
        <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2 md:hidden">
          {NAV.map(({ to, label, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => clsx("whitespace-nowrap rounded-md px-2.5 py-1 text-xs", isActive ? "bg-white/10 text-white" : "text-mute")}>
              {label}
            </NavLink>
          ))}
          <MobileSignOut />
        </div>
        {health && health.memory.mode === "mock" && (
          <div className="border-b border-warn/20 bg-warn/10 px-6 py-2 text-xs text-warn">
            Mock memory mode — offline UI development only. Set MEMORY_MODE=hindsight to use real Hindsight memory.
          </div>
        )}
        {health && health.memory.mode === "hindsight" && !health.memory.ok && (
          <div className="border-b border-bad/20 bg-bad/10 px-6 py-2 text-xs text-bad">{health.memory.detail}</div>
        )}
        {health && !health.llm.configured && (
          <div className="border-b border-bad/20 bg-bad/10 px-6 py-2 text-xs text-bad">LLM_API_KEY is not set on the server — analysis and negotiation are disabled.</div>
        )}
        <main className="glow min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1280px] px-5 py-7 md:px-8">
            <ErrorBoundary resetKey={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}

function MemoryStatus({ health }: { health: Health | null }) {
  const ok = health?.memory.ok && health.memory.mode === "hindsight";
  return (
    <div className="mt-6 rounded-xl border border-line bg-white/[0.02] p-3">
      <div className="flex items-center gap-2 text-[11px] font-medium text-soft">
        <span className={clsx("h-1.5 w-1.5 rounded-full", !health ? "bg-mute" : ok ? "bg-good shadow-[0_0_8px] shadow-good" : health.memory.mode === "mock" ? "bg-warn" : "bg-bad")} />
        {health?.memory.mode === "mock" ? "Mock memory" : "Hindsight memory"}
      </div>
      <div className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-mute">{health ? health.memory.detail : "Checking…"}</div>
      {health && <div className="mt-1.5 text-[10.5px] text-mute">LLM · {health.llm.model}</div>}
    </div>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function UserCard() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-line bg-white/[0.02] p-2.5">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent-2/70 to-mem/70 text-[11px] font-semibold text-white">{initials(user.name)}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium text-white">{user.name}</div>
        <div className="truncate text-[10.5px] text-mute" title={user.email}>
          {user.title}
        </div>
      </div>
      <button onClick={logout} title="Sign out" className="rounded-md p-1.5 text-mute transition hover:bg-white/5 hover:text-white">
        <LogOut className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function MobileSignOut() {
  const { logout } = useAuth();
  return (
    <button onClick={logout} className="ml-auto whitespace-nowrap rounded-md px-2.5 py-1 text-xs text-mute">
      Sign out
    </button>
  );
}
