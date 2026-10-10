import { test, expect, type APIRequestContext } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const password = process.env.E2E_KITCHEN_PASSWORD;
const origin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5173').origin;
test.skip(!password, 'Set E2E_KITCHEN_PASSWORD and use a test database.');
async function login(request: APIRequestContext) {
  expect(
    (
      await request.post('/api/kitchen/login', { headers: { Origin: origin }, data: { password } })
    ).ok(),
  ).toBe(true);
}
async function mutate(request: APIRequestContext, path: string, data: unknown, method = 'PUT') {
  const result = await request.fetch('/api/kitchen/' + path, {
    method,
    headers: { Origin: origin },
    data,
  });
  expect(result.ok(), await result.text()).toBe(true);
  return result.json();
}

test('lost checkout response and rate-limited retry preserve one exact order across reload', async ({
  page,
  request,
}) => {
  await login(request);
  await page.goto('/');
  await page.getByRole('button', { name: 'В корзину: Классическая' }).click();
  await page.getByRole('button', { name: 'Открыть корзину' }).click();
  await page.getByRole('button', { name: 'Оформить заказ' }).click();
  const name = 'Повтор ' + Date.now();
  await page.getByLabel('Ваше имя').fill(name);
  const payloads: string[] = [];
  let attempt = 0;
  await page.route(/\/api\/orders$/, async (route) => {
    payloads.push(route.request().postData()!);
    attempt++;
    if (attempt === 1) {
      await route.fetch();
      await route.abort('failed');
    } else if (attempt === 2)
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Слишком много попыток.' }),
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: /Заказать ·/ }).click();
  await expect(page.getByRole('button', { name: /Повторить отправку/ })).toBeVisible();
  await expect(page.getByLabel('Ваше имя')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Добавить: Классическая' })).toHaveCount(0);
  await page.getByRole('button', { name: /Повторить отправку/ }).click();
  await expect(page.getByRole('alert')).toContainText('Слишком много попыток.');
  await page.reload();
  await expect(page.getByRole('button', { name: /Повторить отправку/ })).toBeVisible();
  await page.getByRole('button', { name: /Повторить отправку/ }).click();
  await expect(page).toHaveURL(/\/track#/);
  expect(payloads).toHaveLength(3);
  expect(new Set(payloads).size).toBe(1);
  const orders = await (await request.get('/api/kitchen/orders')).json();
  const matching = orders.filter((o: { name: string }) => o.name === name);
  expect(matching).toHaveLength(1);
  expect(matching[0].items[0].quantity).toBe(1);
  await mutate(
    request,
    'orders/' + matching[0].id,
    { status: 'cancelled', cancellation_reason: 'Проверка повторной отправки' },
    'PATCH',
  );
  await expect(page.getByRole('heading', { name: 'Заказ отменён' })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText('Проверка повторной отправки', { exact: true })).toBeVisible();
});

test('customizations have independent quantities, correct totals, and historic receipts', async ({
  page,
  request,
}) => {
  await login(request);
  const menu = await (await request.get('/api/menu')).json(),
    original = menu.products[0];
  const changed = {
    ...original,
    ingredients: 'Тестовый состав',
    allergens: 'Тест: пшеница',
    options: [
      { id: 'test-cheese', label: 'Дополнительный сыр', price: 50 },
      { id: 'test-sauce', label: 'Без соуса', price: 0 },
    ],
  };
  try {
    await mutate(request, 'products/' + original.id, changed);
    await page.goto('/');
    await page.getByRole('button', { name: 'В корзину: Классическая' }).click();
    await page.getByRole('button', { name: 'Подробнее: Классическая' }).click();
    const dialog = page.getByRole('dialog', { name: 'Классическая' });
    await expect(dialog).toContainText('Тест: пшеница');
    await dialog.getByLabel('Дополнительный сыр').check();
    await dialog.getByRole('button', { name: /В корзину ·/ }).click();
    await page.getByRole('button', { name: 'Открыть корзину' }).click();
    await expect(page.locator('.cart-dialog[open] .cart-line')).toHaveCount(2);
    await expect(page.locator('.cart-dialog[open] .cart-summary')).toContainText('630');
    await page.getByRole('button', { name: 'Оформить заказ' }).click();
    await page.getByLabel('Ваше имя').fill('Опции ' + Date.now());
    await page.getByRole('button', { name: /Заказать ·/ }).click();
    await expect(page).toHaveURL(/\/track#/);
    const token = page.url().split('#')[1];
    await expect(page.locator('.receipt-line')).toHaveCount(2);
    await expect(page.getByText('Дополнительный сыр', { exact: true })).toBeVisible();
    await mutate(request, 'products/' + original.id, {
      ...changed,
      options: [{ ...changed.options[0], label: 'Новое название', price: 90 }],
    });
    const order = await (await request.get('/api/orders/' + token)).json();
    expect(order.total).toBe(630);
    expect(order.items[1].options[0].price).toBe(50);
    const kitchenOrders = await (await request.get('/api/kitchen/orders')).json();
    const staffOrder = kitchenOrders.find((o: { number: number }) => o.number === order.number);
    await mutate(
      request,
      'orders/' + staffOrder.id,
      { status: 'cancelled', cancellation_reason: 'Проверка опций' },
      'PATCH',
    );
  } finally {
    await mutate(request, 'products/' + original.id, original);
  }
});

test('schedule and pause block additions but allow removing existing items', async ({
  page,
  request,
}) => {
  await login(request);
  const original = (await (await request.get('/api/menu')).json()).settings;
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'В корзину: Классическая' }).click();
    await mutate(request, 'settings', { ...original, paused: true });
    await page.reload();
    await expect(page.locator('.intake-pill')).toContainText('Приём на паузе');
    await expect(page.getByRole('button', { name: 'Добавить: Классическая' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Уменьшить: Классическая' })).toBeEnabled();
    await page.getByRole('button', { name: 'Уменьшить: Классическая' }).click();
    await expect(page.getByRole('button', { name: 'Открыть корзину' })).toHaveCount(0);
    await mutate(request, 'settings', {
      ...original,
      paused: false,
      schedule_enabled: true,
      opening_hours: [],
    });
    await page.reload();
    await expect(page.locator('.intake-pill')).toContainText('Сейчас закрыто');
    await expect(page.getByRole('button', { name: 'В корзину: Классическая' })).toBeDisabled();
    const rejected = await request.post('/api/orders', {
      headers: { Origin: origin },
      data: {
        name: 'Closed',
        note: '',
        request_key: 'schedule-test-key-with-at-least-32-chars',
        items: [{ product_id: 1, quantity: 1, expected_price: 290 }],
      },
    });
    expect(rejected.status()).toBe(409);
  } finally {
    await mutate(request, 'settings', original);
  }
});

test('responsive storefront and keyboard-accessible dialogs', async ({ page }) => {
  await mkdir('artifacts', { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width > 720 ? 1000 : 844 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Меню', exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.locator('.product-card').first()).toBeVisible();
    await page.screenshot({ path: 'artifacts/storefront-' + width + '.png', fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Подробнее: Классическая' }).click();
  const details = page.getByRole('dialog', { name: 'Классическая' });
  await expect(details).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(details).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Подробнее: Классическая' })).toBeFocused();
  await page.getByRole('button', { name: 'В корзину: Классическая' }).click();
  await page.getByRole('button', { name: 'Открыть корзину' }).click();
  await expect(page.getByRole('dialog', { name: 'Ваш заказ' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Открыть корзину' })).toBeFocused();
  expect(errors).toEqual([]);
});

test('staff edit shop information and options; kitchen shows new and overdue orders', async ({
  page,
  request,
}) => {
  await login(request);
  const menu = await (await request.get('/api/menu')).json();
  const original = menu.products[0],
    originalSettings = menu.settings;
  let orderId: number | undefined;
  try {
    await page.goto('/kitchen');
    await page.getByLabel('Пароль', { exact: true }).fill(password!);
    await page.getByRole('button', { name: 'Войти в кухню' }).click();
    await expect(page.getByRole('heading', { name: 'Кухня', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Меню', exact: true }).click();
    await page
      .locator('.staff-product')
      .filter({ hasText: 'Классическая' })
      .getByRole('button', { name: 'Изменить' })
      .click();
    await page.getByLabel('Состав', { exact: true }).fill('Тестовый состав из панели');
    await page.getByLabel('Аллергены', { exact: true }).fill('Тестовая информация');
    await page.getByRole('button', { name: 'Добавить опцию' }).click();
    await page.getByLabel('Название опции').fill('Без соуса');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.locator('.staff-product').filter({ hasText: 'Классическая' })).toBeVisible();
    const saved = (await (await request.get('/api/menu')).json()).products[0];
    expect(saved.ingredients).toBe('Тестовый состав из панели');
    expect(saved.options[0].label).toBe('Без соуса');
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await page.getByLabel('Телефон', { exact: true }).fill('+7 000 000-00-00');
    await page.getByLabel('Ссылка на карту', { exact: true }).fill('https://example.com/test-map');
    await page.getByLabel('Принимать заказы по расписанию').check();
    await page.locator('.schedule-row').first().getByRole('checkbox').check();
    await page.getByLabel('Открытие Пн').fill('09:00');
    await page.getByLabel('Закрытие Пн').fill('23:00');
    await page.getByRole('button', { name: 'Сохранить настройки' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Настройки сохранены.' }),
    ).toBeVisible();
    const settings = (await (await request.get('/api/menu')).json()).settings;
    expect(settings.opening_hours).toEqual([{ day: 1, open: '09:00', close: '23:00' }]);
    expect(settings.phone).toBe('+7 000 000-00-00');
    await page.screenshot({ path: 'artifacts/kitchen-settings.png', fullPage: true });
    await mutate(request, 'settings', originalSettings);
    await page.getByRole('button', { name: /Заказы/ }).click();
    await expect(page.locator('.queue-refresh')).toContainText('Обновлено');
    await page.clock.setFixedTime(new Date(Date.now() + 150 * 60000));
    const created = await request.post('/api/orders', {
      headers: { Origin: origin },
      data: {
        name: 'Кухня тест',
        note: 'Проверка уведомления',
        request_key: 'kitchen-notice-test-' + Date.now() + '-unique',
        items: [{ product_id: 1, quantity: 1, expected_price: 290 }],
      },
    });
    expect(created.ok()).toBe(true);
    const customerOrder = await created.json();
    await expect(page.locator('.new-orders-notice')).toBeVisible({ timeout: 15000 });
    const card = page.locator('.kitchen-order').filter({ hasText: '№' + customerOrder.number });
    await expect(card).toHaveClass(/overdue/);
    await page.screenshot({ path: 'artifacts/kitchen-queue.png', fullPage: true });
    const orders = await (await request.get('/api/kitchen/orders')).json();
    orderId = orders.find((o: { number: number }) => o.number === customerOrder.number).id;
    await card.getByRole('button', { name: 'Отменить заказ' }).click();
    await card.getByLabel('Причина отмены').fill('Проверка панели кухни');
    await card.getByRole('button', { name: 'Подтвердить отмену' }).click();
    await expect(card).toHaveCount(0);
  } finally {
    await mutate(request, 'settings', originalSettings);
    await mutate(request, 'products/' + original.id, original);
    if (orderId) {
      const orders = await (await request.get('/api/kitchen/orders')).json();
      const order = orders.find((o: { id: number }) => o.id === orderId);
      if (order && order.status !== 'cancelled')
        await mutate(
          request,
          'orders/' + orderId,
          { status: 'cancelled', cancellation_reason: 'Завершение теста' },
          'PATCH',
        );
    }
  }
});
