import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";
const KEY = "revenueos.theme";

interface ThemeState {
  mode: ThemeMode;
  /** The theme actually shown (system resolved). */
  resolved: "light" | "dark";
  setMode: (m: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
const readMode = (): ThemeMode => {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
};

function apply(resolved: "light" | "dark", animate: boolean) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theme-switching");
    window.setTimeout(() => root.classList.remove("theme-switching"), 300);
  }
  root.classList.toggle("dark", resolved === "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "dark" ? "#080d14" : "#ffdbbb");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readMode);
  const [sysDark, setSysDark] = useState(systemDark);
  const resolved = mode === "system" ? (sysDark ? "dark" : "light") : mode;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSysDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const [first, setFirst] = useState(true);
  useEffect(() => {
    apply(resolved, !first);
    setFirst(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  const setMode = useCallback((m: ThemeMode) => {
    if (m === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, m);
    setModeState(m);
  }, []);

  return <ThemeContext.Provider value={{ mode, resolved, setMode }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

/** Resolved token colours for libraries that need real values (Recharts, React Flow). */
export function useTokens() {
  const { resolved } = useTheme();
  const [t, setT] = useState(() => read());
  useEffect(() => setT(read()), [resolved]);
  return t;
}

function read() {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    fg: v("--fg"),
    soft: v("--soft"),
    mute: v("--mute"),
    line: v("--line"),
    line2: v("--line-2"),
    panel: v("--panel"),
    raised: v("--raised"),
    accent: v("--accent"),
    accentStrong: v("--accent-strong"),
    good: v("--good"),
    warn: v("--warn"),
    bad: v("--bad"),
    mem: v("--mem"),
    grid: v("--chart-grid"),
  };
}
export type Tokens = ReturnType<typeof read>;
