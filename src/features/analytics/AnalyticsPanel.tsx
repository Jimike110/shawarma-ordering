import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/shared/api/client';
import { usePolling } from '@/shared/hooks/usePolling';
import { Notice, Loading } from '@/shared/ui/Feedback';
import { rub } from '@/shared/lib/format';
import { type Store } from '@/shared/api/types';
import { RefreshStatus } from '@/features/owner/OwnerUi';
import { moscowDate, previousDate, dailySeries } from '@/features/analytics/reportSeries';
import { DailyChart } from '@/features/analytics/DailyChart';
import { type Report } from '@/features/analytics/types';

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
          <input
            type="date"
            value={fromValue}
            onChange={(e) => dates(e.target.value, toValue)}
          />
        </label>
        <label>
          По дату
          <input
            type="date"
            value={toValue}
            onChange={(e) => dates(fromValue, e.target.value)}
          />
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
