import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { ArrowUpRight, ShoppingBag, Flame } from 'lucide-react';
import { useMenu, useShopPath } from '@/features/catalog/MenuProvider';
import { PickupSelector } from '@/features/locations/PickupSelector';
import { inTelegramEntry } from '@/features/telegram/telegram';

export function Layout({ neutral = false }: { neutral?: boolean }) {
  const location = useLocation();
  const [pickupChanged, setPickupChanged] = useState(false);
  useEffect(() => {
    setPickupChanged(location.state?.pickupChanged === true);
    const timer = setTimeout(() => setPickupChanged(false), 6000);
    return () => clearTimeout(timer);
  }, [location.key]);
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
          {neutral && (
            <Link className="text-link" to="/locations">
              Выбрать точку
            </Link>
          )}
          <Link to={neutral ? '/' : shopPath + '#menu'} className="header-link">
            Меню <ShoppingBag size={16} />
          </Link>
        </div>
      </header>
      <div id="main-content">
        {pickupChanged && (
          <p className="pickup-change-notice" role="status">
            Точка изменена. Корзина предыдущей точки сохранена.
          </p>
        )}
        <Outlet />
      </div>
      <footer className="footer container">
        <Link to="/privacy">Политика обработки данных</Link>
        <Link to="/consent">Отдельное согласие</Link>
        <span>{data?.settings.shop_name || 'Шаверма на районе'} · Самовывоз</span>
        {!neutral && (
          <span>
            {[data?.settings.address, data?.settings.city].filter(Boolean).join(' · ')}
          </span>
        )}
        {!inTelegramEntry() && (
          <Link to="/kitchen" className="staff-link">
            Вход для сотрудников <ArrowUpRight size={14} />
          </Link>
        )}
      </footer>
    </>
  );
}
