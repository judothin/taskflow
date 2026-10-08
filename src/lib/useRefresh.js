import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

// ============================================================
// Coalesced, latest-only refetching
// ------------------------------------------------------------
// One user action fans out into several refresh triggers: saving a task
// queued for later fires 'queue-changed' and 'tasks-changed', and the
// realtime channel then reports the queue insert and the task write on top.
// Refetching on each one started 3–6 overlapping requests whose responses
// came back in any order, so an older snapshot could land after a newer one
// — a just-added row appeared, vanished and came back. On lists animated by
// useAnimatedList that played as an enter, an exit and a snap: the jitter and
// flash when adding a task or queueing one.
//
//   const { run, refresh } = useRefresh(async (isStale) => {
//     const data = await load();
//     if (isStale()) return;   // a newer fetch has started — drop this one
//     setData(data);
//   });
//
// `run()` fetches now (first load, team switch). `refresh()` is for change
// events: a burst of them collapses into one fetch shortly after the last.
// Either way only the newest fetch's result is applied.
// ============================================================

export default function useRefresh(fetcher, { delay = 120 } = {}) {
  const seq = useRef(0);
  const timer = useRef(null);
  const fn = useRef(fetcher);
  useLayoutEffect(() => { fn.current = fetcher; });

  const run = useCallback(() => {
    clearTimeout(timer.current);
    const id = ++seq.current;
    return fn.current(() => id !== seq.current);
  }, []);

  const refresh = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(run, delay);
  }, [run, delay]);

  // Unmounting makes any fetch still in flight stale.
  useEffect(() => () => { clearTimeout(timer.current); seq.current++; }, []);

  return { run, refresh };
}
