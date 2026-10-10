import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Clock3, Plus, X, MapPin, ShoppingBag, Search } from 'lucide-react';
import { cartCount, cartTotal, invalidLine, lineKey, MAX_ITEMS, unitPrice, useCart } from '../cart';
import { useMenu } from '../menu';
import { CartItems, FoodImage, Loading, Notice, Quantity, ShopInfo } from '../ui';
import { useSavedOrders } from '../useSavedOrders';
import { rub, type Product } from '../types';

export function Shop() {
  const orders = useSavedOrders();
  const { data: menu, error, loading, refresh } = useMenu();
  const { lines, setQuantity } = useCart();
  const navigate = useNavigate(),
    location = useLocation();
  const dialog = useRef<HTMLDialogElement>(null),
    details = useRef<HTMLDialogElement>(null);
  const [category, setCategory] = useState('Все'),
    [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Product | null>(null),
    [options, setOptions] = useState<string[]>([]);
  const [detailCount, setDetailCount] = useState(1),
    [feedback, setFeedback] = useState('');
  useEffect(() => {
    if (menu && ['#menu', '#orders'].includes(location.hash))
      document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  }, [menu !== null, location.hash]);
  useEffect(() => {
    if (!feedback) return;
    const id = setTimeout(() => setFeedback(''), 2500);
    return () => clearTimeout(id);
  }, [feedback]);
  if (!menu && loading) return <Loading />;
  if (!menu)
    return (
      <main className="container empty">
        <h1>Меню пока недоступно</h1>
        <Notice>{error}</Notice>
        <button className="button" onClick={refresh}>
          Попробовать снова
        </button>
      </main>
    );
  const accepting = menu.accepting_orders ?? !menu.settings.paused;
  const count = cartCount(lines),
    remaining = MAX_ITEMS - count,
    total = cartTotal(lines, menu.products);
  const invalid = lines.some((line) => invalidLine(line, menu.products));
  const categories = ['Все', ...new Set(menu.products.map((p) => p.category))];
  const bannerProduct = menu.products.find((p) => p.category === 'Шаверма') ?? menu.products[0];
  const chosenCategory = categories.includes(category) ? category : 'Все';
  const products = menu.products.filter(
    (p) =>
      (chosenCategory === 'Все' || p.category === chosenCategory) &&
      (p.name + ' ' + p.description)
        .toLocaleLowerCase('ru')
        .includes(query.toLocaleLowerCase('ru')),
  );
  const detailProduct = menu.products.find((p) => p.id === selected?.id);
  const detailLine = detailProduct ? { product_id: detailProduct.id, quantity: 1, options } : null;
  const detailQty = detailLine
    ? (lines.find((l) => lineKey(l) === lineKey(detailLine))?.quantity ?? 0)
    : 0;
  const capacity = Math.min(20 - detailQty, remaining);
  const invalidOptions = options.some((id) => !detailProduct?.options?.some((o) => o.id === id));
  function showDetails(product: Product) {
    setSelected(product);
    setOptions([]);
    setDetailCount(1);
    details.current?.showModal();
  }
  function add(product: Product, selectedOptions: string[] = [], quantity = 1) {
    const line = { product_id: product.id, quantity: 1, options: selectedOptions };
    const current = lines.find((l) => lineKey(l) === lineKey(line))?.quantity ?? 0;
    setQuantity(product.id, current + quantity, selectedOptions);
    setFeedback(product.name + ' — в корзине');
  }
  function checkout() {
    dialog.current?.close();
    navigate('/checkout');
  }
  function cartContent() {
    return count === 0 ? (
      <div className="basket-empty">
        <ShoppingBag size={36} strokeWidth={1.4} />
        <h3>Здесь будет ваш заказ</h3>
        <p>Выберите шаверму и добавьте то, что любите.</p>
      </div>
    ) : (
      <>
        <div className="basket-pickup">
          <MapPin size={17} />
          <span>
            Самовывоз <b>{menu!.settings.address || 'Из нашего заведения'}</b>
          </span>
        </div>
        <CartItems products={menu!.products} accepting={accepting} />
        <div className="cart-summary">
          <span>Итого</span>
          <strong>{rub(total)}</strong>
        </div>
        {invalid && <Notice>Удалите недоступные позиции, чтобы продолжить.</Notice>}
        {!accepting && (
          <Notice kind="warning">{menu!.intake_message || menu!.settings.pause_message}</Notice>
        )}
        <button className="button full" disabled={invalid || !accepting} onClick={checkout}>
          Оформить заказ <ArrowRight size={18} />
        </button>
        <p className="fine-print">Оплата при получении</p>
      </>
    );
  }
  return (
    <>
      <main className="container shop">
        {error && <Notice>Не удалось обновить меню. {error}</Notice>}
        <section className="restaurant-heading" aria-labelledby="shop-title">
          <div>
            <span className="restaurant-type">Шаверма · Самовывоз</span>
            <h1 id="shop-title">{menu.settings.shop_name || 'Я люблю шаверму'}</h1>
            <div className="restaurant-meta">
              <a href="#shop-info">
                <MapPin size={16} />
                {menu.settings.address || 'Где забрать'}
              </a>
              <span>
                <Clock3 size={16} />
                {menu.estimated_minutes ?? menu.settings.prep_minutes} мин · приготовление
              </span>
              <span className={'intake-pill ' + (!accepting ? 'paused' : '')}>
                <i className="status-dot" />
                {accepting
                  ? 'Принимаем заказы'
                  : menu.settings.paused
                    ? 'Приём на паузе'
                    : 'Сейчас закрыто'}
              </span>
            </div>
          </div>
          {orders.length > 0 && (
            <a className="recent-link" href="#orders">
              Мои заказы <span>{orders.length}</span>
              <ArrowRight size={16} />
            </a>
          )}
        </section>
        <div className="store-layout">
          <div className="catalog">
            <section className="pickup-banner">
              <div>
                <span>ЗАКАЗ С СОБОЙ</span>
                <h2>Шаверма, как вы любите</h2>
                <p>Закажите заранее. Заберите в часы работы.</p>
              </div>
              {bannerProduct && (
                <div className="banner-image">
                  <FoodImage src={bannerProduct.image} alt={bannerProduct.name} eager />
                </div>
              )}
            </section>
            {!accepting && (
              <Notice kind="warning">{menu.intake_message || menu.settings.pause_message}</Notice>
            )}
            <section id="menu" className="menu-section">
              <div className="section-top">
                <h2>Меню</h2>
                <span className="section-note">
                  {menu.products.length}{' '}
                  {menu.products.length !== 11 && menu.products.length % 10 === 1
                    ? 'айтем'
                    : menu.products.length % 10 < 5
                      ? 'айтема'
                      : 'айтемов'}
                </span>
              </div>
              <div className="menu-controls">
                <div className="filters" aria-label="Категории">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      aria-pressed={chosenCategory === cat}
                      className={chosenCategory === cat ? 'selected' : ''}
                      onClick={() => setCategory(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                {menu.products.length > 6 && (
                  <label className="menu-search">
                    <Search size={18} />
                    <span className="sr-only">Поиск по меню</span>
                    <input
                      type="search"
                      placeholder="Найти в меню"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                )}
              </div>
              {remaining === 0 && (
                <Notice kind="warning">
                  В корзине максимум — 50 товаров. Уменьшите количество, чтобы добавить другие.
                </Notice>
              )}
              {products.length === 0 && (
                <div className="panel empty">
                  <h3>Ничего не нашлось</h3>
                  <p>Попробуйте другую категорию или название.</p>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setCategory('Все');
                      setQuery('');
                    }}
                  >
                    Показать всё меню
                  </button>
                </div>
              )}
              <div className="product-grid">
                {products.map((p) => {
                  const qty =
                    lines.find((l) => l.product_id === p.id && !l.options?.length)?.quantity ?? 0;
                  return (
                    <article
                      className={'product-card ' + (!p.available ? 'unavailable' : '')}
                      key={p.id}
                    >
                      <button
                        className="product-photo"
                        aria-label={'Подробнее: ' + p.name}
                        onClick={() => showDetails(p)}
                      >
                        <FoodImage src={p.image} alt={p.name} />
                        {!p.available && <span className="product-badge">Временно нет</span>}
                      </button>
                      <div className="product-info">
                        <button
                          className="product-name"
                          onClick={() => showDetails(p)}
                          aria-label={'Открыть товар: ' + p.name}
                        >
                          <h3>{p.name}</h3>
                        </button>
                        <span className="product-weight">{p.weight || p.category}</span>
                        <p>{p.description}</p>
                        <div className="product-bottom">
                          {qty > 0 ? (
                            <>
                              <strong>{rub(p.price)}</strong>
                              <Quantity
                                value={qty}
                                canIncrease={p.available && accepting}
                                max={Math.min(20, qty + remaining)}
                                name={p.name}
                                onChange={(n) => setQuantity(p.id, n)}
                              />
                            </>
                          ) : (
                            <button
                              className="add-button"
                              aria-label={'В корзину: ' + p.name}
                              disabled={
                                !p.available || !accepting || remaining === 0 || lines.length >= 30
                              }
                              onClick={() => add(p)}
                            >
                              <span>{rub(p.price)}</span>
                              <Plus size={19} />
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
            <section id="shop-info" className="panel pickup-section">
              <div className="section-top">
                <h2>Где забрать</h2>
                <span className="section-note">Самовывоз</span>
              </div>
              <ShopInfo settings={menu.settings} />
              <p className="fine-print">
                Назовите номер заказа и оплатите на месте. Сообщим о готовности на странице заказа.
              </p>
            </section>
            {orders.length > 0 && (
              <section id="orders" className="saved-orders">
                <h2>Мои заказы</h2>
                <p className="fine-print">Заказы, сохранённые в этом браузере.</p>
                <div>
                  {orders.map((order) => (
                    <Link key={order.token} className="saved-order" to={'/track#' + order.token}>
                      <span>
                        <b>{order.number ? 'Заказ №' + order.number : 'Заказ по личной ссылке'}</b>
                        <small>
                          {order.created_at && !Number.isNaN(Date.parse(order.created_at))
                            ? new Date(order.created_at).toLocaleDateString('ru-RU', {
                                timeZone: 'Europe/Moscow',
                                day: 'numeric',
                                month: 'long',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : 'Открыть заказ'}
                        </small>
                      </span>
                      <ArrowRight size={18} />
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
          <aside className="panel desktop-basket">
            <h2>Ваш заказ{count > 0 && <span className="basket-counter">{count}</span>}</h2>
            {cartContent()}
          </aside>
        </div>
      </main>
      <div className="sr-only" role="status" aria-live="polite">
        {feedback}
      </div>
      {count > 0 && (
        <button
          className="cart-bar"
          aria-label="Открыть корзину"
          onClick={() => dialog.current?.showModal()}
        >
          <ShoppingBag size={21} />
          <span>
            Корзина <small>{count} шт.</small>
          </span>
          <strong>{rub(total)}</strong>
          <ArrowRight size={19} />
        </button>
      )}
      <dialog
        ref={dialog}
        className="cart-dialog"
        aria-labelledby="cart-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            const r = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX < r.left ||
              e.clientX > r.right ||
              e.clientY < r.top ||
              e.clientY > r.bottom
            )
              e.currentTarget.close();
          }
        }}
      >
        <div className="dialog-header">
          <h2 id="cart-title">Ваш заказ</h2>
          <button
            className="icon-button"
            aria-label="Закрыть корзину"
            onClick={() => dialog.current?.close()}
          >
            <X />
          </button>
        </div>
        {cartContent()}
      </dialog>
      <dialog
        ref={details}
        className="product-dialog"
        aria-labelledby="product-detail-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            const r = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX < r.left ||
              e.clientX > r.right ||
              e.clientY < r.top ||
              e.clientY > r.bottom
            )
              e.currentTarget.close();
          }
        }}
      >
        <button
          className="icon-button product-close"
          aria-label="Закрыть товар"
          onClick={() => details.current?.close()}
        >
          <X />
        </button>
        {detailProduct ? (
          <div className="product-detail-layout">
            <div className="product-detail-image">
              <FoodImage src={detailProduct.image} alt={detailProduct.name} />
            </div>
            <div className="product-detail-content">
              <div className="product-detail-scroll">
                <span className="product-weight">
                  {detailProduct.weight || detailProduct.category}
                </span>
                <h2 id="product-detail-title">{detailProduct.name}</h2>
                <p className="detail-description">{detailProduct.description}</p>
                {!!detailProduct.options?.length && (
                  <fieldset className="product-options">
                    <legend>Добавить или изменить</legend>
                    {detailProduct.options.map((o) => (
                      <label key={o.id} className={options.includes(o.id) ? 'option-selected' : ''}>
                        <input
                          type="checkbox"
                          checked={options.includes(o.id)}
                          onChange={(e) => {
                            setOptions(
                              e.target.checked
                                ? [...options, o.id]
                                : options.filter((id) => id !== o.id),
                            );
                            setDetailCount(1);
                          }}
                        />
                        <span>{o.label}</span>
                        <b>{o.price ? '+' + rub(o.price) : '0 ₽'}</b>
                      </label>
                    ))}
                  </fieldset>
                )}
                <details className="composition">
                  <summary>Состав и аллергены</summary>
                  <p>
                    <b>Состав:</b>{' '}
                    {detailProduct.ingredients || 'Уточните у сотрудников перед заказом.'}
                  </p>
                  <p>
                    <b>Аллергены:</b>{' '}
                    {detailProduct.allergens || 'Уточните у сотрудников перед заказом.'}
                  </p>
                </details>
                {invalidOptions && <Notice>Опции изменились. Выберите их заново.</Notice>}
                {!accepting && (
                  <Notice kind="warning">
                    {menu.intake_message || menu.settings.pause_message}
                  </Notice>
                )}
              </div>
              <div className="product-detail-footer">
                <Quantity
                  value={detailCount}
                  min={1}
                  max={Math.max(1, capacity)}
                  name="Количество товара"
                  canIncrease={accepting && detailProduct.available}
                  onChange={setDetailCount}
                />
                <button
                  className="button"
                  disabled={
                    !detailProduct.available ||
                    !accepting ||
                    capacity < detailCount ||
                    invalidOptions ||
                    (lines.length >= 30 && detailQty === 0)
                  }
                  onClick={() => {
                    add(detailProduct, options, detailCount);
                    details.current?.close();
                  }}
                >
                  {!detailProduct.available
                    ? 'Временно нет'
                    : 'В корзину · ' + rub(unitPrice(detailLine!, detailProduct) * detailCount)}
                  <Plus size={18} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="panel">
            <h2 id="product-detail-title">Товар недоступен</h2>
            <Notice>Товар больше недоступен.</Notice>
          </div>
        )}
      </dialog>
    </>
  );
}
