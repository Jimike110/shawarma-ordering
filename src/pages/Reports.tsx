import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { usePolling } from '../usePolling';
import { Notice, Loading } from '../ui';
import { useStaffStore } from '../staff';
import { clock, rub, statusLabels, type Store, type Order } from '../types';

interface Report {
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
const previousDate = (date: string, n: number) => {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
export function AnalyticsPanel({ endpoint, stores = [] }: { endpoint: string; stores?: Store[] }) {
  const [to, setTo] = useState(moscowDate),
    [from, setFrom] = useState(() => previousDate(moscowDate(), 6)),
    [store, setStore] = useState('');
  const valid =
    !!from && !!to && from <= to && (Date.parse(to) - Date.parse(from)) / 86400000 <= 365;
  const load = useCallback(
    (signal: AbortSignal) =>
      api<Report>(
        endpoint + '?' + new URLSearchParams({ from, to, ...(store ? { store_id: store } : {}) }),
        { signal },
      ),
    [endpoint, from, to, store],
  );
  const { data, error, loading, refresh } = usePolling(load, 30000, valid);
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
                setTo(today);
                setFrom(previousDate(today, n - 1));
              }}
            >
              {n === 1 ? 'Сегодня' : n + ' дней'}
            </button>
          ))}
        </div>
        <label>
          С даты
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          По дату
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {stores.length > 0 && (
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
      {error && <Notice>{error}</Notice>}
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
                <svg
                  className="order-chart"
                  viewBox="0 0 600 160"
                  role="img"
                  aria-label={'Количество заказов по дням с ' + from + ' по ' + to}
                >
                  <path
                    d={data.daily
                      .map((d, i) => {
                        const span = Math.max(1, (Date.parse(to) - Date.parse(from)) / 86400000);
                        const x =
                          20 + ((Date.parse(d.date) - Date.parse(from)) / 86400000 / span) * 560;
                        const y =
                          140 - (d.orders / Math.max(1, ...data.daily.map((v) => v.orders))) * 120;
                        return (i ? 'L' : 'M') + x + ',' + y;
                      })
                      .join(' ')}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                  />
                  {data.daily.map((d) => {
                    const span = Math.max(1, (Date.parse(to) - Date.parse(from)) / 86400000);
                    return (
                      <circle
                        key={d.date}
                        cx={20 + ((Date.parse(d.date) - Date.parse(from)) / 86400000 / span) * 560}
                        cy={
                          140 - (d.orders / Math.max(1, ...data.daily.map((v) => v.orders))) * 120
                        }
                        r="4"
                      >
                        <title>
                          {d.date}: {d.orders} заказов
                        </title>
                      </circle>
                    );
                  })}
                </svg>
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
                      {data.daily.map((d) => (
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
}: {
  endpoint: string;
  initialStatus?: string;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState(initialStatus),
    [before, setBefore] = useState<number | null>(null),
    [older, setOlder] = useState<Order[]>([]);
  const load = useCallback(
    (signal: AbortSignal) =>
      api<Order[]>(
        endpoint +
          '?' +
          new URLSearchParams({ status, ...(before ? { before: String(before) } : {}) }),
        { signal },
      ),
    [endpoint, status, before],
  );
  const q = usePolling(load, 15000);
  const change = (next: string) => {
    setStatus(next);
    setBefore(null);
    setOlder([]);
  };
  const values = [...older, ...(q.data ?? [])];
  return (
    <section>
      <h2>История заказов</h2>
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
      {q.error && <Notice>{q.error}</Notice>}
      <div className="history-list">
        {(compact && !expanded ? values.slice(0, 5) : values).map((o) => (
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
      {compact && !expanded && values.length > 5 && (
        <button className="button secondary" onClick={() => setExpanded(true)}>
          Показать ещё заказы ({values.length})
        </button>
      )}
      {(!compact || expanded) && q.data?.length === 100 && (
        <button
          className="button secondary"
          onClick={() => {
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
  id: number;
  actor: string;
  store_id: number | null;
  action: string;
  resource: string;
  details: Record<string, unknown>;
  created_at: string;
}
const actionLabels: Record<string, string> = {
  'order.update': 'Изменение заказа',
  'store.operations': 'Работа точки',
  'store.status': 'Статус точки',
  'settings.update': 'Настройки точки',
  'product.save': 'Изменение меню',
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
}: {
  endpoint: string;
  stores?: Store[];
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [before, setBefore] = useState<number | null>(null),
    [older, setOlder] = useState<Event[]>([]);
  const load = useCallback(
    (signal: AbortSignal) =>
      api<Event[]>(endpoint + (before ? '?before=' + before : ''), { signal }),
    [endpoint, before],
  );
  const q = usePolling(load, 15000);
  const events = [...older, ...(q.data ?? [])];
  return (
    <section>
      <h2>Действия сотрудников</h2>
      {q.error && <Notice>{q.error}</Notice>}
      <div className="activity-list">
        {(compact && !expanded ? events.slice(0, 10) : events).map((e) => (
          <article className="activity-row" key={e.id}>
            <div>
              <strong>{actionLabels[e.action] ?? e.action}</strong>
              <small>
                {e.actor} ·{' '}
                {new Date(e.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
                {e.store_id &&
                  ' · ' +
                    (stores.find((s) => s.id === e.store_id)?.settings.address ??
                      'Точка ' + e.store_id)}
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
      {compact && !expanded && events.length > 10 && (
        <button className="button secondary" onClick={() => setExpanded(true)}>
          Показать ещё действия ({events.length})
        </button>
      )}
      {(!compact || expanded) && q.data?.length === 100 && (
        <button
          className="button secondary"
          onClick={() => {
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
