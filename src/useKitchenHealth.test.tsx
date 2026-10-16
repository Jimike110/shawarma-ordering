import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useKitchenHealth } from './useKitchenHealth';

afterEach(() => vi.useRealTimers());
it('warns after fifteen seconds without any successful refresh and recovers on a fresh queue', () => {
  vi.useFakeTimers();
  const hook = renderHook(
    ({ updated }: { updated: Date | null }) => useKitchenHealth(null, updated, true, true, false),
    { initialProps: { updated: null as Date | null } },
  );
  expect(hook.result.current.stale).toBe(false);
  act(() => vi.advanceTimersByTime(15000));
  expect(hook.result.current.stale).toBe(true);
  hook.rerender({ updated: new Date() });
  expect(hook.result.current.stale).toBe(false);
  act(() => vi.advanceTimersByTime(15000));
  expect(hook.result.current.stale).toBe(true);
  hook.unmount();
});
