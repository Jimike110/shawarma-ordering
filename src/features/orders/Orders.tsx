import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ShoppingBag } from 'lucide-react';
import { useSavedOrders } from '@/features/orders/useSavedOrders';

export function Orders() {
  const orders = useSavedOrders();
  return (
    <main className="container orders-page">
      <Link to="/" className="back-link">
        <ArrowLeft size={17} /> Вернуться в меню
      </Link>
      <h1>Мои заказы</h1>
      <p className="lead">Заказы, сохранённые в этом браузере.</p>
      {orders.length === 0 ? (
        <section className="panel empty">
          <ShoppingBag size={40} strokeWidth={1.5} />
          <h2>Пока нет заказов</h2>
          <p>Выберите что-нибудь вкусное — после оформления заказ появится здесь.</p>
          <Link to="/" className="button">
            Перейти в меню
          </Link>
        </section>
      ) : (
        <ul className="saved-order-list" aria-label="Сохранённые заказы">
          {orders.map((order) => (
            <li key={order.token}>
              <Link className="saved-order" to={'/track#' + order.token}>
                <span>
                  <b>{order.number ? 'Заказ №' + order.number : 'Заказ по личной ссылке'}</b>
                  <small>
                    {order.expired && 'Срок хранения квитанции истёк · '}
                    {order.created_at
                      ? new Date(order.created_at).toLocaleString('ru-RU', {
                          timeZone: 'Europe/Moscow',
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        }) + ' · МСК'
                      : 'Открыть заказ'}
                  </small>
                </span>
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
