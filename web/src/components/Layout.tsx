import clsx from "clsx";
import { BookOpenCheck, Brain, Building2, Handshake, Home, ListChecks, LogOut, Monitor, Moon, Sparkles, Sun } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import ErrorBoundary from "./ErrorBoundary";
import { useApi } from "../hooks";
import type { Health } from "../api";
import { useAuth } from "../auth";
import { useTheme, type ThemeMode } from "../theme";
import { Segmented } from "./ui";

const NAV = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/customers", label: "Customers", icon: Building2 },
  { to: "/negotiate", label: "Deal Negotiator", icon: Handshake },
  { to: "/commitments", label: "Commitments", icon: ListChecks },
  { to: "/memory", label: "Memory Explorer", icon: Brain },
  { to: "/playbook", label: "Playbook", icon: BookOpenCheck },
];

export function Brand({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={clsx("grid place-items-center rounded-lg bg-accent-strong text-on-accent dark:bg-accent", size === "lg" ? "h-9 w-9" : "h-7 w-7")}>
        <Sparkles className={size === "lg" ? "h-[18px] w-[18px]" : "h-3.5 w-3.5"} />
      </div>
      <span className={clsx("font-semibold tracking-[-0.01em] text-fg", size === "lg" ? "text-[19px]" : "text-[15px]")}>RevenueOS</span>
    </div>
  );
}

export function ThemeSwitch({ size = "sm" }: { size?: "sm" | "md" }) {
  const { mode, setMode } = useTheme();
  return (
    <Segmented<ThemeMode>
      size={size}
      value={mode}
      onChange={setMode}
      options={[
        { value: "light", label: <Sun className="h-3.5 w-3.5" />, title: "Light theme" },
        { value: "dark", label: <Moon className="h-3.5 w-3.5" />, title: "Dark theme" },
        { value: "system", label: <Monitor className="h-3.5 w-3.5" />, title: "Match system" },
      ]}
    />
  );
}

export default function Layout() {
  const { data: health } = useApi<Health>("/health");
  const location = useLocation();
  return (
    <div className="flex h-full">
      <aside className="hidden w-[260px] shrink-0 flex-col border-r border-line bg-sidebar px-4 py-6 lg:flex">
        <div className="px-2.5">
          <Brand />
        </div>
        <nav className="mt-8 flex flex-1 flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] transition",
                  isActive ? "bg-raised font-medium text-fg shadow-card" : "text-soft hover:bg-fg/[0.04] hover:text-fg"
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-accent-strong dark:bg-accent" />}
                  <Icon className={clsx("h-[17px] w-[17px] shrink-0", isActive ? "text-accent-strong dark:text-accent" : "text-mute")} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <MemoryStatus health={health} />
        <div className="mt-3 flex items-center justify-between px-1">
          <span className="text-[12px] text-mute">Theme</span>
          <ThemeSwitch />
        </div>
        <UserCard />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* compact navigation below the desktop breakpoint */}
        <div className="flex items-center gap-3 border-b border-line bg-sidebar px-4 py-2.5 lg:hidden">
          <Brand />
          <div className="ml-auto">
            <ThemeSwitch />
          </div>
          <MobileSignOut />
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-line bg-sidebar px-3 py-2 lg:hidden">
          {NAV.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => clsx("whitespace-nowrap rounded-md px-3 py-1.5 text-[13px]", isActive ? "bg-raised font-medium text-fg" : "text-soft")}
            >
              {label}
            </NavLink>
          ))}
        </div>
        {health && health.memory.mode === "mock" && (
          <div className="border-b border-warn/25 bg-warn/10 px-8 py-2.5 text-[13px] text-warn">
            Mock memory mode, for offline UI development only. Set MEMORY_MODE=hindsight to use real Hindsight memory.
          </div>
        )}
        {health && health.memory.mode === "hindsight" && !health.memory.ok && (
          <div className="border-b border-bad/25 bg-bad/10 px-8 py-2.5 text-[13px] text-bad">{health.memory.detail}</div>
        )}
        {health && !health.llm.configured && (
          <div className="border-b border-bad/25 bg-bad/10 px-8 py-2.5 text-[13px] text-bad">LLM_API_KEY is not set on the server; analysis and negotiation are disabled.</div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-[1360px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
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
    <div className="rounded-xl border border-line bg-panel/70 px-3.5 py-3">
      <div className="flex items-center gap-2 text-[12.5px] font-medium text-fg">
        <span className={clsx("h-2 w-2 rounded-full", !health ? "bg-mute" : ok ? "bg-good" : health.memory.mode === "mock" ? "bg-warn" : "bg-bad")} />
        {health?.memory.mode === "mock" ? "Mock memory" : !health ? "Checking memory…" : ok ? "Hindsight connected" : "Hindsight unavailable"}
      </div>
      {health && <div className="mt-1 truncate pl-4 text-[11.5px] text-mute">{health.llm.model}</div>}
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
    <div className="mt-4 flex items-center gap-3 border-t border-line px-1 pt-4">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-strong text-[12px] font-semibold text-on-accent dark:bg-raised dark:text-accent">
        {initials(user.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium text-fg">{user.name}</div>
        <div className="truncate text-[12px] text-mute" title={user.email}>
          {user.title}
        </div>
      </div>
      <button onClick={logout} title="Sign out" aria-label="Sign out" className="rounded-md p-2 text-mute transition hover:bg-fg/5 hover:text-fg">
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}

function MobileSignOut() {
  const { logout } = useAuth();
  return (
    <button onClick={logout} title="Sign out" aria-label="Sign out" className="rounded-md p-2 text-mute">
      <LogOut className="h-4 w-4" />
    </button>
  );
}
