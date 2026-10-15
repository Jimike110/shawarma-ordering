import { useCallback, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Check, CheckCheck, Clock3, CookingPot, Copy, RefreshCw, X } from 'lucide-react';
import { api, ApiError } from '../api';
import { saveOrder } from '../orderHistory';
import { usePolling } from '../usePolling';
import { Loading, Notice } from '../ui';
import { ShopInfo } from '../ui';
import { useMenu } from '../menu';
import { clock, rub, statusLabels, type Order, type Status } from '../types';
const steps: Status[] = ['new', 'preparing', 'ready', 'completed'];
const isComplete = (order: Order) => order.status === 'completed' || order.status === 'cancelled';
export function Tracking() {
  const { data: menu } = useMenu();
  const location = useLocation();
  const token = location.hash.slice(1);
  const [expiredToken, setExpiredToken] = useState<string | null>(null);
  const load = useCallback(
    async (signal: AbortSignal) => {
      let order: Order;
      try {
        order = await api<Order>('/orders/' + encodeURIComponent(token), { signal });
      } catch (e) {
        if (!signal.aborted && e instanceof ApiError && e.status === 410) {
          saveOrder({ token, expired: true });
          setExpiredToken(token);
        }
        throw e;
      }
      if (!signal.aborted) saveOrder({ token, number: order.number, created_at: order.created_at });
      return order;
    },
    [token],
  );
  const {
    data: order,
    error,
    loading,
    lastUpdated,
    refresh,
  } = usePolling(load, 5000, token.length === 43 && expiredToken !== token, isComplete);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  if (expiredToken === token)
    return (
      <main className="container empty">
        <h1>Срок хранения квитанции истёк</h1>
        <p>
          Индивидуальные данные заказа удалены. Ссылка остаётся в истории этого браузера с отметкой
          об истечении.
        </p>
        <Link className="button" to="/orders">
          Мои заказы
        </Link>
        <Link to="/privacy">Сроки обработки данных</Link>
      </main>
    );
  if (token.length !== 43)
    return (
      <main className="container empty">
        <h1>Нужна личная ссылка</h1>
        <p>Откройте ссылку, которую вы получили после оформления.</p>
        <Link className="button" to="/">
          Вернуться в меню
        </Link>
      </main>
    );
  if (!order && loading) return <Loading />;
  if (!order)
    return (
      <main className="container empty">
        <Notice>{error}</Notice>
        <button className="button" onClick={refresh}>
          Проверить снова
        </button>
        <Link to="/">Вернуться в меню</Link>
      </main>
    );
  const step = steps.indexOf(order.status);
  const cancelled = order.status === 'cancelled';
  const ready = order.status === 'ready';
  const closed = cancelled || order.status === 'completed';
  const late = !closed && !ready && Date.now() > Date.parse(order.estimated_ready_at);
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setCopyError('');
    } catch {
      setCopyError('Скопируйте ссылку из адресной строки браузера.');
    }
  }
  return (
    <main className="container tracking">
      <div className={'tracking-card ' + (ready ? 'is-ready' : cancelled ? 'is-cancelled' : '')}>
        <div className="eyebrow">
          {closed ? 'ВАШ ЗАКАЗ' : ready ? 'ГОТОВО К ВЫДАЧЕ' : 'ГОТОВИМ ДЛЯ ВАС'}
        </div>
        <span className="tracking-icon">
          {cancelled ? (
            <X size={37} />
          ) : ready || order.status === 'completed' ? (
            <CheckCheck size={37} />
          ) : (
            <CookingPot size={37} />
          )}
        </span>
        <h1>ЗАКАЗ №{order.number}</h1>
        <h2 className="order-status-hint">
          {cancelled
            ? 'Заказ отменён'
            : ready
              ? 'Горячая. Ваша.'
              : order.status === 'completed'
                ? 'Приятного аппетита!'
                : 'Скоро будет вкусно.'}
        </h2>
        <p className="lead">
          {cancelled
            ? order.cancellation_reason ||
              'Кухня отменила заказ. Свяжитесь с заведением, чтобы уточнить причину.'
            : ready
              ? 'Заходите за заказом. Назовите номер и оплатите на месте.'
              : order.status === 'completed'
                ? 'Заказ выдан. Будем рады видеть вас снова.'
                : order.status === 'preparing'
                  ? 'Ваш заказ уже готовится. Покажем, когда можно забирать.'
                  : 'Заказ принят. Кухня скоро начнёт готовить.'}
        </p>
        {!cancelled && (
          <ol className="order-steps">
            {steps.map((status, i) => (
              <li
                key={status}
                className={i <= step ? 'done' : ''}
                aria-current={i === step ? 'step' : undefined}
              >
                <span>{i < step ? <Check size={16} /> : i + 1}</span>
                <b>{statusLabels[status]}</b>
              </li>
            ))}
          </ol>
        )}
        {!cancelled && step < 2 && (
          <div className="eta">
            <Clock3 size={21} />
            <div>
              <span>Ориентировочно к</span>
              <strong>
                {clock(order.estimated_ready_at)} <small>МСК</small>
              </strong>
              {new Date(order.estimated_ready_at).toLocaleDateString('ru-RU', {
                timeZone: 'Europe/Moscow',
              }) !== new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) && (
                <span>
                  {new Date(order.estimated_ready_at).toLocaleDateString('ru-RU', {
                    timeZone: 'Europe/Moscow',
                    day: 'numeric',
                    month: 'long',
                  })}
                </span>
              )}
            </div>
          </div>
        )}
        {late && (
          <Notice kind="warning">
            Готовим дольше, чем ожидали. Дождитесь статуса «Можно забирать» — указанное время было
            ориентировочным.
          </Notice>
        )}
        {error && (
          <Notice>Связь прервалась. Показываем последний полученный статус. {error}</Notice>
        )}
        <div className="refresh-row">
          <span className={'status-dot ' + (error ? 'offline' : '')} />
          <small>
            {error
              ? 'Повторяем подключение каждые 5 секунд'
              : closed
                ? 'Заказ закрыт'
                : 'Обновляем каждые 5 секунд'}
            {lastUpdated ? ' · ' + clock(lastUpdated.toISOString()) + ' МСК' : ''}
          </small>
          <button className="icon-button" onClick={refresh} aria-label="Обновить статус">
            <RefreshCw size={17} />
          </button>
        </div>
        <button className="button secondary full" onClick={copy}>
          <Copy size={17} />
          {copied ? 'Ссылка скопирована' : 'Сохранить личную ссылку'}
        </button>
        {copyError && <Notice kind="warning">{copyError}</Notice>}
        <p className="fine-print">Тот, у кого есть эта ссылка, сможет видеть статус заказа.</p>
      </div>
      <div className="tracking-details panel">
        <h2>Что забираете</h2>
        {order.items.map((item) => (
          <div
            className="receipt-line"
            key={item.product_id + ':' + (item.options ?? []).map((o) => o.id).join(',')}
          >
            <span>
              {item.quantity} × {item.name}
              {!!item.options?.length && (
                <small className="receipt-options">
                  {item.options.map((o) => o.label).join(', ')}
                </small>
              )}
            </span>
            <b>{rub(item.price * item.quantity)}</b>
          </div>
        ))}
        <div className="cart-summary">
          <span>Оплата при получении</span>
          <strong>{rub(order.total)}</strong>
        </div>
        {(order.shop || menu) && <ShopInfo settings={order.shop ?? menu!.settings} />}
        <div className="tracking-links">
          <Link to="/orders" className="text-link">
            Все мои заказы
          </Link>
          <Link to={order.store_slug ? '/s/' + order.store_slug : '/'} className="text-link">
            Вернуться в меню
          </Link>
        </div>
      </div>
    </main>
  );
}
