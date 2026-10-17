import { useCallback } from 'react';
import { api } from '@/shared/api/client';
import { usePolling } from '@/shared/hooks/usePolling';
import { rub } from '@/shared/lib/format';
import { OwnerLoading, RefreshStatus } from '@/features/owner/OwnerUi';
import { moscowDate } from '@/features/analytics/reportSeries';
import { type Report } from '@/features/analytics/types';

export function TodaySummary({ storeId }: { storeId: string }) {
  const today = moscowDate();
  const load = useCallback(
    (signal: AbortSignal) =>
      api<Report>(
        '/owner/analytics?' +
          new URLSearchParams({
            from: today,
            to: today,
            ...(storeId ? { store_id: storeId } : {}),
          }),
        { signal },
      ),
    [today, storeId],
  );
  const q = usePolling(load, 30000);
  return (
    <section className="owner-section">
      <div className="owner-section-heading">
        <h2>Сегодня, МСК</h2>
        <span className="fine-print">По дате создания заказа</span>
      </div>
      <RefreshStatus error={q.error} lastUpdated={q.lastUpdated} refresh={q.refresh} />
      {!q.data && !q.error && <OwnerLoading />}
      {q.data && (
        <>
          <dl className="report-metrics">
            <div>
              <dt>Заказов</dt>
              <dd>{q.data.orders}</dd>
            </div>
            <div>
              <dt>Стоимость выданных</dt>
              <dd>{rub(q.data.completed_value)}</dd>
            </div>
            <div>
              <dt>Средний выданный заказ</dt>
              <dd>{rub(Math.round(q.data.average_basket))}</dd>
            </div>
            <div>
              <dt>Отменено</dt>
              <dd>{q.data.statuses.cancelled ?? 0}</dd>
            </div>
          </dl>
          <p className="fine-print">
            Стоимость выданных заказов не подтверждает полученную оплату и не является прибылью.
          </p>
        </>
      )}
    </section>
  );
}
