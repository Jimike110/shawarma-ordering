import { beforeEach, describe, expect, it } from 'vitest';
import { readCart } from '@/features/cart/cart';

describe('store baskets', () => {
  beforeEach(() => localStorage.clear());
  it('keeps different points independent and anchors the legacy basket to point one', () => {
    localStorage.setItem('shawarma-cart', JSON.stringify([{ product_id: 1, quantity: 2 }]));
    expect(readCart(1)).toEqual([{ product_id: 1, quantity: 2 }]);
    expect(readCart(2)).toEqual([]);
    localStorage.setItem(
      'shawarma-cart-v3:2',
      JSON.stringify([{ product_id: 9, quantity: 1 }]),
    );
    expect(readCart(2)).toEqual([{ product_id: 9, quantity: 1 }]);
    expect(readCart(1)).toEqual([{ product_id: 1, quantity: 2 }]);
  });
  it('does not fall back to another point on malformed storage', () => {
    localStorage.setItem('shawarma-cart', JSON.stringify([{ product_id: 1, quantity: 2 }]));
    localStorage.setItem('shawarma-cart-v3:2', 'broken');
    expect(readCart(2)).toEqual([]);
  });
});
