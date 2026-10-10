import { beforeEach, describe, expect, it } from 'vitest';
import { cartTotal, readCart, invalidLine } from './cart';
import type { Product } from './types';
beforeEach(() => localStorage.clear());
describe('cart', () => {
  it('keeps different options separate, rejects repeated variants and enforces the total limit', () => {
    localStorage.setItem('shawarma-cart', JSON.stringify([
      {product_id: 1, quantity: 20}, {product_id: 1, quantity: 20, options: ['cheese', 'sauce']},
      {product_id: 1, quantity: 2, options: ['sauce', 'cheese']}, {product_id: 2, quantity: 10},
      {product_id: 3, quantity: 1}, {product_id: 4, quantity: 1, options: ['x', 'x']}
    ]));
    expect(readCart()).toEqual([{product_id: 1, quantity: 20}, {product_id: 1, quantity: 20, options: ['cheese', 'sauce']}, {product_id: 2, quantity: 10}]);
  });
  it('prices selected options and flags a removed option', () => {
    const products = [{id: 1, price: 290, available: true, options: [{id: 'cheese', label: 'Сыр', price: 50}]}] as Product[];
    const line = {product_id: 1, quantity: 2, options: ['cheese']};
    expect(cartTotal([line], products)).toBe(680);
    expect(invalidLine(line, products)).toBe(false);
    expect(invalidLine({...line, options: ['removed']}, products)).toBe(true);
  });
  it('recovers from corrupted storage', () => {
    localStorage.setItem('shawarma-cart', 'broken');
    expect(readCart()).toEqual([]);
  });
  it('rejects negative quantities and duplicate products', () => {
    localStorage.setItem(
      'shawarma-cart',
      JSON.stringify([
        { product_id: 1, quantity: 2 },
        { product_id: 1, quantity: 3 },
        { product_id: 2, quantity: -4 },
        { product_id: 3, quantity: 30 },
      ]),
    );
    expect(readCart()).toEqual([{ product_id: 1, quantity: 2 }]);
  });
  it('uses current menu prices for the displayed total', () => {
    const products = [
      { id: 1, price: 290 },
      { id: 2, price: 320 },
    ] as Product[];
    expect(
      cartTotal(
        [
          { product_id: 1, quantity: 2 },
          { product_id: 2, quantity: 1 },
        ],
        products,
      ),
    ).toBe(900);
  });
});
