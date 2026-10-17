import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useRef } from 'react';
import {
  preferredPickup,
  rememberPickup,
  hasRememberedPickup,
  usePickupStores,
} from '../pickupStores';
import { PickupPicker } from '../PickupPicker';
import { FrozenMenuProvider, MenuProvider, useMenu } from '../menu';
import { pendingAtSlug } from '../checkoutAttempt';
import { CartProvider } from '../cart';
import { Layout, Loading, Notice } from '../ui';

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
            Сохранённая точка сейчас не принимает заказы. Можно выбрать другой адрес или посмотреть
            её меню.
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
          <Link to="/kitchen">Вход для сотрудников</Link>
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
      <Link className="staff-link" to="/kitchen">
        Вход для сотрудников
      </Link>
      <Link className="text-link" to="/orders">
        Мои заказы
      </Link>
    </main>
  );
}
export function CustomerScope({ neutral = false }: { neutral?: boolean }) {
  const { slug } = useParams();
  return (
    <MenuProvider
      key={slug ?? 'original'}
      endpoint={slug ? '/stores/' + encodeURIComponent(slug) + '/menu' : '/menu'}
    >
      <CustomerCart neutral={neutral} />
    </MenuProvider>
  );
}
function CustomerCart({ neutral }: { neutral: boolean }) {
  const q = useMenu();
  const { slug } = useParams();
  const location = useLocation();
  if (neutral)
    return (
      <CartProvider storeId={1}>
        <Layout neutral />
      </CartProvider>
    );
  if (!q.data) {
    const pending = slug && location.pathname.endsWith('/checkout') ? pendingAtSlug(slug) : null;
    if (pending?.shop && pending.payload.store_id) {
      const settings = pending.shop;
      const store = {
        id: pending.payload.store_id,
        slug: slug!,
        published: false,
        archived: false,
        owner_stopped: false,
        stop_reason: '',
        settings,
        accepting_orders: false,
        intake_message: '',
      };
      return (
        <FrozenMenuProvider
          menu={{
            store,
            settings,
            products: [],
            accepting_orders: false,
            intake_message: '',
            estimated_minutes: settings.prep_minutes,
          }}
        >
          <CartProvider key={store.id} storeId={store.id}>
            <Layout />
          </CartProvider>
        </FrozenMenuProvider>
      );
    }
    if (q.loading) return <Loading />;
    return (
      <main className="container empty">
        <h1>Меню пока недоступно</h1>
        <Notice>{q.error}</Notice>
        <button className="button" onClick={q.refresh}>
          Повторить
        </button>
        <Link to="/">Выбрать другую точку</Link>
      </main>
    );
  }
  return (
    <CartProvider key={q.data.store?.id ?? 1} storeId={q.data.store?.id ?? 1}>
      <Layout neutral={neutral} />
    </CartProvider>
  );
}
