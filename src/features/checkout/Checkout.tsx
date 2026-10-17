import { useCallback, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Banknote, Check, Clock3 } from 'lucide-react';
import { api, ApiError, errorMessage, json } from '@/shared/api/client';
import { cartTotal, invalidLine, unitPrice, useCart } from '@/features/cart/cart';
import { useMenu, useShopPath } from '@/features/catalog/MenuProvider';
import { CartItems } from '@/features/cart/CartItems';
import { Loading, Notice } from '@/shared/ui/Feedback';
import { ShopInfo } from '@/features/locations/ShopInfo';
import { randomKey } from '@/shared/lib/requestKey';
import { readAttempt, persist, type Attempt } from '@/features/checkout/checkoutAttempt';
import { saveOrder } from '@/features/orders/orderHistory';
import { rub } from '@/shared/lib/format';
import { type Order } from '@/shared/api/types';
import { usePolling } from '@/shared/hooks/usePolling';
import { type PrivacyDocument } from '@/features/privacy/types';
import {
  inTelegramEntry,
  requestTelegramMessages,
  telegramClosingConfirmation,
  telegramHeaders,
  telegramApp,
} from '@/features/telegram/telegram';

export function Checkout() {
  const { data: menu, error: menuError, loading, refresh } = useMenu();
  const { lines, clear } = useCart();
  const storeId = menu?.store?.id ?? 1;
  const shopPath = useShopPath();
  const [pending, setPending] = useState<Attempt | null>(() => readAttempt(storeId));
  const [name, setName] = useState(() => pending?.payload.name ?? '');
  const [note, setNote] = useState(() => pending?.payload.note ?? '');
  const [acceptedVersion, setAcceptedVersion] = useState<number | null>(() =>
    pending?.payload.privacy?.accepted ? pending.payload.privacy.consent_version : null,
  );
  const frozenNoticeVersion = pending?.payload.privacy?.notice_version;
  const loadPrivacy = useCallback(
    (signal: AbortSignal) =>
      api<PrivacyDocument>(
        frozenNoticeVersion ? '/privacy/versions/' + frozenNoticeVersion : '/privacy',
        { signal },
      ),
    [frozenNoticeVersion],
  );
  const {
    data: privacy,
    error: privacyError,
    refresh: refreshPrivacy,
  } = usePolling(loadPrivacy, 30000);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [telegramVersion, setTelegramVersion] = useState<number | null>(null);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [telegramNotice, setTelegramNotice] = useState('');
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
    if (
      !pending &&
      (!privacy || ((name.trim() || note.trim()) && acceptedVersion !== privacy.id))
    ) {
      setError(
        privacy
          ? 'Для имени и комментария отметьте отдельное согласие или оставьте поля пустыми.'
          : 'Не удалось загрузить документы оператора. Обновите страницу.',
      );
      return;
    }
    if (!pending && telegramVersion !== null && telegramVersion !== privacy?.id) {
      setError('Версия согласия Telegram изменилась. Подтвердите его ещё раз.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError('');
    const requestKey = pending?.key ?? randomKey();
    let telegram: { intent_id?: string } | undefined = inTelegramEntry() ? {} : undefined;
    let headers: Record<string, string> = {};
    try {
      if ((!pending && telegramVersion !== null) || pending?.payload.telegram?.intent_id)
        headers = await telegramHeaders();
      if (!pending && telegramVersion !== null)
        telegram = await api<{ intent_id: string }>('/telegram/checkout-intents', {
          method: 'POST',
          credentials: 'omit',
          headers,
          body: json({
            request_key: requestKey,
            store_id: storeId,
            consent_version: telegramVersion,
            accepted: true,
          }),
        });
    } catch (e) {
      // An accepted frozen retry must work even if Telegram launch authentication expired.
      if (!pending) {
        setError(errorMessage(e));
        submitting.current = false;
        setBusy(false);
        return;
      }
    }
    const attempt = pending ?? {
      key: requestKey,
      shop: menu.settings,
      store_slug: menu.store?.slug,
      item_names: lines.map(
        (line) => menu.products.find((p) => p.id === line.product_id)?.name ?? '',
      ),
      payload: {
        store_id: storeId,
        name: name.trim(),
        note: note.trim(),
        privacy: {
          notice_version: privacy!.id,
          consent_version: acceptedVersion === privacy!.id ? privacy!.id : 0,
          accepted: acceptedVersion === privacy!.id,
        },
        items: lines.map((line) => ({
          ...line,
          expected_price: unitPrice(
            line,
            menu.products.find((p) => p.id === line.product_id),
          ),
        })),
        ...(telegram ? { telegram } : {}),
      },
    };
    persist(attempt, storeId);
    setPending(attempt);
    try {
      const order = await api<Order>('/orders', {
        method: 'POST',
        headers,
        ...(inTelegramEntry() ? { credentials: 'omit' as const } : {}),
        body: json({ ...attempt.payload, request_key: attempt.key }),
      });
      if (!order.token) throw new Error('Не удалось получить ссылку заказа. Повторите запрос.');
      saveOrder({ token: order.token, number: order.number, created_at: order.created_at });
      persist(null, storeId);
      setPending(null);
      clear();
      telegramClosingConfirmation(false);
      navigate(
        order.telegram_handle && inTelegramEntry() && telegramApp()?.initData
          ? '/order/' + order.telegram_handle
          : '/track#' + order.token,
      );
    } catch (e) {
      setError(errorMessage(e));
      // A definitive rejection is safe to edit; a lost response must reuse the exact payload.
      if (
        e instanceof ApiError &&
        (e.status === 400 || e.status === 409 || e.status === 410 || e.status === 415)
      ) {
        persist(null, storeId);
        setPending(null);
        if (e.status === 409) {
          refresh();
          refreshPrivacy();
          setAcceptedVersion(null);
        }
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
            <p className="fine-print">
              В комментарии — только пожелания к приготовлению. Не указывайте сведения о
              здоровье, платёжные данные и данные других людей.
            </p>
            {privacy && (
              <label className="privacy-check">
                <input
                  type="checkbox"
                  checked={acceptedVersion === privacy.id}
                  onChange={(e) => setAcceptedVersion(e.target.checked ? privacy.id : null)}
                  disabled={busy || !!pending}
                />
                <span>
                  Даю отдельное{' '}
                  <Link
                    target="_blank"
                    rel="noopener noreferrer"
                    to={'/consent?version=' + privacy.id}
                  >
                    согласие на обработку имени и комментария
                  </Link>
                  . Необязательно для заказа по номеру.
                </span>
              </label>
            )}
            {privacyError && !pending && <Notice>{privacyError}</Notice>}
            <p className="fine-print">
              {privacy ? (
                <Link
                  target="_blank"
                  rel="noopener noreferrer"
                  to={'/privacy?version=' + privacy.id}
                >
                  Как обрабатываются данные заказа · версия {privacy.id}
                </Link>
              ) : (
                <Link to="/privacy">Политика обработки данных</Link>
              )}
              . Необязательные поля удаляются через 7 дней после закрытия; личная квитанция —
              через год.
            </p>
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
          {inTelegramEntry() && (
            <section className="panel checkout-section telegram-notifications">
              <h2>Уведомления о заказе</h2>
              {privacy?.telegram_consent ? (
                <>
                  <label className="privacy-check">
                    <input
                      type="checkbox"
                      checked={
                        pending
                          ? !!pending.payload.telegram?.intent_id
                          : telegramVersion === privacy.id
                      }
                      disabled={busy || permissionBusy || !!pending}
                      onChange={(e) => {
                        if (!e.target.checked) {
                          setTelegramVersion(null);
                          setTelegramNotice('');
                          return;
                        }
                        setPermissionBusy(true);
                        setTelegramNotice('');
                        void requestTelegramMessages()
                          .then((allowed) => {
                            if (allowed) setTelegramVersion(privacy.id);
                            else {
                              setTelegramVersion(null);
                              setTelegramNotice(
                                'Telegram не разрешил сообщения. Можно продолжить заказ без уведомлений.',
                              );
                            }
                          })
                          .catch(() =>
                            setTelegramNotice(
                              'Не удалось запросить разрешение. Повторите или продолжите без уведомлений.',
                            ),
                          )
                          .finally(() => setPermissionBusy(false));
                      }}
                    />
                    <span>
                      Получать уведомления об этом заказе в Telegram. Даю отдельное{' '}
                      <Link
                        to={'/telegram-consent?version=' + privacy.id}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        согласие на уведомления
                      </Link>
                      .
                    </span>
                  </label>
                  <p className="fine-print">
                    Заказ принят, готов к выдаче или отменён. Без рекламы. Доставка и звук
                    зависят от настроек Telegram и устройства. Отключить: /stop в боте или на
                    странице заказа.
                  </p>
                </>
              ) : (
                <p>Отдельное согласие Telegram ещё не опубликовано.</p>
              )}
              {permissionBusy && <p role="status">Ожидаем разрешение Telegram…</p>}
              {telegramNotice && <p role="status">{telegramNotice}</p>}
            </section>
          )}
          {pending && !busy && (
            <Notice kind="warning">
              Подтверждение ещё не получено. Повторите отправку: состав и сумма сохранятся,
              второй заказ не создастся.
            </Notice>
          )}
          {error && <Notice>{error}</Notice>}
          {menuError && <Notice>Не удалось обновить меню. {menuError}</Notice>}
          {!pending && invalid && (
            <Notice>Удалите недоступные товары или опции из корзины.</Notice>
          )}
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
              disabled={busy || permissionBusy || (!pending && (invalid || !accepting))}
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
