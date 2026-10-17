import { useEffect, useRef, useState } from 'react';
import { api, json } from '@/shared/api/client';
import { type StaffAccount } from '@/shared/api/types';

export function useKitchenHealth(
  user: StaffAccount | null,
  lastUpdated: Date | null,
  ready: boolean,
  monitoring: boolean,
  native: boolean,
) {
  const [now, setNow] = useState(Date.now());
  const startedAt = useRef(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const stale = now - (lastUpdated?.getTime() ?? startedAt.current) >= 15000;
  const [heartbeatError, setHeartbeatError] = useState(false);
  const latest = useRef(lastUpdated);
  latest.current = lastUpdated;
  useEffect(() => {
    if (!user?.device_id || native) return;
    const c = new AbortController();
    let running = false;
    const send = async () => {
      if (running) return;
      running = true;
      try {
        await api('/staff/device-heartbeat', {
          method: 'POST',
          body: json({
            monitoring,
            audio_ready: ready,
            volume: ready ? 100 : 0,
            connection_ok: !!latest.current && Date.now() - latest.current.getTime() < 15000,
            app_version: 'web',
          }),
          signal: c.signal,
        });
        if (!c.signal.aborted) setHeartbeatError(false);
      } catch {
        if (!c.signal.aborted) setHeartbeatError(true);
      } finally {
        running = false;
      }
    };
    void send();
    const timer = setInterval(send, 15000);
    return () => {
      c.abort();
      clearInterval(timer);
    };
  }, [user?.device_id, native, monitoring, ready]);
  return { stale, heartbeatError };
}
