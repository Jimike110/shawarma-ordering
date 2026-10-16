import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { usePolling } from '../usePolling';
import { Notice, Loading } from '../ui';
import { useStaffStore } from '../staffStore';
import { clock, rub, statusLabels, type Store, type Order } from '../types';
import { OwnerLoading, RefreshStatus } from '../ownerWorkspace';

export interface Report {
  orders: number;
  statuses: Record<string, number>;
  completed_value: number;
  average_basket: number;
  preparation_minutes: number;
  preparation_samples: number;
  ready_minutes: number;
  ready_samples: number;
  late_ready: number;
  deadline_samples: number;
  daily: { date: string; orders: number; completed_value: number }[];
  products: { name: string; quantity: number; value: number }[];
  stores: {
    store_id: number;
    orders: number;
    completed_value: number;
    preparation_minutes: number;
    preparation_samples: number;
  }[];
}
export const moscowDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export function dailySeries(daily: Report['daily'], from: string, to: string): Report['daily'] {
  const start = Date.parse(from),
    end = Date.parse(to);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start ||
    end - start > 365 * 86400000
  )
    return [];
  const values = new Map(daily.map((d) => [d.date, d]));
  return Array.from({ length: Math.round((end - start) / 86400000) + 1 }, (_, i) => {
    const date = new Date(start + i * 86400000).toISOString().slice(0, 10);
    return values.get(date) ?? { date, orders: 0, completed_value: 0 };
  });
}
function DailyChart({ daily, from, to }: { daily: Report['daily']; from: string; to: string }) {
  const days = dailySeries(daily, from, to),
    max = Math.max(2, ...days.map((d) => d.orders));
  const x = (i: number) =>
    days.length === 1 ? 300 : 10 + (i / Math.max(1, days.length - 1)) * 580;
  const y = (n: number) => 150 - (n / max) * 140;
  const label = (s: string) => s.slice(8) + '.' + s.slice(5, 7);
  return (
    <figure className="owner-chart">
      <figcaption>Количество заказов, шт.</figcaption>
      <div className="owner-chart-body">
        <div className="owner-chart-y">
          <span>{max}</span>
          <span>{Math.round(max / 2)}</span>
          <span>0</span>
        </div>
        <svg
          viewBox="0 0 600 160"
          preserveAspectRatio="none"
          role="img"
          aria-label={'Заказы по дням с ' + from + ' по ' + to + '; точные значения в таблице ниже'}
        >
          {[0, max / 2, max].map((n) => (
            <line key={n} x1="0" x2="600" y1={y(n)} y2={y(n)} stroke="var(--line)" />
          ))}
          <path
            d={days.map((d, i) => (i ? 'L' : 'M') + x(i) + ',' + y(d.orders)).join(' ')}
            fill="none"
            stroke="var(--orange)"
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
          />
          {days.map((d, i) => (
            <circle
              key={d.date}
              cx={x(i)}
              cy={y(d.orders)}
              r={days.length > 31 ? 2 : 4}
              fill="var(--orange)"
            >
              <title>
                {d.date}: {d.orders} заказов
              </title>
            </circle>
          ))}
        </svg>
      </div>
      <div className="owner-chart-x">
        <span>{label(from)}</span>
        {days.length > 2 && <span>{label(days[Math.floor(days.length / 2)].date)}</span>}
        <span>{label(to)}</span>
      </div>
    </figure>
  );
}
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
const previousDate = (date: string, n: number) => {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
export function AnalyticsPanel({
  endpoint,
  stores = [],
  owner = false,
}: {
  endpoint: string;
  stores?: Store[];
  owner?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const [to, setTo] = useState(moscowDate),
    [from, setFrom] = useState(() => previousDate(moscowDate(), 6)),
    [localStore, setStore] = useState('');
  const fromValue = owner ? (params.get('from') ?? from) : from;
  const toValue = owner ? (params.get('to') ?? to) : to;
  const store = owner ? (params.get('store_id') ?? '') : localStore;
  function dates(start: string, end: string) {
    if (owner) {
      const p = new URLSearchParams(params);
      p.set('from', start);
      p.set('to', end);
      setParams(p);
    } else {
      setFrom(start);
      setTo(end);
    }
  }
  const valid =
    !!fromValue &&
    !!toValue &&
    fromValue <= toValue &&
    (Date.parse(toValue) - Date.parse(fromValue)) / 86400000 <= 365;
  const load = useCallback(
    (signal: AbortSignal) =>
      api<Report>(
        endpoint +
          '?' +
          new URLSearchParams({
            from: fromValue,
            to: toValue,
            ...(store ? { store_id: store } : {}),
          }),
        { signal },
      ),
    [endpoint, fromValue, toValue, store],
  );
  const { data, error, loading, refresh, lastUpdated } = usePolling(load, 30000, valid);
  const ready = data?.deadline_samples ?? 0;
  return (
    <section className="reports">
      <h2>Аналитика заказов</h2>
      <p className="fine-print">Заказы, созданные за выбранный период · время Москвы</p>
      <div className="report-filters">
        <div className="time-presets">
          {[1, 7, 30].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                const today = moscowDate();
                dates(previousDate(today, n - 1), today);
              }}
            >
              {n === 1 ? 'Сегодня' : n + ' дней'}
            </button>
          ))}
        </div>
        <label>
          С даты
          <input type="date" value={fromValue} onChange={(e) => dates(e.target.value, toValue)} />
        </label>
        <label>
          По дату
          <input type="date" value={toValue} onChange={(e) => dates(fromValue, e.target.value)} />
        </label>
        {!owner && stores.length > 0 && (
          <label>
            Точка
            <select value={store} onChange={(e) => setStore(e.target.value)}>
              <option value="">Все точки</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.settings.address}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="button secondary small" onClick={refresh}>
          Обновить
        </button>
      </div>
      {!valid && <Notice>Выберите корректный период не более одного года.</Notice>}
      <RefreshStatus error={error} lastUpdated={lastUpdated} refresh={refresh} />
      {loading && !data && <Loading />}
      {data && valid && (
        <>
          <dl className="report-metrics">
            <div>
              <dt>Заказов</dt>
              <dd>{data.orders}</dd>
            </div>
            <div>
              <dt>Стоимость выданных заказов</dt>
              <dd>{rub(data.completed_value)}</dd>
            </div>
            <div>
              <dt>Средний выданный заказ</dt>
              <dd>{rub(Math.round(data.average_basket))}</dd>
            </div>
            <div>
              <dt>Отменено</dt>
              <dd>{data.statuses.cancelled ?? 0}</dd>
            </div>
          </dl>
          <p className="fine-print">
            Стоимость выданных заказов не подтверждает полученную оплату и не является прибылью.
          </p>
          <div className="panel">
            <h3>Время приготовления</h3>
            <dl className="report-metrics">
              <div>
                <dt>От начала готовки до готовности</dt>
                <dd>
                  {data.preparation_samples
                    ? data.preparation_minutes.toFixed(1) + ' мин'
                    : 'Нет данных'}
                </dd>
                <small>{data.preparation_samples} измерений</small>
              </div>
              <div>
                <dt>От заказа до готовности</dt>
                <dd>
                  {data.ready_samples ? data.ready_minutes.toFixed(1) + ' мин' : 'Нет данных'}
                </dd>
                <small>{data.ready_samples} измерений</small>
              </div>
              <div>
                <dt>Готовы позже первоначального срока</dt>
                <dd>{ready ? data.late_ready + ' из ' + ready : 'Нет данных'}</dd>
              </div>
            </dl>
            <p className="fine-print">
              Учитываем только заказы с сохранённой историей статусов. Старые сроки не
              восстанавливаем.
            </p>
          </div>
          <div className="panel">
            <h3>По дням</h3>
            {!data.daily.length ? (
              <p>За этот период заказов нет.</p>
            ) : (
              <>
                <DailyChart daily={data.daily} from={fromValue} to={toValue} />
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Дата</th>
                        <th>Заказы</th>
                        <th>Выданные заказы, ₽</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailySeries(data.daily, fromValue, toValue).map((d) => (
                        <tr key={d.date}>
                          <td>{d.date.split('-').reverse().join('.')}</td>
                          <td>{d.orders}</td>
                          <td>{rub(d.completed_value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
          <div className="panel">
            <h3>Популярные товары в выданных заказах</h3>
            {!data.products.length ? (
              <p>Выданных заказов пока нет.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Товар</th>
                      <th>Количество</th>
                      <th>Стоимость</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.products.map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        <td>{p.quantity}</td>
                        <td>{rub(p.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {stores.length > 0 && (
            <div className="panel">
              <h3>Сравнение точек</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Точка</th>
                      <th>Заказы</th>
                      <th>Выданные заказы</th>
                      <th>Приготовление</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stores.map((s) => (
                      <tr key={s.store_id}>
                        <td>
                          {stores.find((p) => p.id === s.store_id)?.settings.address ??
                            'Точка ' + s.store_id}
                        </td>
                        <td>{s.orders}</td>
                        <td>{rub(s.completed_value)}</td>
                        <td>
                          {s.preparation_samples
                            ? s.preparation_minutes.toFixed(1) +
                              ' мин · ' +
                              s.preparation_samples +
                              ' измерений'
                            : 'Нет данных'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
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
              {new Date(o.created_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })},{' '}
              {clock(o.created_at)}
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
              {e.details.cancellation_reason ? ' · ' + String(e.details.cancellation_reason) : ''}
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
export function StoreReports() {
  const { id } = useStaffStore();
  return (
    <main className="container">
      <Link className="back-link" to={'/staff/stores/' + id}>
        ← Вернуться в кухню
      </Link>
      <AnalyticsPanel endpoint={'/staff/stores/' + id + '/analytics'} />
      <HistoryPanel endpoint={'/staff/stores/' + id + '/history'} />
      <ActivityPanel endpoint={'/staff/stores/' + id + '/activity'} />
    </main>
  );
}
