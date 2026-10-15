import { test, expect } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const origin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5173').origin;
async function write(request: APIRequestContext, path: string, data: unknown, method = 'POST') {
  const r = await request.fetch('/api' + path, { method, headers: { Origin: origin }, data });
  expect(r.ok()).toBe(true);
  return r.json();
}
async function confirm(request: APIRequestContext) {
  await write(request, '/auth/reauthenticate', { password: process.env.E2E_KITCHEN_PASSWORD });
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('owner workspace and account management fit phones and desktop', async ({ page, request }) => {
  await confirm(request);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto('/owner');
  await expect(page.getByRole('heading', { name: 'Управление бизнесом' })).toBeVisible();
  await mkdir('artifacts/access', { recursive: true });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width > 720 ? 1000 : 844 });
    await fits(page);
    await page.screenshot({ path: 'artifacts/access/owner-' + width + '.png', fullPage: false });
  }
  await page.getByRole('button', { name: 'Сотрудники', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить сотрудника', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый сотрудник' });
  await expect(dialog).toBeVisible();
  await fits(page);
  await dialog.getByLabel('Имя сотрудника').fill('Тестовый сотрудник');
  await dialog.getByLabel('Логин', { exact: true }).fill('ui-worker');
  await dialog.getByRole('button', { name: 'Создать и выдать пароль' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Временный пароль', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Я сохранил пароль' }).click();
  await page.getByRole('button', { name: 'Аналитика', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Аналитика заказов' })).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width > 720 ? 1000 : 844 });
    await fits(page);
    await page.screenshot({
      path: 'artifacts/access/analytics-' + width + '.png',
      fullPage: false,
    });
  }
});

test('owner changes their own password without self-resetting or losing the new session', async ({
  page,
  request,
}) => {
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto('/owner');
  await page.getByRole('button', { name: 'Сотрудники', exact: true }).click();
  const self = page
    .locator('.staff-user')
    .filter({ has: page.getByRole('heading', { name: 'TestOwner', exact: true }) });
  await expect(self.getByRole('button', { name: 'Выдать новый пароль', exact: true })).toHaveCount(
    0,
  );
  const oldPassword = process.env.E2E_KITCHEN_PASSWORD!;
  const newPassword = 'owner-ui-personal-password';
  let changed = false;
  try {
    await self.getByRole('link', { name: 'Сменить мой пароль', exact: true }).click();
    await expect(page).toHaveURL(/\/staff\/account$/);
    await expect(page.getByRole('heading', { name: 'Смена пароля', exact: true })).toBeVisible();
    expect((await page.request.get('/api/auth/me')).status()).toBe(200);
    await page.getByLabel('Текущий пароль', { exact: true }).fill(oldPassword);
    await page.getByLabel('Новый пароль', { exact: true }).fill(newPassword);
    await page.getByLabel('Повторите новый пароль', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Сохранить пароль', exact: true }).click();
    await expect(page.getByText('Пароль изменён.', { exact: true })).toBeVisible();
    changed = true;
    expect((await request.get('/api/auth/me')).status()).toBe(401);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Смена пароля', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Вернуться к работе', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Управление бизнесом', exact: true }),
    ).toBeVisible();
  } finally {
    if (changed) {
      const restore = await page.request.post('/api/auth/change-password', {
        headers: { Origin: origin },
        data: { current_password: newPassword, password: oldPassword },
      });
      expect(restore.ok()).toBe(true);
      await page.getByRole('button', { name: 'Выйти', exact: true }).click();
      await page.getByLabel('Логин', { exact: true }).fill('owner');
      await page.getByLabel('Пароль', { exact: true }).fill(oldPassword);
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Управление бизнесом', exact: true }),
      ).toBeVisible();
      await request.post('/api/auth/login', {
        headers: { Origin: origin },
        data: { username: 'owner', password: oldPassword },
      });
      await request.storageState({ path: 'artifacts/e2e-owner-state.json' });
    }
  }
});

