import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AppErrorBoundary, RecoveryScreen, RouteErrorBoundary } from './ErrorBoundary';
import { readAttempt } from './checkoutAttempt';

function BrokenScreen(): never {
  throw new Error('Missing staff authentication; internal-fixture-detail');
}
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
it('catches staff render errors without exposing exception details or losing the recovery route', () => {
  const router = createMemoryRouter(
    [
      {
        errorElement: <RouteErrorBoundary />,
        children: [{ path: '/owner', element: <BrokenScreen /> }],
      },
    ],
    { initialEntries: ['/owner'] },
  );
  render(<RouterProvider router={router} />);
  expect(screen.getByRole('heading', { name: 'Не удалось открыть страницу' })).toHaveFocus();
  expect(screen.getByRole('link', { name: 'Открыть панель' })).toHaveAttribute('href', '/kitchen');
  expect(document.body.textContent).not.toContain('Missing staff authentication');
  expect(document.body.textContent).not.toContain('internal-fixture-detail');
  expect(document.body.textContent).not.toContain('Hey developer');
});
it('keeps pending checkout and browser history intact when checkout crashes', () => {
  const attempt = {
    key: 'a'.repeat(48),
    payload: {
      store_id: 1,
      name: '',
      note: '',
      items: [{ product_id: 1, quantity: 1, expected_price: 300 }],
    },
  };
  sessionStorage.setItem('shawarma-attempt-v3:1', JSON.stringify(attempt));
  localStorage.setItem('shawarma-orders', 'saved-history-fixture');
  const router = createMemoryRouter(
    [
      {
        errorElement: <RouteErrorBoundary />,
        children: [{ path: '/s/example/checkout', element: <BrokenScreen /> }],
      },
    ],
    { initialEntries: ['/s/example/checkout'] },
  );
  render(<RouterProvider router={router} />);
  expect(screen.getByText(/сначала проверьте «Мои заказы»/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Мои заказы' })).toHaveAttribute('href', '/orders');
  expect(readAttempt(1)).toEqual(attempt);
  expect(localStorage.getItem('shawarma-orders')).toBe('saved-history-fixture');
});
it('provides an independent fallback even outside the router and staff providers', () => {
  render(
    <AppErrorBoundary>
      <BrokenScreen />
    </AppErrorBoundary>,
  );
  expect(screen.getByRole('button', { name: 'Обновить страницу' })).toBeVisible();
  expect(document.querySelector('pre')).toBeNull();
});
it('uses safe not-found and access messages without displaying server response data', async () => {
  const router = createMemoryRouter(
    [
      {
        path: '/owner',
        loader: () => {
          throw new Response('internal-fixture-detail', { status: 403 });
        },
        element: <div />,
        hydrateFallbackElement: <p>Загрузка</p>,
        errorElement: <RouteErrorBoundary />,
      },
    ],
    { initialEntries: ['/owner'] },
  );
  render(<RouterProvider router={router} />);
  expect(await screen.findByRole('heading', { name: 'Не удалось открыть доступ' })).toBeVisible();
  expect(document.body.textContent).not.toContain('internal-fixture-detail');
});
it('explains private-link recovery and keeps 404 navigation clear', () => {
  const view = render(<RecoveryScreen pathname="/track" />);
  expect(screen.getByText(/Личная ссылка останется в адресной строке/)).toBeVisible();
  view.rerender(<RecoveryScreen pathname="/missing" status={404} />);
  expect(screen.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Обновить страницу' })).toBeNull();
});
