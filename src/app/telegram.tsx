import React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createBrowserRouter,
  Link,
  Outlet,
  RouterProvider,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { api, errorMessage } from '@/shared/api/client';
import { telegramApp, type TelegramConfig } from '@/features/telegram/telegram';
import { AppErrorBoundary, RouteErrorBoundary } from '@/app/ErrorBoundary';
import {
  PickupStoresProvider,
  usePickupStores,
} from '@/features/locations/PickupStoresProvider';
import { CustomerScope } from '@/app/CustomerScope';
import { StorePicker } from '@/features/locations/StorePicker';
import { Shop } from '@/features/catalog/Shop';
import { Checkout } from '@/features/checkout/Checkout';
import { Orders } from '@/features/orders/Orders';
import { Tracking } from '@/features/orders/Tracking';
import { Privacy } from '@/features/privacy/Privacy';
import { TelegramOrder } from '@/features/telegram/TelegramOrder';
import { Loading, Notice } from '@/shared/ui/Feedback';
import '@/app/styles/global.css';
import '@/features/telegram/telegram.css';

// The SDK has already parsed launch data. Do not carry its raw fragment through navigation.
if (window.location.hash.includes('tgWebApp'))
  window.history.replaceState(null, '', window.location.pathname + window.location.search);

function TelegramShell() {
  const [config, setConfig] = useState<TelegramConfig | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate(),
    location = useLocation();
  const reload = useCallback(() => {
    setError('');
    void api<TelegramConfig>('/telegram/config', { credentials: 'omit' })
      .then(setConfig)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(reload, [reload]);
  useEffect(() => {
    const app = telegramApp();
    if (!app) return;
    const safeArea = () => {
      document.documentElement.style.setProperty(
        '--tg-top',
        (app.safeAreaInset?.top ?? 0) + (app.contentSafeAreaInset?.top ?? 0) + 'px',
      );
      document.documentElement.style.setProperty(
        '--tg-bottom',
        (app.safeAreaInset?.bottom ?? 0) + (app.contentSafeAreaInset?.bottom ?? 0) + 'px',
      );
      document.documentElement.dataset.telegramTheme = app.colorScheme ?? 'light';
      app.setHeaderColor?.(app.isVersionAtLeast('6.9') ? '#ffffff' : 'bg_color');
      app.setBackgroundColor?.('#f6f6f6');
    };
    app.ready();
    app.expand();
    safeArea();
    for (const e of [
      'safeAreaChanged',
      'contentSafeAreaChanged',
      'themeChanged',
      'viewportChanged',
    ])
      app.onEvent(e, safeArea);
    return () => {
      for (const e of [
        'safeAreaChanged',
        'contentSafeAreaChanged',
        'themeChanged',
        'viewportChanged',
      ])
        app.offEvent(e, safeArea);
    };
  }, []);
  useEffect(() => {
    const app = telegramApp();
    if (!app) return;
    const back = () => {
      if (window.history.state?.idx > 0) navigate(-1);
      else navigate('/locations', { replace: true });
    };
    if (location.pathname === '/') app.BackButton.hide();
    else app.BackButton.show();
    app.BackButton.onClick(back);
    return () => app.BackButton.offClick(back);
  }, [location.pathname, navigate]);
  if (['/privacy', '/consent', '/telegram-consent'].includes(location.pathname))
    return <Outlet />;
  if (!config && !error) return <Loading />;
  if (error || !config?.ready)
    return (
      <main className="container empty">
        <h1>Заказ в Telegram</h1>
        <Notice>
          {error ||
            (!config?.ready
              ? 'Приложение Telegram ещё не подключено оператором.'
              : 'Откройте приложение через кнопку «Заказать» в Telegram.')}
        </Notice>
        <a className="button" href="/">
          Перейти на сайт
        </a>
        {error && (
          <button className="button secondary" onClick={reload}>
            Повторить
          </button>
        )}
      </main>
    );
  return (
    <>
      {!telegramApp()?.initData && (
        <p className="container pickup-message" role="status">
          Для уведомлений и доступа по кнопке бота откройте приложение заново через Telegram.
          Заказ без уведомлений и повторная отправка доступны.
        </p>
      )}
      <Outlet />
    </>
  );
}

function TelegramLanding() {
  const stores = usePickupStores(),
    navigate = useNavigate();
  const [handled, setHandled] = useState(false);
  useEffect(() => {
    if (handled || !stores.data) return;
    const start = new URLSearchParams(telegramApp()?.initData ?? '').get('start_param') ?? '';
    setHandled(true);
    if (/^r_[A-Za-z0-9_-]{43}$/.test(start)) {
      navigate('/order/' + start.slice(2), { replace: true });
      return;
    }
    if (/^s_[1-9]\d*$/.test(start)) {
      const shop = stores.data.find((s) => s.id === Number(start.slice(2)));
      navigate(shop ? '/s/' + shop.slug : '/locations', { replace: true });
    }
  }, [stores.data, handled, navigate]);
  if (!handled && stores.error)
    return (
      <main className="container empty">
        <Notice>{stores.error}</Notice>
        <button className="button" onClick={stores.refresh}>
          Повторить
        </button>
      </main>
    );
  if (!handled) return <Loading />;
  return <StorePicker />;
}

const router = createBrowserRouter(
  [
    {
      element: <TelegramShell />,
      errorElement: <RouteErrorBoundary />,
      children: [
        { path: 'privacy', element: <Privacy /> },
        { path: 'consent', element: <Privacy consent /> },
        { path: 'telegram-consent', element: <Privacy telegram /> },
        {
          element: <PickupStoresProvider />,
          children: [
            { index: true, element: <TelegramLanding /> },
            { path: 'locations', element: <StorePicker alwaysChoose /> },
            {
              path: 's/:slug',
              element: <CustomerScope />,
              children: [
                { index: true, element: <Shop /> },
                { path: 'checkout', element: <Checkout /> },
              ],
            },
            {
              element: <CustomerScope neutral />,
              children: [
                { path: 'orders', element: <Orders /> },
                { path: 'track', element: <Tracking /> },
                { path: 'order/:handle', element: <TelegramOrder /> },
              ],
            },
          ],
        },
        {
          path: '*',
          element: (
            <main className="container empty">
              <h1>Страница не найдена</h1>
              <Link to="/">Выбрать шаверму</Link>
            </main>
          ),
        },
      ],
    },
  ],
  { basename: '/tg' },
);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <RouterProvider router={router} />
    </AppErrorBoundary>
  </React.StrictMode>,
);
