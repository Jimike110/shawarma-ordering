import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORDER_HISTORY_CHANGED, savedOrders, saveOrder } from './orderHistory';

const token = (letter: string) => letter.repeat(43);
beforeEach(() => localStorage.clear());

describe('saved order history', () => {
  it('retains the token-only legacy link even if the new history is malformed', () => {
    localStorage.setItem('shawarma-last-order', token('a'));
    localStorage.setItem('shawarma-orders', '{broken');
    expect(savedOrders()).toEqual([{ token: token('a') }]);
  });

  it('merges duplicate links and rejects invalid metadata without losing a valid token', () => {
    localStorage.setItem(
      'shawarma-orders',
      JSON.stringify([
        { token: token('a'), number: '101', created_at: 'invalid' },
        { token: token('a'), number: 101, created_at: '2026-10-01T08:00:00Z' },
        { token: 'invalid', number: 102 },
        null,
      ]),
    );
    expect(savedOrders()).toEqual([
      { token: token('a'), number: 101, created_at: '2026-10-01T08:00:00Z' },
    ]);
  });

  it('keeps more than five orders and preserves their numbers after reading again', () => {
    for (let i = 0; i < 8; i++)
      saveOrder({
        token: token(String(i)),
        number: 101 + i,
        created_at: `2026-10-0${i + 1}T08:00:00Z`,
      });
    expect(savedOrders().map((o) => o.number)).toEqual([108, 107, 106, 105, 104, 103, 102, 101]);
  });

  it('backfills a legacy order without moving it ahead of a newer order', () => {
    localStorage.setItem('shawarma-last-order', token('a'));
    saveOrder({ token: token('b'), number: 102, created_at: '2026-10-02T08:00:00Z' });
    saveOrder({ token: token('a'), number: 101, created_at: '2026-10-01T08:00:00Z' });
    saveOrder({ token: token('a') });
    expect(savedOrders().map((o) => o.number)).toEqual([102, 101]);
    expect(localStorage.getItem('shawarma-last-order')).toBeNull();
  });

  it('does not lose the legacy link when writing browser storage fails', () => {
    localStorage.setItem('shawarma-last-order', token('a'));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveOrder({ token: token('a'), number: 101 })).not.toThrow();
    expect(savedOrders()).toEqual([{ token: token('a') }]);
  });

  it('notifies the current tab only when the saved history changes', () => {
    const changed = vi.fn();
    window.addEventListener(ORDER_HISTORY_CHANGED, changed);
    try {
      saveOrder({ token: token('a'), number: 101 });
      saveOrder({ token: token('a'), number: 101 });
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(ORDER_HISTORY_CHANGED, changed);
    }
  });
});
