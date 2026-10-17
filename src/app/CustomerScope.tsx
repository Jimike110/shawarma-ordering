import { Link, useLocation, useParams } from 'react-router-dom';
import { FrozenMenuProvider, MenuProvider, useMenu } from '@/features/catalog/MenuProvider';
import { pendingAtSlug } from '@/features/checkout/checkoutAttempt';
import { CartProvider } from '@/features/cart/cart';
import { Layout } from '@/app/CustomerLayout';
import { Loading, Notice } from '@/shared/ui/Feedback';

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
    const pending =
      slug && location.pathname.endsWith('/checkout') ? pendingAtSlug(slug) : null;
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
