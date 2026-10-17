import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/shared/api/client';

// Each request finishes before the next timer starts. Abort and generation checks
// prevent updates from a stale route or an unmounted component.
export function usePolling<T>(
  load: (signal: AbortSignal) => Promise<T>,
  interval = 5000,
  enabled = true,
  isComplete?: (data: T) => boolean,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const generation = useRef(0);
  const previousLoad = useRef(load);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    if (previousLoad.current !== load) {
      previousLoad.current = load;
      setData(null);
      setError('');
      setLastUpdated(null);
      setLoading(true);
    }
    if (!enabled) {
      setLoading(false);
      return;
    }
    const id = ++generation.current;
    let timer: ReturnType<typeof setTimeout>;
    let running = false;
    let stopped = false;
    let controller: AbortController | null = null;
    async function tick() {
      if (running || stopped) return;
      clearTimeout(timer);
      running = true;
      controller = new AbortController();
      let complete = false;
      try {
        const next = await load(controller.signal);
        complete = isComplete?.(next) ?? false;
        if (!stopped && id === generation.current) {
          setData(next);
          setError('');
          setLastUpdated(new Date());
        }
      } catch (e) {
        if (!stopped && id === generation.current) setError(errorMessage(e));
      } finally {
        running = false;
        if (!stopped) {
          setLoading(false);
          if (!complete) timer = setTimeout(tick, interval);
        }
      }
    }
    const visible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    const online = () => {
      void tick();
    };
    void tick();
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', online);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', online);
    };
  }, [load, interval, enabled, version, isComplete]);
  // A scope change must hide the old result in the same render, before effects run.
  const current = previousLoad.current === load;
  return {
    data: current ? data : null,
    error: current ? error : '',
    loading: current ? loading : true,
    lastUpdated: current ? lastUpdated : null,
    refresh,
  };
}
