import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/shared/api/client';
import { usePolling } from '@/shared/hooks/usePolling';
import { Loading } from '@/shared/ui/Feedback';
import { statusLabels } from '@/shared/lib/format';
import { type Store } from '@/shared/api/types';
import { RefreshStatus } from '@/features/owner/OwnerUi';

interface Event {
  device_label?: string;
  id: number;
  actor: string;
  store_id: number | null;
  action: string;
  resource: string;
  details: Record<string, unknown>;
  created_at: string;
}

const actionLabels: Record<string, string> = {
  'privacy.publish': 'Публикация документов',
  'privacy.retention': 'Настройка сроков хранения',
  'privacy.request.verify': 'Проверка принадлежности данных',
  'privacy.request.export': 'Выгрузка по обращению',
  'privacy.request.correct': 'Исправление данных',
  'privacy.request.erase': 'Удаление необязательных полей',
  'privacy.request.block': 'Блокировка спорных полей',
  'privacy.request.resolve': 'Завершение обращения',
  'order.update': 'Изменение заказа',
  'store.operations': 'Работа точки',
  'store.status': 'Статус точки',
  'settings.update': 'Настройки точки',
  'product.save': 'Изменение меню',
  'product.delete': 'Удаление товара',
  'product.availability': 'Доступность товара',
  'account.save': 'Учётная запись',
  'account.password_reset': 'Сброс пароля',
  'account.password_change': 'Смена пароля',
  'account.bootstrap': 'Создание владельца',
  'store.create': 'Создание точки',
  'menu.copy': 'Копирование меню',
};

export function ActivityPanel({
  endpoint,
  stores = [],
  compact = false,
  storeId = '',
  hideHeading = false,
  owner = false,
}: {
  endpoint: string;
  stores?: Store[];
  compact?: boolean;
  storeId?: string;
  hideHeading?: boolean;
  owner?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const [localBefore, setBefore] = useState<number | null>(null),
    [older, setOlder] = useState<Event[]>([]);
  const before = owner ? params.get('before') : localBefore;
  const load = useCallback(
    (signal: AbortSignal) =>
      api<Event[]>(
        endpoint +
          '?' +
          new URLSearchParams({
            ...(before ? { before: String(before) } : {}),
            ...(storeId ? { store_id: storeId } : {}),
          }),
        { signal },
      ),
    [endpoint, before, storeId],
  );
  const q = usePolling(load, 15000);
  const events = [...(owner ? [] : older), ...(q.data ?? [])];
  return (
    <section>
      {!hideHeading && <h2>Действия сотрудников</h2>}
      <RefreshStatus error={q.error} lastUpdated={q.lastUpdated} refresh={q.refresh} />
      {q.loading && !q.data && <Loading />}
      <div className="activity-list">
        {(compact ? events.slice(0, 5) : events).map((e) => (
          <article className="activity-row" key={e.id}>
            <div>
              <strong>{actionLabels[e.action] ?? e.action}</strong>
              <small>
                {e.actor}
                {e.device_label ? ' · ' + e.device_label : ''} ·{' '}
                {new Date(e.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
                {e.store_id
                  ? ' · ' +
                    (stores.find((s) => s.id === e.store_id)?.settings.address ??
                      'Точка ' + e.store_id)
                  : ' · Для всего бизнеса'}
              </small>
            </div>
            <p>
              {typeof e.details.status === 'string' &&
                statusLabels[e.details.status as keyof typeof statusLabels]}
              {e.details.reason ? ' · ' + String(e.details.reason) : ''}
              {e.details.cancellation_reason
                ? ' · ' + String(e.details.cancellation_reason)
                : ''}
              {typeof e.details.paused === 'boolean' &&
                (e.details.paused ? ' · Пауза' : ' · Возобновление')}
              {typeof e.details.owner_stopped === 'boolean' &&
                (e.details.owner_stopped ? ' · Стоп владельца' : ' · Стоп снят')}
              {e.details.prep_minutes ? ' · ' + String(e.details.prep_minutes) + ' мин' : ''}
              {e.details.name ? ' · ' + String(e.details.name) : ''}
            </p>
          </article>
        ))}
      </div>
      {!compact && q.data?.length === 100 && (
        <button
          className="button secondary"
          onClick={() => {
            if (owner) {
              const p = new URLSearchParams(params);
              p.set('before', String(q.data![q.data!.length - 1].id));
              setParams(p);
              return;
            }
            setOlder(events);
            setBefore(q.data![q.data!.length - 1].id);
          }}
        >
          Более ранние действия
        </button>
      )}
      {!q.loading && !events.length && !q.error && <p>Изменений пока нет.</p>}
    </section>
  );
}
