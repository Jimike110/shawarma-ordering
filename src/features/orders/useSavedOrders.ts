import { useEffect, useState } from 'react';
import { api, ApiError } from '@/shared/api/client';
import { ORDER_HISTORY_CHANGED, savedOrders, saveOrder } from '@/features/orders/orderHistory';
import { type Order } from '@/shared/api/types';

export function useSavedOrders({ recoverMetadata = true }: { recoverMetadata?: boolean } = {}) {
  const [orders, setOrders] = useState(savedOrders);
  useEffect(() => {
    const controller = new AbortController();
    const attempted = new Set<string>();
    let recovering = false;
    async function recover() {
      if (!recoverMetadata || recovering || controller.signal.aborted) return;
      recovering = true;
      try {
        // Sequential requests avoid flooding the API when migrating a large history.
        for (;;) {
          const missing = savedOrders().find(
            (order) =>
              !order.expired &&
              (!order.number ||
                !order.created_at ||
                Date.parse(order.created_at) < Date.now() - 365 * 86400000) &&
              !attempted.has(order.token),
          );
          if (!missing || controller.signal.aborted) break;
          attempted.add(missing.token);
          try {
            const order = await api<Order>('/orders/' + encodeURIComponent(missing.token), {
              signal: controller.signal,
            });
            if (
              !controller.signal.aborted &&
              savedOrders().some((saved) => saved.token === missing.token)
            )
              saveOrder({
                token: missing.token,
                number: order.number,
                created_at: order.created_at,
              });
          } catch (e) {
            if (!controller.signal.aborted && e instanceof ApiError && e.status === 410)
              saveOrder({ token: missing.token, expired: true });
            /* Keep the personal link on network errors or unavailable orders. */
          }
        }
      } finally {
        recovering = false;
      }
    }
    function sync() {
      setOrders(savedOrders());
      void recover();
    }
    function storage(event: StorageEvent) {
      if (
        event.key === null ||
        event.key === 'shawarma-orders' ||
        event.key === 'shawarma-last-order'
      )
        sync();
    }
    function online() {
      attempted.clear();
      void recover();
    }
    window.addEventListener(ORDER_HISTORY_CHANGED, sync);
    window.addEventListener('storage', storage);
    window.addEventListener('online', online);
    sync();
    return () => {
      controller.abort();
      window.removeEventListener(ORDER_HISTORY_CHANGED, sync);
      window.removeEventListener('storage', storage);
      window.removeEventListener('online', online);
    };
  }, [recoverMetadata]);
  return orders;
}
