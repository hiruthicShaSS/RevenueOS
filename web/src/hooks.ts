import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api, type MemoryHit } from "./api";

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<T>(path));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

/**
 * The memories that grounded the most recent AI answer (negotiator or Ask),
 * so the Memory Explorer can show "what was recalled, and how relevant".
 */
export interface LastRetrieval {
  source: string;
  question: string;
  customerId: string | null;
  at: string;
  memories: (MemoryHit & { ref?: string })[];
}
let last: LastRetrieval | null = null;
const listeners = new Set<() => void>();
export function setLastRetrieval(r: LastRetrieval) {
  last = r;
  listeners.forEach((l) => l());
}
export function useLastRetrieval() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => last
  );
}
