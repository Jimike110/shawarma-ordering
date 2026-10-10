export interface SavedOrder {
  token: string;
  number?: number;
  created_at?: string;
}

export const ORDER_HISTORY_CHANGED = 'shawarma-order-history-changed';
const HISTORY_KEY = 'shawarma-orders';
const LEGACY_KEY = 'shawarma-last-order';

function validOrder(value: unknown): SavedOrder | null {
  if (
    !value ||
    typeof value !== 'object' ||
    !('token' in value) ||
    typeof value.token !== 'string' ||
    !/^[\w-]{43}$/.test(value.token)
  )
    return null;
  const order: SavedOrder = { token: value.token };
  if (
    'number' in value &&
    typeof value.number === 'number' &&
    Number.isSafeInteger(value.number) &&
    value.number > 0
  )
    order.number = value.number;
  if (
    'created_at' in value &&
    typeof value.created_at === 'string' &&
    Number.isFinite(Date.parse(value.created_at))
  )
    order.created_at = value.created_at;
  return order;
}

function newestFirst(orders: SavedOrder[]): SavedOrder[] {
  return orders.sort(
    (a, b) =>
      (b.created_at ? Date.parse(b.created_at) : 0) - (a.created_at ? Date.parse(a.created_at) : 0),
  );
}

export function savedOrders(): SavedOrder[] {
  const orders = new Map<string, SavedOrder>();
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    if (Array.isArray(raw)) {
      for (const value of raw) {
        const order = validOrder(value);
        if (order) orders.set(order.token, { ...order, ...orders.get(order.token) });
      }
    }
  } catch {
    /* A malformed history must not hide a valid legacy link. */
  }
  try {
    const legacy = validOrder({ token: localStorage.getItem(LEGACY_KEY) });
    if (legacy && !orders.has(legacy.token)) orders.set(legacy.token, legacy);
  } catch {
    /* Browser storage may be disabled. */
  }
  return newestFirst([...orders.values()]);
}

export function saveOrder(value: SavedOrder) {
  const order = validOrder(value);
  if (!order) return;
  try {
    const orders = savedOrders();
    const existing = orders.find((o) => o.token === order.token);
    const next = newestFirst([
      { ...existing, ...order },
      ...orders.filter((o) => o.token !== order.token),
    ]);
    const serialized = JSON.stringify(next);
    const changed = localStorage.getItem(HISTORY_KEY) !== serialized;
    // Retain every saved link. Resolving/viewing an older order must not drop another one.
    if (changed) localStorage.setItem(HISTORY_KEY, serialized);
    // Remove the old key only after the complete history has been saved successfully.
    localStorage.removeItem(LEGACY_KEY);
    if (changed) window.dispatchEvent(new Event(ORDER_HISTORY_CHANGED));
  } catch {
    /* Tracking still works if browser storage is disabled. */
  }
}
