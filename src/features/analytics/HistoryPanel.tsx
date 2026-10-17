import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/shared/api/client';
import { usePolling } from '@/shared/hooks/usePolling';
import { Loading } from '@/shared/ui/Feedback';
import { clock, rub, statusLabels } from '@/shared/lib/format';
import { type Order } from '@/shared/api/types';
import { RefreshStatus } from '@/features/owner/OwnerUi';

export function HistoryPanel({
  endpoint,
  initialStatus = '',
  compact = false,
  storeId = '',
  hideHeading = false,
  owner = false,
}: {
  endpoint: string;
  initialStatus?: string;
  compact?: boolean;
  storeId?: string;
  hideHeading?: boolean;
  owner?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const [localStatus, setStatus] = useState(initialStatus),
    [localBefore, setBefore] = useState<number | null>(null),
    [older, setOlder] = useState<Order[]>([]);
  const status = owner ? (params.get('status') ?? '') : localStatus;
  const before = owner ? params.get('before') : localBefore;
  const load = useCallback(
    (signal: AbortSignal) =>
      api<Order[]>(
        endpoint +
          '?' +
          new URLSearchParams({
            status,
            ...(before ? { before: String(before) } : {}),
            ...(storeId ? { store_id: storeId } : {}),
          }),
        { signal },
      ),
    [endpoint, status, before, storeId],
  );
  const q = usePolling(load, 15000);
  const change = (next: string) => {
    if (owner) {
      const p = new URLSearchParams(params);
      p.set('status', next);
      p.delete('before');
      setParams(p);
      return;
    }
    setStatus(next);
    setBefore(null);
    setOlder([]);
  };
  const values = [...(owner ? [] : older), ...(q.data ?? [])];
  return (
    <section>
      {!hideHeading && <h2>История заказов</h2>}
      {!compact && (
        <label>
          Статус
          <select value={status} onChange={(e) => change(e.target.value)}>
            <option value="">Все</option>
            {Object.entries(statusLabels).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      <RefreshStatus error={q.error} lastUpdated={q.lastUpdated} refresh={q.refresh} />
      {q.loading && !q.data && <Loading />}
      <div className="history-list">
        {(compact ? values.slice(0, 5) : values).map((o) => (
          <article className="panel" key={o.id}>
            <div className="section-top">
              <strong>№{o.number}</strong>
              <span>{statusLabels[o.status]}</span>
              <b>{rub(o.total)}</b>
            </div>
            <p>
              {o.shop?.address} ·{' '}
              {new Date(o.created_at).toLocaleDateString('ru-RU', {
                timeZone: 'Europe/Moscow',
              })}
              , {clock(o.created_at)}
            </p>
            {o.name && <p>{o.name}</p>}
            <p>{o.items.map((i) => i.quantity + ' × ' + i.name).join(', ')}</p>
            {o.cancellation_reason && (
              <p>
                Причина: {o.cancellation_reason}
                {o.cancelled_by && ' · Отменил: ' + o.cancelled_by}
              </p>
            )}
          </article>
        ))}
      </div>
      {!compact && q.data?.length === 100 && (
        <button
          className="button secondary"
          onClick={() => {
            if (owner) {
              const p = new URLSearchParams(params);
              p.set('before', String(q.data![q.data!.length - 1].id!));
              setParams(p);
              return;
            }
            setOlder(values);
            setBefore(q.data![q.data!.length - 1].id!);
          }}
        >
          Более ранние заказы
        </button>
      )}
      {!q.loading && !values.length && !q.error && <p>Заказов нет.</p>}
    </section>
  );
}
