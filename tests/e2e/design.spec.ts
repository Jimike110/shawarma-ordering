import { test, expect } from './fixtures';
import { type APIRequestContext, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const password = process.env.E2E_KITCHEN_PASSWORD;
const origin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5173').origin;
test.skip(!password, 'Use the isolated test stack with E2E_KITCHEN_PASSWORD.');
async function write(request: APIRequestContext, path: string, data: unknown, method = 'PUT') {
  const response = await request.fetch('/api/kitchen/' + path, {
    method,
    headers: { Origin: origin },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
}
async function login(request: APIRequestContext) {
  if ((await request.get('/api/auth/me')).ok()) return;
  expect(
    (
      await request.post('/api/kitchen/login', {
        headers: { Origin: origin },
        data: { username: process.env.E2E_STAFF_USERNAME ?? 'owner', password },
      })
    ).ok(),
  ).toBe(true);
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('local Cyrillic font, product quantity builder, and checkout fit every screen', async ({
  page,
  request,
}) => {
  await login(request);
  const original = (await (await request.get('/api/menu')).json()).products[0];
  try {
    await write(request, 'products/' + original.id, {
      ...original,
      options: [{ id: 'design-extra', label: 'Дополнительный сыр', price: 50 }],
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return (await document.fonts.load('500 16px Inter', 'Шаверма ₽')).map((font) => font.status);
    });
    expect(fonts).toContain('loaded');
    await page.getByRole('button', { name: 'Подробнее: Классическая' }).click();
    const details = page.getByRole('dialog', { name: 'Классическая' });
    await details.getByLabel('Дополнительный сыр').check();
    await details.getByRole('button', { name: 'Добавить: Количество товара' }).click();
    await details.getByRole('button', { name: 'Добавить: Количество товара' }).click();
    await expect(details.getByRole('button', { name: /В корзину ·/ })).toContainText('1 020');
    await mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/product-mobile.png' });
    await details.getByRole('button', { name: /В корзину ·/ }).click();
    await page.getByRole('button', { name: 'Открыть корзину' }).click();
    await page.getByRole('button', { name: 'Оформить заказ' }).click();
    await page.getByLabel('Ваше имя').fill('Гость');
    await page.getByRole('checkbox', { name: /Даю отдельное/ }).check();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width > 720 ? 1000 : 844 });
      await fits(page);
      await page.getByRole('button', { name: /Заказать ·/ }).scrollIntoViewIfNeeded();
      await expect(page.getByRole('button', { name: /Заказать ·/ })).toBeInViewport();
      await page.screenshot({ path: `artifacts/checkout-${width}.png`, fullPage: true });
    }
    await page.goto('/');
    await expect(page.locator('.desktop-basket')).toBeVisible();
    await expect(page.locator('.desktop-basket .cart-summary')).toContainText('1 020');
  } finally {
    await write(request, 'products/' + original.id, original);
  }
});

test('mobile kitchen shortcuts persist ETA, availability, and weekly settings', async ({
  page,
  request,
}) => {
  await login(request);
  const menu = await (await request.get('/api/menu')).json();
  const original = menu.products[0],
    originalSettings = menu.settings;
  let id: number | undefined;
  try {
    const created = await request.post('/api/orders', {
      headers: { Origin: origin },
      data: {
        name: 'Быстрые действия',
        note: '',
        privacy: { notice_version: 1, consent_version: 1, accepted: true },
        request_key: 'mobile-design-test-' + Date.now() + '-unique-key',
        items: [{ product_id: original.id, quantity: 1, expected_price: original.price }],
      },
    });
    expect(created.ok()).toBe(true);
    const customer = await created.json();
    id = (await (await request.get('/api/kitchen/orders')).json()).find(
      (order: { number: number }) => order.number === customer.number,
    ).id;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/staff/stores/1');
    await page.getByLabel('Логин', { exact: true }).fill(process.env.E2E_STAFF_USERNAME ?? 'owner');
    await page.getByLabel('Пароль', { exact: true }).fill(password!);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Кухня', exact: true })).toBeVisible();
    const card = page.locator('.kitchen-order').filter({ hasText: '№' + customer.number });
    await card
      .getByRole('group', { name: 'Время готовности заказа ' + customer.number })
      .getByRole('button', { name: '10 мин', exact: true })
      .click();
    await expect(card.getByRole('status')).toContainText('Время готовности обновлено');
    const updated = (await (await request.get('/api/kitchen/orders')).json()).find(
      (order: { id: number }) => order.id === id,
    );
    expect(
      Math.abs(
        (Date.parse(updated.estimated_ready_at) - Date.parse(updated.updated_at)) / 60000 - 10,
      ),
    ).toBeLessThan(0.1);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width > 720 ? 1000 : 844 });
      await fits(page);
      await page.screenshot({ path: `artifacts/admin-orders-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 320, height: 844 });
    await page.getByLabel('Раздел кухни', { exact: true }).selectOption('menu');
    const availability = page.getByRole('switch', { name: 'В продаже: ' + original.name });
    await availability.click();
    await expect(availability).toHaveAttribute('aria-checked', 'false');
    expect(
      (await (await request.get('/api/menu')).json()).products.find(
        (p: { id: number }) => p.id === original.id,
      ).available,
    ).toBe(false);
    await availability.click();
    await expect(availability).toHaveAttribute('aria-checked', 'true');
    await fits(page);
    await page
      .locator('.staff-product')
      .filter({ hasText: original.name })
      .getByRole('button', { name: 'Изменить' })
      .click();
    await page.getByRole('button', { name: 'Добавить опцию' }).click();
    await fits(page);
    await page.screenshot({ path: 'artifacts/admin-product-320.png', fullPage: true });
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.getByLabel('Раздел кухни', { exact: true }).selectOption('settings');
    await page
      .getByRole('group', { name: 'Базовое время приготовления', exact: true })
      .getByRole('button', { name: '5 мин', exact: true })
      .click();
    await expect(page.getByLabel('Базовое время приготовления, мин')).toHaveValue('5');
    // Presets update the draft, never silently persist the whole settings form.
    expect((await (await request.get('/api/menu')).json()).settings.prep_minutes).toBe(
      originalSettings.prep_minutes,
    );
    await page.getByLabel('Принимать заказы по расписанию').check();
    await page.locator('.schedule-row').first().getByRole('checkbox').check();
    await page.getByLabel('Открытие Пн').fill('09:00');
    await page.getByLabel('Закрытие Пн').fill('22:00');
    await page.getByRole('button', { name: 'Как в понедельник — на всю неделю' }).click();
    await page.getByRole('button', { name: 'Сохранить настройки' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Настройки сохранены.' }),
    ).toBeVisible();
    const saved = (await (await request.get('/api/menu')).json()).settings;
    expect(saved.prep_minutes).toBe(5);
    expect(saved.opening_hours).toHaveLength(7);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width > 720 ? 1000 : 844 });
      await fits(page);
      await page.screenshot({ path: `artifacts/admin-settings-${width}.png`, fullPage: true });
    }
  } finally {
    await write(request, 'settings', originalSettings);
    await write(request, 'products/' + original.id, original);
    if (id)
      await write(
        request,
        'orders/' + id,
        { status: 'cancelled', cancellation_reason: 'Проверка интерфейса завершена' },
        'PATCH',
      );
  }
});
