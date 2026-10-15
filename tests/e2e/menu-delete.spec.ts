import { test, expect } from './fixtures';
import { mkdir } from 'node:fs/promises';

const origin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5173').origin;

test('menu deletion confirms the item, retains failures and preserves purchased receipts', async ({
  page,
  request,
}) => {
  const created = await request.post('/api/staff/stores/1/products', {
    headers: { Origin: origin },
    data: {
      name: 'Товар для удаления',
      description: '',
      price: 410,
      image: '/images/classic.jpg',
      weight: '250 г',
      category: 'Тест',
      available: true,
      sort_order: 99,
      ingredients: '',
      allergens: '',
      options: [],
    },
  });
  expect(created.ok()).toBe(true);
  const product = await created.json();
  const doc = await (await request.get('/api/privacy')).json();
  const payload = {
    name: '',
    note: '',
    store_id: 1,
    request_key: crypto.randomUUID(),
    items: [{ product_id: product.id, quantity: 1, expected_price: product.price }],
    privacy: { notice_version: doc.id },
  };
  const ordered = await request.post('/api/orders', { headers: { Origin: origin }, data: payload });
  expect(ordered.ok()).toBe(true);
  const receipt = await ordered.json();
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto('/staff/stores/1');
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  const item = page
    .locator('.staff-product')
    .filter({ has: page.getByRole('heading', { name: product.name, exact: true }) });
  const remove = item.getByRole('button', { name: 'Удалить товар ' + product.name, exact: true });
  await expect(remove).toBeVisible();
  await remove.click();
  const dialog = page.getByRole('dialog', { name: 'Удалить товар?', exact: true });
  await expect(dialog).toContainText('«' + product.name + '»');
  await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();
  await expect(item).toBeVisible();
  await mkdir('artifacts/menu-delete', { recursive: true });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await remove.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `artifacts/menu-delete/menu-${width}.png` });
    await remove.click();
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `artifacts/menu-delete/confirm-${width}.png` });
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  }
  const endpoint = '**/api/staff/stores/1/products/' + product.id;
  await page.route(endpoint, (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Проверочная ошибка удаления' }),
        })
      : route.continue(),
  );
  await remove.click();
  await dialog.getByRole('button', { name: 'Удалить товар', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Проверочная ошибка удаления');
  await expect(dialog).toBeVisible();
  expect(
    (await (await request.get('/api/menu')).json()).products.some(
      (p: { id: number }) => p.id === product.id,
    ),
  ).toBe(true);
  await page.unroute(endpoint);
  await dialog.getByRole('button', { name: 'Удалить товар', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(item).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: `«${product.name}» удалён из меню.` }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ваше меню', exact: true })).toBeFocused();
  const tracked = await request.get('/api/orders/' + receipt.token);
  expect(tracked.ok()).toBe(true);
  expect((await tracked.json()).items).toEqual(receipt.items);
  const replay = await request.post('/api/orders', { headers: { Origin: origin }, data: payload });
  expect(replay.ok()).toBe(true);
  expect((await replay.json()).number).toBe(receipt.number);
  const fresh = await request.post('/api/orders', {
    headers: { Origin: origin },
    data: { ...payload, request_key: crypto.randomUUID() },
  });
  expect(fresh.status()).toBe(409);
  // Close only this fixture order; no active order is left for later scenarios.
  const closed = await request.patch('/api/staff/stores/1/orders/' + receipt.id, {
    headers: { Origin: origin },
    data: { status: 'cancelled', cancellation_reason: 'Завершение проверки удаления' },
  });
  expect(closed.ok()).toBe(true);
});
