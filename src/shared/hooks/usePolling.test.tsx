import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePolling } from '@/shared/hooks/usePolling';

afterEach(() => vi.useRealTimers());

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('automatic refresh', () => {
  it('clears a previous order when the private link changes', async () => {
    const first = vi.fn().mockResolvedValue('first-order');
    const next = vi.fn(() => new Promise<string>(() => {}));
    const hook = renderHook(({ load }) => usePolling(load), { initialProps: { load: first } });
    await flush();
    expect(hook.result.current.data).toBe('first-order');
    hook.rerender({ load: next });
    await flush();
    expect(hook.result.current.data).toBeNull();
    expect(hook.result.current.loading).toBe(true);
  });
  it('loads immediately and receives a kitchen status change on the next tick', async () => {
    vi.useFakeTimers();
    const load = vi
      .fn()
      .mockResolvedValueOnce({ status: 'new' })
      .mockResolvedValue({ status: 'ready' });
    const hook = renderHook(() => usePolling(load, 5000));
    await flush();
    expect(hook.result.current.data).toEqual({ status: 'new' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(hook.result.current.data).toEqual({ status: 'ready' });
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('keeps the last status during an error and recovers on the next tick', async () => {
    vi.useFakeTimers();
    const load = vi
      .fn()
      .mockResolvedValueOnce('new')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('ready');
    const hook = renderHook(() => usePolling(load, 5000));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(hook.result.current.data).toBe('new');
    expect(hook.result.current.error).toBe('offline');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(hook.result.current.data).toBe('ready');
    expect(hook.result.current.error).toBe('');
  });
  it('does not overlap requests and aborts on unmount', async () => {
    vi.useFakeTimers();
    const load = vi.fn((_signal: AbortSignal) => new Promise<string>(() => {}));
    const hook = renderHook(() => usePolling(load, 5000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(load).toHaveBeenCalledTimes(1);
    const signal = load.mock.calls[0][0];
    hook.unmount();
    expect(signal.aborted).toBe(true);
  });
  it('refreshes when internet connectivity returns', async () => {
    const load = vi.fn().mockResolvedValue('ok');
    renderHook(() => usePolling(load));
    await flush();
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('does not poll a disabled private view', async () => {
    const load = vi.fn();
    renderHook(() => usePolling(load, 5000, false));
    await flush();
    expect(load).not.toHaveBeenCalled();
  });
});
