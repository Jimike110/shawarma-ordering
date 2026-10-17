import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/shared/api/client';
import { savedOrders, saveOrder } from '@/features/orders/orderHistory';
import { useSavedOrders } from '@/features/orders/useSavedOrders';

vi.mock('@/shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/client')>()),
  api: vi.fn(),
}));

const token = 'a'.repeat(43);

const created_at = '2026-10-01T08:00:00Z';

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api).mockReset();
});

describe('recovering saved order numbers', () => {
  it('retains metadata and labels an expired receipt without retrying it on mount', async () => {
    saveOrder({ token, number: 101, created_at: '2020-01-01T00:00:00Z' });
    vi.mocked(api).mockRejectedValue(new ApiError('Expired', 410));
    const hook = renderHook(useSavedOrders);
    await waitFor(() => expect(hook.result.current[0].expired).toBe(true));
    expect(hook.result.current[0].number).toBe(101);
    hook.unmount();
    renderHook(useSavedOrders);
    expect(api).toHaveBeenCalledTimes(1);
  });
  it('keeps the home count reactive without fetching legacy order metadata', () => {
    localStorage.setItem('shawarma-last-order', token);
    const hook = renderHook(() => useSavedOrders({ recoverMetadata: false }));
    expect(hook.result.current).toEqual([{ token }]);
    act(() => saveOrder({ token: 'b'.repeat(43), number: 102, created_at }));
    expect(hook.result.current).toHaveLength(2);
    expect(api).not.toHaveBeenCalled();
  });

  it('resolves a token-only order and updates both the UI and stored history', async () => {
    localStorage.setItem('shawarma-last-order', token);
    vi.mocked(api).mockResolvedValue({ number: 101, created_at });
    const hook = renderHook(useSavedOrders);
    await waitFor(() =>
      expect(hook.result.current).toEqual([{ token, number: 101, created_at }]),
    );
    expect(savedOrders()).toEqual(hook.result.current);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('retains an unavailable link and retries missing metadata when connectivity returns', async () => {
    localStorage.setItem('shawarma-orders', JSON.stringify([{ token }]));
    vi.mocked(api)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ number: 101, created_at });
    const hook = renderHook(useSavedOrders);
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook.result.current).toEqual([{ token }]);
    expect(api).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(hook.result.current[0].number).toBe(101));
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('receives same-tab and other-tab additions without refetching complete metadata', async () => {
    const hook = renderHook(useSavedOrders);
    act(() => saveOrder({ token, number: 101, created_at }));
    expect(hook.result.current[0].number).toBe(101);
    act(() => {
      localStorage.setItem(
        'shawarma-orders',
        JSON.stringify([
          { token, number: 101, created_at },
          { token: 'b'.repeat(43), number: 102, created_at: '2026-10-02T08:00:00Z' },
        ]),
      );
      window.dispatchEvent(new StorageEvent('storage', { key: 'shawarma-orders' }));
    });
    expect(hook.result.current.map((o) => o.number)).toEqual([102, 101]);
    expect(api).not.toHaveBeenCalled();
  });

  it('aborts recovery on navigation and never saves a late response', async () => {
    localStorage.setItem('shawarma-last-order', token);
    let resolve!: (value: unknown) => void;
    vi.mocked(api).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const hook = renderHook(useSavedOrders);
    const signal = vi.mocked(api).mock.calls[0][1]?.signal;
    hook.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      resolve({ number: 101, created_at });
    });
    expect(savedOrders()).toEqual([{ token }]);
  });
});
