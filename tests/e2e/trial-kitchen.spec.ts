import { test, expect } from './fixtures';
import { mkdir } from 'node:fs/promises';
const origin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5173').origin;

test('owner approves shared devices, tablets retain access and rotation revokes every device', async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(90000);
  const stamp = Date.now();
  const username = 'trial-kitchen-' + stamp;
  const label = 'Планшет · ' + stamp;
  const write = async (path: string, data: unknown, method = 'POST') => {
    const r = await request.fetch('/api' + path, { method, headers: { Origin: origin }, data });
    expect(r.ok(), path).toBe(true);
    return r.json();
  };
  await write('/auth/reauthenticate', { password: process.env.E2E_KITCHEN_PASSWORD });
  const shared = await write(
    '/owner/stores/1/kitchen-access',
    { username, active: true, rotate_password: true },
    'PUT',
  );
  const second = await browser.newContext({ baseURL: origin });
  try {
    await page.goto('/kitchen');
    await page.getByLabel('Логин', { exact: true }).fill(username);
    await page.getByLabel('Название устройства').fill(label);
    await page.getByLabel('Пароль', { exact: true }).fill(shared.password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Подтвердите устройство' })).toBeVisible();
    expect((await page.request.get('/api/staff/stores/1/orders')).status()).toBe(401);
    const devices = await (await request.get('/api/owner/kitchen-access')).json();
    const pending = devices.devices.find((d: any) => d.label === label);
    await expect(page.locator('.pairing-code')).toHaveText(pending.pairing_code);
    await write('/owner/kitchen-devices/' + pending.id, { action: 'approve' });
    await expect(page.getByRole('heading', { name: 'Кухня', exact: true })).toBeVisible({
      timeout: 12000,
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Кухня', exact: true })).toBeVisible();
    expect((await page.request.get('/api/staff/stores/1/analytics')).status()).toBe(403);
    expect(
      (
        await page.request.patch('/api/staff/stores/1/products/1/availability', {
          headers: { Origin: origin },
          data: { available: true, price: 1 },
        })
      ).status(),
    ).toBe(400);
    const now = new Date().toISOString();
    const sampleQueue = Array.from({ length: 21 }, (_, index) => ({
      id: 80000 + index,
      number: 80000 + index,
      store_id: 1,
      status: index < 18 ? 'new' : index < 20 ? 'preparing' : 'ready',
      name: '',
      note: '',
      total: 320,
      items: [
        {
          product_id: 1,
          name: 'Тестовая шаверма',
          quantity: 2,
          price: 160,
          options: [{ id: 'trial-extra', label: 'Тестовая добавка', portion: '20 г', price: 20 }],
        },
      ],
      created_at: now,
      updated_at: now,
      estimated_ready_at: new Date(Date.now() + 900000).toISOString(),
    }));
    await page.route('**/api/staff/stores/1/orders', (route) =>
      route.fulfill({ json: sampleQueue }),
    );
    await page.getByRole('button', { name: 'Обновить кухню', exact: true }).click();
    await expect(page.locator('.kitchen-order').first()).toContainText('80000');
    await mkdir('artifacts/trial', { recursive: true });
    for (const width of [320, 390, 800, 1024, 1100, 1280, 1440]) {
      await page.setViewportSize({ width, height: width >= 800 ? 800 : 844 });
      await page.evaluate(() => scrollTo(0, 0));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width >= 800)
        await expect(page.locator('.kitchen-lane')).toHaveCount(width >= 1100 ? 3 : 2);
      await page.screenshot({ path: `artifacts/trial/kitchen-${width}.png`, fullPage: false });
    }
    const newLane = page.locator('.kitchen-lane-new .kitchen-lane-list');
    await newLane.evaluate((e) => {
      e.scrollTop = 180;
    });
    await page.getByRole('button', { name: 'Обновить кухню', exact: true }).click();
    await expect.poll(() => newLane.evaluate((e) => e.scrollTop)).toBeGreaterThan(150);
    await page.unroute('**/api/staff/stores/1/orders');
    const enrollment = await second.request.post('/api/auth/login', {
      headers: { Origin: origin },
      data: { username, password: shared.password, device_label: label + ' · 2' },
    });
    expect(enrollment.status()).toBe(202);
    const access = await (await request.get('/api/owner/kitchen-access')).json();
    const other = access.devices.find((d: any) => d.label === label + ' · 2');
    await write('/owner/kitchen-devices/' + other.id, { action: 'approve' });
    expect(
      (
        await second.request.post('/api/auth/device-session', {
          headers: { Origin: origin },
          data: {},
        })
      ).status(),
    ).toBe(200);
    expect((await second.request.get('/api/staff/stores/1/orders')).status()).toBe(200);
    expect((await page.request.get('/api/staff/stores/1/orders')).status()).toBe(200);
    const narrow = await (
      await second.request.post('/api/kitchen-device/native-token', {
        headers: { Origin: origin },
        data: {},
      })
    ).json();
    // An alert credential without the staff cookie cannot read full order data.
    const raw = await browser.newContext({ baseURL: origin });
    try {
      expect(
        (
          await raw.request.get('/api/staff/stores/1/orders', {
            headers: { Authorization: 'Bearer ' + narrow.token },
          })
        ).status(),
      ).toBe(401);
      expect(
        (
          await raw.request.get('/api/kitchen-device/alerts', {
            headers: { Authorization: 'Bearer ' + narrow.token },
          })
        ).status(),
      ).toBe(200);
      await write(
        '/owner/stores/1/kitchen-access',
        { username, active: true, rotate_password: true },
        'PUT',
      );
      expect(
        (
          await raw.request.get('/api/kitchen-device/alerts', {
            headers: { Authorization: 'Bearer ' + narrow.token },
          })
        ).status(),
      ).toBe(401);
    } finally {
      await raw.close();
    }
    expect(
      (
        await second.request.post('/api/auth/refresh', { headers: { Origin: origin }, data: {} })
      ).status(),
    ).toBe(401);
    await page.getByRole('button', { name: 'Обновить кухню', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  } finally {
    await write('/owner/stores/1/kitchen-access', { username, active: false }, 'PUT');
    await second.close();
  }
});

test('canonical topping editor exposes both offers and the customer sees price, portion and availability', async ({
  page,
  request,
  browser,
}) => {
  const name = 'Соус для проверки ' + Date.now();
  const dishName = 'Блюдо для проверки ' + Date.now();
  const dishResponse = await request.post('/api/staff/stores/1/products', {
    headers: { Origin: origin },
    data: {
      name: dishName,
      description: '',
      price: 300,
      image: '/images/classic.jpg',
      weight: '',
      category: 'Тест',
      available: true,
      sort_order: 999,
      ingredients: '',
      allergens: '',
      options: [],
    },
  });
  expect(dishResponse.ok()).toBe(true);
  const dish = await dishResponse.json();
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto('/staff/stores/1');
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await page.getByRole('button', { name: 'Новая добавка', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Новая добавка', exact: true });
  await editor.getByLabel('Название', { exact: true }).fill(name);
  await editor.getByLabel('Фото', { exact: true }).fill('/images/classic.jpg');
  await editor.getByLabel('Цена в блюдо, ₽').fill('20');
  await editor.getByLabel('Порция в блюдо', { exact: true }).fill('20 г');
  await editor.getByLabel('Цена отдельно, ₽').fill('50');
  await editor.getByLabel('Порция отдельно', { exact: true }).fill('40 г');
  await editor.getByLabel('Доступна в обоих вариантах').check();
  await editor.getByLabel(dishName, { exact: true }).check();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate((w) => document.documentElement.scrollWidth <= w, width)).toBe(true);
    await page.screenshot({ path: `artifacts/trial/topping-editor-${width}.png`, fullPage: false });
  }
  await editor.getByRole('button', { name: 'Сохранить добавку', exact: true }).click();
  await expect(editor).not.toBeVisible();
  const top = (await (await request.get('/api/staff/stores/1/toppings')).json()).find(
    (t: any) => t.name === name,
  );
  const customer = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
  });
  try {
    const menu = await (await request.get('/api/menu')).json();
    const guest = await customer.newPage();
    await guest.goto('/s/' + menu.store.slug + '?brand_preview=olive');
    await guest.getByRole('button', { name: 'Подробнее: ' + dishName, exact: true }).click();
    const detail = guest.getByRole('dialog', { name: dishName, exact: true });
    await detail.getByRole('checkbox', { name: new RegExp(name) }).check();
    await detail.getByRole('button', { name: 'Добавить: Количество товара' }).click();
    await expect(detail.getByRole('button', { name: /В корзину ·/ })).toContainText('640');
    await expect(detail).toContainText('20 г');
    await guest.screenshot({ path: 'artifacts/trial/brand-product-390.png', fullPage: false });
    await request.patch('/api/staff/stores/1/toppings/' + top.id + '/availability', {
      headers: { Origin: origin },
      data: { available: false },
    });
    await guest.reload();
    await guest.getByRole('button', { name: 'Подробнее: ' + dishName, exact: true }).click();
    await expect(guest.getByRole('checkbox', { name: new RegExp(name) })).toBeDisabled();
    const current = await (await request.get('/api/menu')).json();
    expect(current.products.find((p: any) => p.id === top.standalone_product_id).available).toBe(
      false,
    );
  } finally {
    await customer.close();
    await request.delete('/api/staff/stores/1/products/' + top.standalone_product_id, {
      headers: { Origin: origin },
    });
    await request.delete('/api/staff/stores/1/products/' + dish.id, {
      headers: { Origin: origin },
    });
  }
});
