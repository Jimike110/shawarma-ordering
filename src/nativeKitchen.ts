import { useEffect, useState } from 'react';

export interface NativeKitchenState {
  monitoring: boolean;
  audio_ready: boolean;
  volume: number;
  connection_ok: boolean;
  authenticated: boolean;
  revoked?: boolean;
  error: string;
}
declare global {
  interface Window {
    YashaKitchen?: {
      postMessage(message: string): void;
      onmessage?: (event: MessageEvent<string>) => void;
    };
  }
}
// The Android app exposes this message-only bridge solely on its pinned HTTPS
// origin. It never sends cookies or native credentials into JavaScript.
export const isNativeKitchen = () => !!window.YashaKitchen?.postMessage;
export function nativeKitchenAction(
  action: 'state' | 'start' | 'stop' | 'test' | 'settings' | 'logout' | 'session-changed',
) {
  window.YashaKitchen?.postMessage(JSON.stringify({ action }));
}
export function useNativeKitchen() {
  const native = isNativeKitchen();
  const [state, setState] = useState<NativeKitchenState>({
    monitoring: false,
    audio_ready: false,
    volume: 0,
    connection_ok: false,
    authenticated: false,
    error: '',
  });
  useEffect(() => {
    const bridge = window.YashaKitchen;
    if (!bridge) return;
    bridge.onmessage = (event) => {
      try {
        const next = JSON.parse(event.data);
        if (next.revoked === true) window.dispatchEvent(new Event('staff-session-expired'));
        if (typeof next.monitoring === 'boolean' && typeof next.authenticated === 'boolean')
          setState(next);
      } catch {
        /* Keep the last valid native health state. */
      }
    };
    nativeKitchenAction('state');
    const timer = setInterval(() => nativeKitchenAction('state'), 3000);
    return () => {
      clearInterval(timer);
      bridge.onmessage = undefined;
    };
  }, []);
  return { native, state };
}
