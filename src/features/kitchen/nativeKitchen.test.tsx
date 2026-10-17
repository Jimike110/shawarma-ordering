import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useNativeKitchen } from '@/features/kitchen/nativeKitchen';

afterEach(() => {
  delete window.YashaKitchen;
});

it('starts automatically once the shared login is bound, without undoing a deliberate stop', () => {
  const postMessage = vi.fn();
  window.YashaKitchen = { postMessage };
  const hook = renderHook(() => useNativeKitchen());
  const state = (authenticated: boolean, monitoring: boolean) =>
    act(() => {
      window.YashaKitchen!.onmessage?.({
        data: JSON.stringify({ authenticated, monitoring, audio_ready: true }),
      } as MessageEvent<string>);
    });
  state(false, false);
  expect(
    postMessage.mock.calls.filter(([value]) => JSON.parse(value).action === 'start'),
  ).toHaveLength(0);
  state(true, false);
  state(true, true);
  state(true, false);
  expect(
    postMessage.mock.calls.filter(([value]) => JSON.parse(value).action === 'start'),
  ).toHaveLength(1);
  hook.unmount();
  renderHook(() => useNativeKitchen());
  state(true, false);
  expect(
    postMessage.mock.calls.filter(([value]) => JSON.parse(value).action === 'start'),
  ).toHaveLength(2);
});
