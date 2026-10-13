import { test, expect } from './fixtures';
import { mkdir } from 'node:fs/promises';

// Synthetic private links only: these checks never create/read actual customer orders.
const token = (number: number) => String(number).padEnd(43, '_');
const createdAt = (number: number) => `2026-10-${String(number - 100).padStart(2, '0')}T08:00:00Z`;
const receipt = (number: number) => ({
  number,
  created_at: createdAt(number),
  updated_at: createdAt(number),
  estimated_ready_at: createdAt(number),
  status: 'completed',
  total: 290,
  items: [{ product_id: 1, name: 'Классическая', price: 290, quantity: 1 }],
});

test('legacy order 101 recovers its number and all eight saved orders stay visible', async ({
  page,
}) => {
  let recoveries = 0;
  await page.route('**/api/orders/*', async (route) => {
    recoveries++;
    const number = Number(new URL(route.request().url()).pathname.split('/').pop()?.slice(0, 3));
    await route.fulfill({ json: receipt(number) });
  });
  await page.addInitScript(
    ({ legacy, orders }) => {
      if (localStorage.getItem('history-test-seeded')) return;
      localStorage.setItem('history-test-seeded', 'yes');
      localStorage.setItem('shawarma-last-order', legacy);
      localStorage.setItem('shawarma-orders', JSON.stringify(orders));
    },
    {
      legacy: token(101),
      orders: Array.from({ length: 7 }, (_, i) => ({
        token: token(102 + i),
        number: 102 + i,
        created_at: createdAt(102 + i),
      })),
    },
  );
  await page.goto('/');
  await expect(page.locator('.saved-order')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Мои заказы/ })).toContainText('8');
  expect(recoveries).toBe(0);
  await page.getByRole('link', { name: /^Мои заказы/ }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByRole('heading', { name: 'Мои заказы', exact: true })).toBeVisible();
  const links = page.locator('.saved-order-list .saved-order');
  await expect(links).toHaveCount(8);
  await expect(links.last()).toContainText('Заказ №101');
  await expect(links.first()).toContainText('Заказ №108');
  await expect(page.getByText('Последний заказ', { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const history = JSON.parse(localStorage.getItem('shawarma-orders') ?? '[]');
      return history.map((order: { number: number }) => order.number);
    }),
  ).toEqual([108, 107, 106, 105, 104, 103, 102, 101]);
  // Vite StrictMode may abort and repeat the initial recovery request.
  // A complete, persisted history must not trigger another recovery on reload.
  const initialRecoveries = recoveries;
  expect(initialRecoveries).toBeGreaterThanOrEqual(1);
  await page.reload();
  await expect(links.last()).toContainText('Заказ №101');
  expect(recoveries).toBe(initialRecoveries);
  await links.last().click();
  await expect(page.getByRole('heading', { name: 'ЗАКАЗ №101', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Все мои заказы', exact: true }).click();
  await expect(links).toHaveCount(8);
  await expect(links.first()).toContainText('Заказ №108');
  await expect(links.last()).toContainText('Заказ №101');
  await mkdir('artifacts', { recursive: true });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `artifacts/orders-${width}.png`, fullPage: true });
  }
  await page.getByRole('link', { name: 'Вернуться в меню', exact: true }).click();
  await expect(page).toHaveURL(/\/s\/belorusskaya-4$/);
  await expect(page.locator('.saved-order')).toHaveCount(0);
});

test('opening a personal link saves its number and switching links never copies old metadata', async ({
  page,
}) => {
  let release!: () => void;
  const nextResponse = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/orders/*', async (route) => {
    const number = Number(new URL(route.request().url()).pathname.split('/').pop()?.slice(0, 3));
    if (number === 102) await nextResponse;
    await route.fulfill({ json: receipt(number) });
  });
  await page.goto('/track#' + token(101));
  await expect(page.getByRole('heading', { name: 'ЗАКАЗ №101', exact: true })).toBeVisible();
  const pending = page.waitForRequest('**/api/orders/' + token(102));
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, token(102));
  await pending;
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('shawarma-orders') ?? '[]').length),
  ).toBe(1);
  release();
  await expect(page.getByRole('heading', { name: 'ЗАКАЗ №102', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Все мои заказы', exact: true }).click();
  await expect(page.locator('.saved-order')).toHaveCount(2);
  await expect(page.locator('.saved-order').first()).toContainText('Заказ №102');
  await expect(page.locator('.saved-order').last()).toContainText('Заказ №101');
});

test('an unavailable legacy order keeps its personal link with an honest fallback label', async ({
  page,
}) => {
  await page.route('**/api/orders/*', (route) =>
    route.fulfill({
      status: 404,
      json: { error: 'Заказ не найден' },
    }),
  );
  await page.addInitScript(
    (legacy) => localStorage.setItem('shawarma-last-order', legacy),
    token(101),
  );
  await page.goto('/orders');
  const link = page.locator('.saved-order');
  await expect(link).toContainText('Заказ по личной ссылке');
  await expect(link).toHaveAttribute('href', '/track#' + token(101));
  expect(await page.evaluate(() => localStorage.getItem('shawarma-last-order') !== null)).toBe(
    true,
  );
});

test('empty history has a menu action, a direct URL, and redirects old history anchors', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Мои заказы', exact: true }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page).toHaveTitle(/Мои заказы/);
  await expect(page.getByRole('heading', { name: 'Пока нет заказов' })).toBeVisible();
  await page.getByRole('link', { name: 'Перейти в меню', exact: true }).click();
  await expect(page).toHaveURL(/\/s\/belorusskaya-4$/);
  await page.goto('/orders');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Пока нет заказов' })).toBeVisible();
  await page.goto('/#orders');
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByRole('heading', { name: 'Мои заказы', exact: true })).toBeVisible();
});

test('eighty saved orders only add a count on the home screen and remain accessible on their page', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const orders = Array.from({ length: 80 }, (_, i) => ({
      token: String(101 + i).padEnd(43, '_'),
      number: 101 + i,
      created_at: new Date(Date.UTC(2026, 9, 1, i)).toISOString(),
    }));
    localStorage.setItem('shawarma-orders', JSON.stringify(orders));
  });
  await page.goto('/');
  const shortcut = page.getByRole('link', { name: /^Мои заказы/ });
  await expect(shortcut).toContainText('80');
  await expect(page.locator('.saved-order')).toHaveCount(0);
  await shortcut.click();
  await expect(page.locator('.saved-order')).toHaveCount(80);
  await expect(page.locator('.saved-order').first()).toContainText('Заказ №180');
  await expect(page.locator('.saved-order').last()).toContainText('Заказ №101');
});
