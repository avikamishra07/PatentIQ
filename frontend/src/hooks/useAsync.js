import { useCallback, useEffect, useState } from "react";

/**
 * Runs fn(signal) on mount and whenever deps change. Keeps the previous data
 * visible while reloading, ignores stale/aborted responses, and exposes reload().
 */
export function useAsync(fn, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(() => fn(ctrl.signal))
      .then((data) => {
        if (!ctrl.signal.aborted) setState({ data, error: null, loading: false });
      })
      .catch((error) => {
        if (ctrl.signal.aborted || error?.kind === "aborted") return;
        setState((s) => ({ data: s.data, error, loading: false }));
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
