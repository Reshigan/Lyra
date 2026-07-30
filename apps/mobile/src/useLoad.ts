import { useCallback, useEffect, useRef, useState } from "react";

// One fetch, cancelled on unmount, retryable. ponytail: this is not a query
// cache — there is no second consumer of any of these responses and no
// background refresh yet. Reach for one when offline read-models land
// (docs/08 §4), not before.

export interface Loaded<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
}

export function useLoad<T>(
  run: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[]
): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  // The caller passes a fresh closure every render, so the closure itself can
  // never be a dependency — the dep list it supplies is what decides when to
  // refetch, and a ref keeps the effect reading the current one.
  const call = useRef(run);
  call.current = run;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    call.current(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // `deps` is fixed-length per call site, which is the same contract every
    // hook dependency array has.
  }, [...deps, attempt]);

  return { data, loading, error, reload: useCallback(() => setAttempt((n) => n + 1), []) };
}
