import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Banknote, Check, Clock3, MapPin } from 'lucide-react';
import { api, ApiError, errorMessage, json } from '../api';
import { cartTotal, invalidLine, unitPrice, useCart } from '../cart';
import { useMenu, useShopPath } from '../menu';
import { CartItems, Loading, Notice, ShopInfo } from '../ui';
import { randomKey } from '../requestKey';
import { readAttempt, persist, type Attempt } from '../checkoutAttempt';
import { saveOrder } from '../orderHistory';
import { rub, type Order } from '../types';
export function Checkout() {
  const { data: menu, error: menuError, loading, refresh } = useMenu();
  const { lines, clear } = useCart();
  const storeId = menu?.store?.id ?? 1;
  const shopPath = useShopPath();
  const [pending, setPending] = useState<Attempt | null>(() => readAttempt(storeId));
  const [name, setName] = useState(() => pending?.payload.name ?? '');
  const [note, setNote] = useState(() => pending?.payload.note ?? '');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const submitting = useRef(false),
    navigate = useNavigate();
  if (!menu && loading) return <Loading />;
  if (!menu)
    return (
      <main className="container empty">
        <h1>Проверяем меню</h1>
        <Notice>{menuError}</Notice>
        <button className="button" onClick={refresh}>
          Обновить
        </button>
      </main>
    );
  if (lines.length === 0 && !pending)
    return (
      <main className="container empty">
        <h1>Корзина пока пуста</h1>
        <p>Выберите что-нибудь вкусное в меню.</p>
        <Link to={shopPath || '/'} className="button">
          Выбрать шаверму
        </Link>
      </main>
    );
  const accepting = menu.accepting_orders ?? !menu.settings.paused;
  const invalid = lines.some((line) => invalidLine(line, menu.products));
  const total = pending
    ? pending.payload.items.reduce((sum, l) => sum + l.expected_price * l.quantity, 0)
    : cartTotal(lines, menu.products);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !menu || (!pending && (invalid || !accepting))) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    const attempt = pending ?? {
      key: randomKey(),
      shop: menu.settings,
      store_slug: menu.store?.slug,
      item_names: lines.map(
        (line) => menu.products.find((p) => p.id === line.product_id)?.name ?? '',
      ),
      payload: {
        store_id: storeId,
        name: name.trim(),
        note: note.trim(),
        items: lines.map((line) => ({
          ...line,
          expected_price: unitPrice(
            line,
            menu.products.find((p) => p.id === line.product_id),
          ),
        })),
      },
    };
    persist(attempt, storeId);
    setPending(attempt);
    try {
      const order = await api<Order>('/orders', {
        method: 'POST',
        body: json({ ...attempt.payload, request_key: attempt.key }),
      });
      if (!order.token) throw new Error('Не удалось получить ссылку заказа. Повторите запрос.');
      saveOrder({ token: order.token, number: order.number, created_at: order.created_at });
      persist(null, storeId);
      setPending(null);
      clear();
      navigate('/track#' + order.token);
    } catch (e) {
      setError(errorMessage(e));
      // A definitive rejection is safe to edit; a lost response must reuse the exact payload.
      if (e instanceof ApiError && (e.status === 400 || e.status === 409 || e.status === 415)) {
        persist(null, storeId);
        setPending(null);
        if (e.status === 409) refresh();
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="container checkout">
      <Link to={shopPath || '/'} className="back-link">
        <ArrowLeft size={17} /> Вернуться в меню
      </Link>
      <h1>Оформление заказа</h1>
      <p className="lead">Проверьте заказ — и начнём готовить.</p>
      <div className="checkout-grid">
        <form id="checkout-form" className="checkout-form" onSubmit={submit}>
          <section className="panel checkout-section">
            <h2>
              <span className="section-number">1</span> Получение
            </h2>
            <div className="fulfilment-choice">
              <MapPin size={20} />
              <span>
                <b>Самовывоз</b>
                <small>Заберёте из нашего заведения</small>
              </span>
              <Check size={20} />
            </div>
            <ShopInfo settings={pending?.shop ?? menu.settings} compact />
            <div className="checkout-estimate">
              <Clock3 size={18} />
              <span>
                Примерно {menu.estimated_minutes ?? menu.settings.prep_minutes} мин после заказа
                <small>Точное время — на странице готовности</small>
              </span>
            </div>
          </section>
          <section className="panel checkout-section">
            <h2>
              <span className="section-number">2</span> Ваши данные
            </h2>
            <label>
              Ваше имя <span className="optional">необязательно</span>
              <input
                autoComplete="given-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                placeholder="Имя для выдачи заказа"
                disabled={busy || !!pending}
              />
            </label>
            <label>
              Комментарий к заказу <span className="optional">необязательно</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                placeholder="Что нам учесть при приготовлении?"
                rows={2}
                disabled={busy || !!pending}
              />
            </label>
            <p className="fine-print">Позовём по имени или номеру, когда заказ будет готов.</p>
          </section>
          <section className="panel checkout-section">
            <h2>
              <span className="section-number">3</span> Оплата
            </h2>
            <div className="payment">
              <span className="round-icon">
                <Banknote size={24} />
              </span>
              <div>
                <b>Оплата при получении</b>
                <p>Назовите номер заказа и оплатите на месте.</p>
              </div>
              <Check size={20} />
            </div>
          </section>
          {pending && !busy && (
            <Notice kind="warning">
              Подтверждение ещё не получено. Повторите отправку: состав и сумма сохранятся, второй
              заказ не создастся.
            </Notice>
          )}
          {error && <Notice>{error}</Notice>}
          {menuError && <Notice>Не удалось обновить меню. {menuError}</Notice>}
          {!pending && invalid && <Notice>Удалите недоступные товары или опции из корзины.</Notice>}
          {!pending && !accepting && (
            <Notice kind="warning">{menu.intake_message || menu.settings.pause_message}</Notice>
          )}
        </form>
        <aside className="panel order-summary">
          <div className="summary-heading">
            <h2>Ваш заказ</h2>
            {!pending && (
              <Link to={shopPath || '/'} className="text-link">
                Добавить ещё
              </Link>
            )}
          </div>
          {pending ? (
            <div>
              {pending.payload.items.map((line, i) => (
                <div className="receipt-line" key={i}>
                  <span>
                    {line.quantity} ×{' '}
                    {pending.item_names?.[i] ||
                      menu.products.find((p) => p.id === line.product_id)?.name ||
                      'Товар'}
                    {line.options?.length ? (
                      <small className="receipt-options">
                        {line.options
                          .map(
                            (id) =>
                              menu.products
                                .find((p) => p.id === line.product_id)
                                ?.options?.find((o) => o.id === id)?.label ?? id,
                          )
                          .join(', ')}
                      </small>
                    ) : null}
                  </span>
                  <b>{rub(line.expected_price * line.quantity)}</b>
                </div>
              ))}
            </div>
          ) : (
            <CartItems products={menu.products} accepting={accepting} busy={busy} />
          )}
          <div className="summary-costs">
            <span>Самовывоз</span>
            <b>Бесплатно</b>
          </div>
          <div className="cart-summary">
            <span>Итого</span>
            <strong>{rub(total)}</strong>
          </div>
          <div className="checkout-submit">
            <button
              className="button full"
              type="submit"
              form="checkout-form"
              disabled={busy || (!pending && (invalid || !accepting))}
            >
              {busy
                ? 'Принимаем заказ…'
                : (pending ? 'Повторить отправку · ' : 'Заказать · ') + rub(total)}
              <ArrowRight size={19} />
            </button>
            <p className="fine-print">
              Оплата на месте. После заказа покажем номер и ссылку для отслеживания.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
