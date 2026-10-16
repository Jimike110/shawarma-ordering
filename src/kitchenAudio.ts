// Unlock during the login gesture, before the asynchronous request mounts the
// kitchen. This context contains no account/order data and never plays a signal.
let prepared: AudioContext | null = null;

export function prepareKitchenAudio() {
  if (window.YashaKitchen || typeof AudioContext === 'undefined') return;
  try {
    if (!prepared || prepared.state === 'closed') prepared = new AudioContext();
    if (prepared.state !== 'running') void prepared.resume().catch(() => {});
  } catch {
    // The kitchen keeps its visible activation/error fallback.
  }
}

export function takeKitchenAudio(): AudioContext {
  const context = prepared;
  prepared = null;
  return context && context.state !== 'closed' ? context : new AudioContext();
}

export function releaseKitchenAudio(context: AudioContext) {
  prepared = context;
  // React development remounts effects immediately. Let that kitchen reclaim its
  // already unlocked context; a real unmount still closes it this microtask.
  queueMicrotask(() => {
    if (prepared !== context) return;
    prepared = null;
    if (context.state !== 'closed') void context.close().catch(() => {});
  });
}
