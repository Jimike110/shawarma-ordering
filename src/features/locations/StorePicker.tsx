import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useRef } from 'react';
import {
  preferredPickup,
  rememberPickup,
  hasRememberedPickup,
  usePickupStores,
} from '@/features/locations/PickupStoresProvider';
import { PickupPicker } from '@/features/locations/PickupPicker';
import { Loading, Notice } from '@/shared/ui/Feedback';
import { inTelegramEntry } from '@/features/telegram/telegram';

export function StorePicker({ alwaysChoose = false }: { alwaysChoose?: boolean }) {
  const q = usePickupStores();
  const location = useLocation();
  const navigate = useNavigate();
  const initialDestination = useRef<string | null | undefined>(undefined);
  if (q.data && initialDestination.current === undefined) {
    const saved = preferredPickup(q.data);
    initialDestination.current = saved?.accepting_orders ? saved.slug : null;
  }
  if (location.hash === '#orders') return <Navigate to="/orders" replace />;
  if (q.loading && !q.data) return <Loading />;
  const selected = preferredPickup(q.data ?? []);
  if (!alwaysChoose && initialDestination.current)
    return <Navigate to={'/s/' + initialDestination.current + location.hash} replace />;
  if (q.data?.length)
    return (
      <main className="pickup-page">
        <Link className="pickup-home-brand" to="/">
          {q.data[0].settings.shop_name}
        </Link>
        {!alwaysChoose && !selected && hasRememberedPickup() && (
          <p className="pickup-message">
            Ранее выбранная точка больше недоступна. Выберите другой адрес.
          </p>
        )}
        {!alwaysChoose && selected && !selected.accepting_orders && (
          <p className="pickup-message">
            Сохранённая точка сейчас не принимает заказы. Можно выбрать другой адрес или
            посмотреть её меню.
          </p>
        )}
        <PickupPicker
          stores={q.data}
          current={selected}
          onChoose={(store) => {
            rememberPickup(store.slug);
            navigate('/s/' + store.slug + location.hash, { replace: true });
          }}
          error={q.error}
          refresh={q.refresh}
        />
        <div className="pickup-page-links">
          <Link to="/privacy">Политика обработки данных</Link>
          {!inTelegramEntry() && <Link to="/kitchen">Вход для сотрудников</Link>}
        </div>
      </main>
    );
  return (
    <main className="container store-picker">
      <h1>Меню пока недоступно</h1>
      {q.error && <Notice>{q.error}</Notice>}
      {q.error && (
        <button className="button" onClick={q.refresh}>
          Повторить
        </button>
      )}
      {q.data?.length === 0 && <p>Сейчас нет опубликованных точек.</p>}
      {!inTelegramEntry() && (
        <Link className="staff-link" to="/kitchen">
          Вход для сотрудников
        </Link>
      )}
      <Link className="text-link" to="/orders">
        Мои заказы
      </Link>
    </main>
  );
}
