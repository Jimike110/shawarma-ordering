export interface SavedOrder {
  token: string;
  number?: number;
  created_at?: string;
}
export function savedOrders(): SavedOrder[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem('shawarma-orders') ?? '[]');
    const valid = Array.isArray(raw)
      ? raw.filter(
          (o): o is SavedOrder =>
            !!o &&
            typeof o === 'object' &&
            typeof o.token === 'string' &&
            /^[\w-]{43}$/.test(o.token),
        )
      : [];
    const legacy = localStorage.getItem('shawarma-last-order');
    if (legacy && /^[\w-]{43}$/.test(legacy) && !valid.some((o) => o.token === legacy))
      valid.unshift({ token: legacy });
    return valid.slice(0, 5);
  } catch {
    return [];
  }
}
export function saveOrder(order: SavedOrder) {
  try {
    localStorage.setItem(
      'shawarma-orders',
      JSON.stringify([order, ...savedOrders().filter((o) => o.token !== order.token)].slice(0, 5)),
    );
    localStorage.setItem('shawarma-last-order', order.token);
  } catch {
    /* Tracking still works if browser storage is disabled. */
  }
}
