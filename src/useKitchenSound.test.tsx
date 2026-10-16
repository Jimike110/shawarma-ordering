import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useKitchenSound } from './useKitchenSound';

let permitted = true;
let contexts: FakeAudio[];
class FakeAudio extends EventTarget {
  state = 'suspended';
  currentTime = 0;
  destination = {};
  decoded = { duration: 3.3 };
  decodeAudioData = vi.fn(() => Promise.resolve(this.decoded));
  start = vi.fn();
  stop = vi.fn();
  resume = vi.fn(() => {
    if (permitted) {
      this.state = 'running';
      this.dispatchEvent(new Event('statechange'));
    }
    return Promise.resolve();
  });
  close = vi.fn(() => {
    this.state = 'closed';
    return Promise.resolve();
  });
  createBufferSource = () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    buffer: null,
    start: this.start,
    stop: this.stop,
    onended: null,
  });
  finish() {
    this.source?.onended?.();
  }
  source: { onended: (() => void) | null } | null = null;
  constructor() {
    super();
    contexts.push(this);
  }
}
beforeEach(() => {
  permitted = true;
  contexts = [];
  vi.stubGlobal('AudioContext', FakeAudio);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('repeats known pending orders every fifteen seconds, stops on server confirmation and resumes for another order', async () => {
  vi.useFakeTimers();
  const hook = renderHook(() => useKitchenSound());
  await flush();
  const context = contexts[0];
  const original = context.createBufferSource;
  context.createBufferSource = () => {
    const source = original();
    context.source = source;
    return source;
  };
  act(() => hook.result.current.setPending(true));
  expect(context.start).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(15000));
  expect(context.start).toHaveBeenCalledTimes(1); // Still playing: never overlap.
  act(() => context.finish());
  act(() => vi.advanceTimersByTime(1000));
  expect(context.start).toHaveBeenCalledTimes(2);
  act(() => hook.result.current.setPending(false));
  expect(context.stop).toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(30000));
  expect(context.start).toHaveBeenCalledTimes(2);
  act(() => hook.result.current.setPending(true));
  expect(context.start).toHaveBeenCalledTimes(3);
  hook.unmount();
});
it('leaves all playback to Android inside the privileged WebView', async () => {
  const hook = renderHook(() => useKitchenSound(true));
  await flush();
  act(() => hook.result.current.setPending(true));
  expect(contexts).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
  hook.unmount();
});
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

it('starts enabled and plays new-order alerts without the sound toggle', async () => {
  const hook = renderHook(() => useKitchenSound());
  await flush();
  expect(hook.result.current.enabled).toBe(true);
  expect(hook.result.current.ready).toBe(true);
  act(() => hook.result.current.alert());
  expect(contexts[0].start).toHaveBeenCalledTimes(1);
  hook.unmount();
  expect(contexts[0].close).toHaveBeenCalledOnce();
});
it('keeps an alert while autoplay is blocked and delivers it once after a normal gesture', async () => {
  permitted = false;
  const hook = renderHook(() => useKitchenSound());
  await flush();
  expect(hook.result.current.enabled).toBe(true);
  expect(hook.result.current.ready).toBe(false);
  act(() => {
    hook.result.current.alert();
    hook.result.current.alert();
  });
  expect(contexts[0].start).not.toHaveBeenCalled();
  permitted = true;
  fireEvent.click(document.body);
  await flush();
  expect(hook.result.current.ready).toBe(true);
  expect(contexts[0].start).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(document.body, { key: 'a' });
  await flush();
  expect(contexts[0].start).toHaveBeenCalledTimes(1);
});
it('respects a deliberate mute for this visit and enables sound again on a fresh mount', async () => {
  const hook = renderHook(() => useKitchenSound());
  await flush();
  act(() => hook.result.current.toggle());
  act(() => hook.result.current.alert());
  fireEvent.click(document.body);
  await flush();
  expect(hook.result.current.enabled).toBe(false);
  expect(contexts[0].start).not.toHaveBeenCalled();
  act(() => hook.result.current.toggle());
  await flush();
  act(() => hook.result.current.alert());
  expect(contexts[0].start).toHaveBeenCalledTimes(1);
  act(() => hook.result.current.toggle());
  expect(contexts[0].stop).toHaveBeenCalledOnce();
  hook.unmount();
  const next = renderHook(() => useKitchenSound());
  await flush();
  expect(next.result.current.enabled).toBe(true);
});
it('keeps an alert until the file finishes loading and retries failed audio downloads', async () => {
  let finish!: (response: unknown) => void;
  const fetch = vi.fn().mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const hook = renderHook(() => useKitchenSound());
  await flush();
  act(() => hook.result.current.alert());
  expect(contexts[0].start).not.toHaveBeenCalled();
  expect(hook.result.current.ready).toBe(false);
  await act(async () => {
    finish({ ok: false });
  });
  expect(hook.result.current.error).toContain('Не удалось загрузить звук');
  fetch.mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
  fireEvent.click(document.body);
  await flush();
  expect(contexts[0].start).toHaveBeenCalledOnce();
  expect(hook.result.current.ready).toBe(true);
});
it('reports audio failures without crashing and safely reopens after StrictMode cleanup', async () => {
  const hook = renderHook(() => useKitchenSound(), { reactStrictMode: true });
  await flush();
  expect(contexts[0].close).toHaveBeenCalledOnce();
  act(() => hook.result.current.alert());
  expect(contexts[1].start).toHaveBeenCalledOnce();
  hook.unmount();
  expect(contexts[1].close).toHaveBeenCalledOnce();
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        throw new Error('unsupported');
      }
    },
  );
  const failed = renderHook(() => useKitchenSound());
  await flush();
  expect(failed.result.current.error).toContain('Не удалось включить звук');
  expect(failed.result.current.ready).toBe(false);
});