test('worker changes temporary password, runs a shift, and cannot lift an owner stop', async ({
  page,
  request,
}) => {
  await confirm(request);
  const issued = await write(request, '/owner/users', {
    username: 'shift-worker',
    display_name: 'Работник смены',
    phone: '',
    email: '',
    active: true,
    owner: false,
    memberships: [{ store_id: 1, role: 'worker' }],
  });
  const menu = await (await request.get('/api/menu')).json();
  const p = menu.products.find((p: any) => p.available);
  const created = await write(request, '/orders', {
    store_id: 1,
    name: 'Проверка сотрудника',
    note: '',
    privacy: { notice_version: 1, consent_version: 1, accepted: true },
    request_key: 'worker-' + Date.now().toString().padEnd(32, '0'),
    items: [{ product_id: p.id, quantity: 1, expected_price: p.price }],
  });
  try {
    await page.goto('/staff/stores/1');
    await page.getByLabel('Логин', { exact: true }).fill('shift-worker');
    await page.getByLabel('Пароль', { exact: true }).fill(issued.temporary_password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Задайте личный пароль' })).toBeVisible();
    await page.getByLabel('Временный пароль', { exact: true }).fill(issued.temporary_password);
    await page.getByLabel('Новый пароль', { exact: true }).fill('test-worker-long-password');
    await page.getByLabel('Повторите новый пароль').fill('test-worker-long-password');
    await page.getByRole('button', { name: 'Сохранить пароль' }).click();
    await expect(page.getByRole('heading', { name: 'Кухня', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Кухня', exact: true })).toBeVisible();
    const card = page.locator('.kitchen-order').filter({ hasText: '№' + created.number });
    await card.getByRole('button', { name: 'Отменить заказ', exact: true }).click();
    await card.getByLabel('Причина отмены').fill('Товар закончился');
    await card.getByRole('button', { name: 'Подтвердить отмену' }).click();
    await expect(card).not.toBeVisible();
    await page.getByRole('button', { name: 'Пауза', exact: true }).click();
    await page.getByLabel('Причина паузы').fill('Перегружена кухня');
    await page.getByRole('button', { name: 'Приостановить', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Возобновить', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Возобновить', exact: true }).click();
    await page.getByRole('button', { name: 'Меню', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Изменить', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Добавить товар', exact: true })).toHaveCount(0);
    const denied = await page.request.put('/api/staff/stores/1/settings', {
      headers: { Origin: origin },
      data: menu.settings,
    });
    expect(denied.status()).toBe(403);
    await write(
      request,
      '/owner/stores/1',
      { owner_stopped: true, reason: 'Проверка стопа владельца' },
      'PATCH',
    );
    await expect(page.getByRole('button', { name: 'Пауза', exact: true })).toBeDisabled({
      timeout: 20000,
    });
    const resume = await page.request.patch('/api/staff/stores/1/operations', {
      headers: { Origin: origin },
      data: { paused: false },
    });
    expect(resume.status()).toBe(403);
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Работа смены' })).toBeVisible();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width > 720 ? 1000 : 844 });
      await fits(page);
      await page.screenshot({ path: 'artifacts/access/worker-' + width + '.png', fullPage: false });
    }
    const reset = await write(request, '/owner/users/' + issued.user.id + '/reset-password', {});
    expect(reset.temporary_password.length).toBeGreaterThanOrEqual(15);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  } finally {
    await write(request, '/owner/stores/1', { owner_stopped: false, reason: '' }, 'PATCH');
    await write(request, '/staff/stores/1/operations', { paused: false }, 'PATCH');
    await write(
      request,
      '/staff/stores/1/orders/' + created.id,
      { status: 'cancelled', cancellation_reason: 'Завершение теста' },
      'PATCH',
    );
  }
});

test('separate store baskets, independent menu copies and cross-store checkout retry', async ({
  page,
  request,
}) => {
  await confirm(request);
  const shop = await write(request, '/owner/stores', {
    slug: 'second-e2e',
    name: 'Вторая точка',
    address: 'Ленская, 18',
  });
  const current = await (await request.get('/api/menu')).json();
  const original = current.products.find((p: any) => p.available);
  let receipt: any;
  try {
    const copied = await write(request, '/owner/menu-copy', {
      source_store_id: 1,
      destination_store_id: shop.id,
      product_ids: [original.id],
      request_key: 'copy-' + Date.now().toString().padEnd(32, '0'),
    });
    await write(
      request,
      '/staff/stores/' + shop.id + '/products/' + copied[0].id,
      { ...copied[0], name: 'Ленская классическая', available: true },
      'PUT',
    );
    await write(request, '/owner/stores/' + shop.id, { published: true }, 'PATCH');
    await page.goto('/');
    await expect(page.getByRole('combobox', { name: 'Адрес самовывоза' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Адрес самовывоза' })).toHaveValue(
      'belorusskaya-4',
    );
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width > 720 ? 1000 : 844 });
      await fits(page);
      await page.screenshot({ path: 'artifacts/access/pickup-header-' + width + '.png' });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/s/belorusskaya-4');
    await page.getByRole('button', { name: 'В корзину: ' + original.name }).click();
    await page.getByRole('combobox', { name: 'Адрес самовывоза' }).selectOption('second-e2e');
    await expect(page).toHaveURL(/\/s\/second-e2e$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/s\/second-e2e$/);
    await expect(page.getByRole('combobox', { name: 'Адрес самовывоза' })).toHaveValue(
      'second-e2e',
    );
    await expect(page.getByRole('button', { name: 'Открыть корзину' })).toHaveCount(0);
    await page.getByRole('button', { name: 'В корзину: Ленская классическая' }).click();
    await page.getByRole('combobox', { name: 'Адрес самовывоза' }).selectOption('belorusskaya-4');
    await page.getByRole('button', { name: 'Открыть корзину' }).click();
    await expect(page.getByRole('dialog', { name: 'Ваш заказ' })).toContainText(original.name);
    await page
      .getByRole('dialog', { name: 'Ваш заказ' })
      .getByRole('button', { name: 'Закрыть корзину' })
      .click();
    await page.getByRole('combobox', { name: 'Адрес самовывоза' }).selectOption('second-e2e');
    await page.getByRole('button', { name: 'Открыть корзину' }).click();
    await page.getByRole('button', { name: 'Оформить заказ' }).click();
    await expect(page).toHaveURL(/\/s\/second-e2e\/checkout$/);
    await page.getByLabel('Ваше имя').fill('Гость второй точки');
    await page.getByRole('checkbox', { name: /Даю отдельное/ }).check();
    const payloads: string[] = [];
    let attempts = 0;
    await page.route(/\/api\/orders$/, async (route) => {
      payloads.push(route.request().postData()!);
      attempts++;
      if (attempts === 1) {
        await route.fetch();
        await route.abort('failed');
      } else await route.continue();
    });
    await page.getByRole('button', { name: /Заказать ·/ }).click();
    await expect(page.getByRole('button', { name: /Повторить отправку/ })).toBeVisible();
    await write(request, '/owner/stores/' + shop.id, { published: false }, 'PATCH');
    await page.reload();
    await expect(page.locator('.checkout .pickup')).toContainText('Ленская, 18');
    await page.getByRole('button', { name: /Повторить отправку/ }).click();
    await expect(page).toHaveURL(/\/track#/);
    expect(new Set(payloads).size).toBe(1);
    expect(JSON.parse(payloads[0]).store_id).toBe(shop.id);
    receipt = await (await request.get('/api/orders/' + page.url().split('#')[1])).json();
    expect(receipt.store_id).toBe(shop.id);
    await expect(page.getByText('Ленская, 18', { exact: true })).toBeVisible();
    await page.route('**/api/menu', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"Unavailable"}',
      }),
    );
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'ЗАКАЗ №' + receipt.number, exact: true }),
    ).toBeVisible();
    await page.goto('/orders');
    await expect(page.getByRole('link', { name: new RegExp('№' + receipt.number) })).toBeVisible();
    const firstOrders = await (await request.get('/api/staff/stores/1/orders')).json();
    expect(firstOrders.some((o: any) => o.number === receipt.number)).toBe(false);
    await page.goto('/s/belorusskaya-4');
    await expect(page.getByRole('button', { name: 'Открыть корзину' })).toBeVisible();
  } finally {
    if (receipt) {
      const secondOrders = await (
        await request.get('/api/staff/stores/' + shop.id + '/orders')
      ).json();
      for (const order of secondOrders.filter(
        (o: any) => !['completed', 'cancelled'].includes(o.status),
      ))
        await write(
          request,
          '/staff/stores/' + shop.id + '/orders/' + order.id,
          { status: 'cancelled', cancellation_reason: 'Завершение теста' },
          'PATCH',
        );
    }
    await write(request, '/owner/stores/' + shop.id, { published: false }, 'PATCH');
  }
});
