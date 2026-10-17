import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { telegramClosingConfirmation } from '@/features/telegram/telegram';
import { type CartLine, type Product } from '@/shared/api/types';

export const MAX_ITEMS = 50;

export const lineKey = (line: CartLine) =>
  line.product_id + ':' + [...(line.options ?? [])].sort().join(',');

export const cartCount = (lines: CartLine[]) =>
  lines.reduce((sum, line) => sum + line.quantity, 0);

export function readCart(storeId = 1): CartLine[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem('shawarma-cart-v3:' + storeId) ??
        (storeId === 1 ? localStorage.getItem('shawarma-cart') : null) ??
        '[]',
    );
    if (!Array.isArray(value)) return [];
    const result: CartLine[] = [],
      seen = new Set<string>();
    let count = 0;
    for (const line of value) {
      if (
        !line ||
        typeof line !== 'object' ||
        !Number.isInteger(line.product_id) ||
        line.product_id < 1 ||
        !Number.isInteger(line.quantity) ||
        line.quantity < 1 ||
        line.quantity > 20
      )
        continue;
      if (
        line.options !== undefined &&
        (!Array.isArray(line.options) ||
          line.options.length > 12 ||
          line.options.some(
            (id: unknown) =>
              typeof id !== 'string' || id.length < 1 || id.length > 40 || /[:,]/.test(id),
          ) ||
          new Set(line.options).size !== line.options.length)
      )
        continue;
      const normalized: CartLine = {
        product_id: line.product_id,
        quantity: line.quantity,
        ...(line.options?.length ? { options: [...line.options].sort() } : {}),
      };
      const key = lineKey(normalized);
      if (seen.has(key) || count + line.quantity > MAX_ITEMS || result.length >= 30) continue;
      seen.add(key);
      result.push(normalized);
      count += line.quantity;
    }
    return result;
  } catch {
    return [];
  }
}

export function unitPrice(line: CartLine, product?: Product) {
  if (!product) return 0;
  return (
    product.price +
    (line.options ?? []).reduce(
      (sum, id) => sum + (product.options?.find((o) => o.id === id)?.price ?? 0),
      0,
    )
  );
}

export function invalidLine(line: CartLine, products: Product[]) {
  const product = products.find((p) => p.id === line.product_id);
  return (
    !product?.available ||
    (line.options ?? []).some(
      (id) => !product.options?.some((o) => o.id === id && o.available !== false),
    )
  );
}

export function optionLabels(line: CartLine, product?: Product) {
  return (line.options ?? [])
    .map((id) => product?.options?.find((o) => o.id === id)?.label ?? 'Опция больше недоступна')
    .join(', ');
}

export function cartTotal(lines: CartLine[], products: Product[]) {
  return lines.reduce(
    (sum, line) =>
      sum +
      unitPrice(
        line,
        products.find((p) => p.id === line.product_id),
      ) *
        line.quantity,
    0,
  );
}

interface CartValue {
  lines: CartLine[];
  setQuantity: (id: number, qty: number, options?: string[]) => void;
  clear: () => void;
}

const CartContext = createContext<CartValue | null>(null);

export function CartProvider({
  children,
  storeId = 1,
}: {
  children: ReactNode;
  storeId?: number;
}) {
  const [lines, setLines] = useState<CartLine[]>(() => readCart(storeId));
  useEffect(() => {
    telegramClosingConfirmation(lines.length > 0);
    return () => telegramClosingConfirmation(false);
  }, [lines.length]);
  const save = (update: (previous: CartLine[]) => CartLine[]) => {
    setLines((previous) => {
      const next = update(previous);
      try {
        localStorage.setItem('shawarma-cart-v3:' + storeId, JSON.stringify(next));
        if (storeId === 1) localStorage.removeItem('shawarma-cart');
      } catch {}
      return next;
    });
  };
  const setQuantity = (id: number, qty: number, options: string[] = []) => {
    if (!Number.isInteger(id) || id < 1 || !Number.isFinite(qty)) return;
    const line: CartLine = {
      product_id: id,
      quantity: Math.min(20, Math.max(0, Math.floor(qty))),
      ...(options.length ? { options: [...options].sort() } : {}),
    };
    save((previous) => {
      const index = previous.findIndex((l) => lineKey(l) === lineKey(line));
      const next = previous.filter((l) => lineKey(l) !== lineKey(line));
      if (line.quantity > 0) {
        line.quantity = Math.min(line.quantity, MAX_ITEMS - cartCount(next));
        if (next.length >= 30 && index < 0) return previous;
        if (line.quantity > 0) next.splice(index < 0 ? next.length : index, 0, line);
      }
      return next;
    });
  };
  return (
    <CartContext.Provider value={{ lines, setQuantity, clear: () => save(() => []) }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const cart = useContext(CartContext);
  if (!cart) throw new Error('CartProvider is missing');
  return cart;
}
