import { useEffect, type ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import {
  ArrowUpRight,
  MapPin,
  Minus,
  Plus,
  ShoppingBag,
  Flame,
  Trash2,
  Phone,
  Clock3,
} from 'lucide-react';
import { useMenu, useShopPath } from './menu';
import { PickupSelector } from './PickupSelector';
import {
  cartCount,
  invalidLine,
  lineKey,
  MAX_ITEMS,
  optionLabels,
  unitPrice,
  useCart,
} from './cart';
import { rub, type Product, type Settings } from './types';
export function Layout({ neutral = false }: { neutral?: boolean }) {
  const location = useLocation();
  const { data } = useMenu();
  const shopPath = useShopPath();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    document.title =
      (data?.settings.shop_name || 'Шаверма на районе') +
      (location.pathname === '/kitchen'
        ? ' · Кухня'
        : location.pathname === '/orders'
          ? ' · Мои заказы'
          : ' · Заказ с собой');
  }, [data?.settings.shop_name, location.pathname]);
  return (
    <>
      <a className="skip-link" href="#main-content">
        К содержимому
      </a>
      <header className="header">
        <div className={'header-inner' + (!neutral ? ' header-inner--pickup' : '')}>
          <Link
            to={neutral ? '/' : shopPath || '/'}
            className="brand"
            aria-label={(data?.settings.shop_name || 'Шаверма на районе') + ' — меню'}
          >
            <span className="brand-mark">
              <Flame size={25} />
            </span>
            <span>
              {data?.settings.shop_name && data.settings.shop_name !== 'Шаверма на районе' ? (
                data.settings.shop_name
              ) : (
                <>
                  шаверма<span className="brand-sub">на районе</span>
                </>
              )}
            </span>
          </Link>
          {!neutral && <PickupSelector />}
          <Link to={neutral ? '/' : shopPath + '#menu'} className="header-link">
            Меню <ShoppingBag size={16} />
          </Link>
        </div>
      </header>
      <div id="main-content">
        <Outlet />
      </div>
      <footer className="footer container">
        <Link to="/privacy">Политика обработки данных</Link>
        <Link to="/consent">Отдельное согласие</Link>
        <span>{data?.settings.shop_name || 'Шаверма на районе'} · Самовывоз</span>
        {!neutral && (
          <span>{[data?.settings.address, data?.settings.city].filter(Boolean).join(' · ')}</span>
        )}
        <Link to="/kitchen" className="staff-link">
          Вход для сотрудников <ArrowUpRight size={14} />
        </Link>
      </footer>
    </>
  );
}
const weekdays = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export function ShopInfo({ settings, compact = false }: { settings: Settings; compact?: boolean }) {
  const phone = settings.phone?.replace(/[^+\d]/g, '');
  return (
    <div className={'shop-info ' + (compact ? 'compact' : '')}>
      <div className="pickup">
        <MapPin size={20} />
        <div>
          <b>{settings.address || 'Адрес самовывоза уточняйте у сотрудников'}</b>
          <span>{settings.city} · Только самовывоз</span>
        </div>
        {settings.map_url && (
          <a
            className="text-link"
            href={settings.map_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Маршрут <ArrowUpRight size={15} />
          </a>
        )}
      </div>
      {!compact && (
        <>
          <div className="info-row">
            <Clock3 size={18} />
            <span>
              {settings.hours_note ||
                (settings.schedule_enabled
                  ? 'Часы работы · МСК'
                  : 'Часы работы уточняйте у сотрудников')}
            </span>
          </div>
          {settings.schedule_enabled && (
            <div className="hours-list">
              {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                const hours = settings.opening_hours.find((h) => h.day === day);
                return (
                  <span key={day}>
                    <b>{weekdays[day]}</b> {hours ? hours.open + '–' + hours.close : 'Закрыто'}
                  </span>
                );
              })}
            </div>
          )}
          {phone && (
            <a className="info-row text-link" href={'tel:' + phone}>
              <Phone size={18} />
              {settings.phone}
            </a>
          )}
        </>
      )}
    </div>
  );
}
export function Quantity({
  value,
  onChange,
  name,
  disabled = false,
  canIncrease = true,
  max = 20,
  min = 0,
}: {
  value: number;
  onChange: (n: number) => void;
  name: string;
  disabled?: boolean;
  canIncrease?: boolean;
  max?: number;
  min?: number;
}) {
  return (
    <div className="quantity">
      <button
        type="button"
        disabled={disabled || value <= min}
        aria-label={'Уменьшить: ' + name}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={17} />
      </button>
      <span aria-label="Количество">{value}</span>
      <button
        type="button"
        disabled={disabled || !canIncrease || value >= max}
        aria-label={'Добавить: ' + name}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={17} />
      </button>
    </div>
  );
}
export function FoodImage({
  src,
  alt,
  eager = false,
}: {
  src: string;
  alt: string;
  eager?: boolean;
}) {
  return (
    <img
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      onError={(e) => {
        if (!e.currentTarget.src.endsWith('/images/placeholder.svg'))
          e.currentTarget.src = '/images/placeholder.svg';
      }}
    />
  );
}
export function CartItems({
  products,
  accepting,
  busy = false,
}: {
  products: Product[];
  accepting: boolean;
  busy?: boolean;
}) {
  const { lines, setQuantity } = useCart();
  const remaining = MAX_ITEMS - cartCount(lines);
  return (
    <div className="cart-lines">
      {lines.map((line) => {
        const p = products.find((p) => p.id === line.product_id),
          invalid = invalidLine(line, products);
        return (
          <div className="cart-line" key={lineKey(line)}>
            {p && <FoodImage src={p.image} alt="" />}
            <div className="cart-line-copy">
              <b>{p?.name ?? 'Товар удалён'}</b>
              {line.options?.length ? <small>{optionLabels(line, p)}</small> : null}
              <span>{p ? rub(unitPrice(line, p) * line.quantity) : 'Недоступен'}</span>
              {invalid && (
                <small className="text-error">Товар или опция недоступны — удалите позицию</small>
              )}
            </div>
            <div className="cart-line-actions">
              <Quantity
                value={line.quantity}
                disabled={busy}
                canIncrease={accepting && !invalid}
                max={Math.min(20, line.quantity + remaining)}
                onChange={(n) => setQuantity(line.product_id, n, line.options)}
                name={p?.name ?? 'Товар'}
              />
              <button
                className="remove-line"
                type="button"
                disabled={busy}
                aria-label={'Удалить: ' + (p?.name ?? 'Товар')}
                onClick={() => setQuantity(line.product_id, 0, line.options)}
              >
                <Trash2 size={14} /> Удалить
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
export function Notice({ children, kind = 'error' }: { children: ReactNode; kind?: string }) {
  return (
    <div className={'notice ' + kind} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
export function Loading() {
  return (
    <main className="container empty" role="status">
      <span className="spinner" /> Загружаем…
    </main>
  );
}
export { ShoppingBag };
