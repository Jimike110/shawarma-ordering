import { test, expect } from './fixtures';
import { mkdir } from 'node:fs/promises';

test('number-only checkout and separate optional consent', async ({ page }) => {
  await page.goto('/s/belorusskaya-4');
  await page.getByRole('button', { name: 'В корзину: Классическая' }).click();
  await page.getByRole('button', { name: 'Открыть корзину' }).click();
  await page.getByRole('button', { name: 'Оформить заказ' }).click();
  const consent = page.getByRole('checkbox', { name: /Даю отдельное/ });
  await expect(consent).not.toBeChecked();
  await page.getByLabel('Ваше имя').fill('Неотправленное имя');
  let submissions = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/orders')) submissions++;
  });
  await page.getByRole('button', { name: /Заказать ·/ }).click();
  await expect(
    page.getByText(
      'Для имени и комментария отметьте отдельное согласие или оставьте поля пустыми.',
    ),
  ).toBeVisible();
  expect(submissions).toBe(0);
  await expect(page.getByLabel('Ваше имя')).toHaveValue('Неотправленное имя');
  await mkdir('artifacts/privacy', { recursive: true });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'artifacts/privacy/checkout-' + width + '.png', fullPage: true });
  }
  await page.getByLabel('Ваше имя').fill('');
  await page.getByRole('button', { name: /Заказать ·/ }).click();
  await expect(page).toHaveURL(/\/track#/);
  expect(submissions).toBe(1);
});

test('public documents and owner privacy workspace fit all widths', async ({ page, request }) => {
  await mkdir('artifacts/privacy', { recursive: true });
  for (const route of ['/privacy', '/consent', '/owner/privacy']) {
    if (route.startsWith('/owner'))
      await page.context().addCookies((await request.storageState()).cookies);
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: 'artifacts/privacy/' + route.replaceAll('/', '-') + '-' + width + '.png',
        fullPage: true,
      });
    }
  }
  await expect(page.getByLabel('Полное наименование организации / ФИО ИП')).toHaveValue(
    /Fixture operator/,
  );
});

test('owner handles a verified withdrawal without cancelling the order', async ({
  page,
  request,
}) => {
  const origin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5173').origin;
  const doc = await (await request.get('/api/privacy')).json();
  const menu = await (await request.get('/api/menu')).json();
  const created = await request.post('/api/orders', {
    headers: { Origin: origin },
    data: {
      store_id: 1,
      name: 'Privacy fixture',
      note: 'Preparation fixture',
      request_key: 'privacy-ui-' + Date.now().toString().padEnd(32, '0'),
      privacy: { notice_version: doc.id, consent_version: doc.id, accepted: true },
      items: [
        { product_id: menu.products[0].id, quantity: 1, expected_price: menu.products[0].price },
      ],
    },
  });
  expect(created.ok()).toBe(true);
  const order = await created.json();
  await page.context().addCookies((await request.storageState()).cookies);
  let confirmationRequired = true;
  await page.route('**/api/owner/privacy/requests', async (route) => {
    if (route.request().method() === 'POST' && confirmationRequired) {
      confirmationRequired = false;
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Подтвердите пароль для этого действия.',
          code: 'reauthentication_required',
        }),
      });
    } else await route.continue();
  });
  await page.goto('/owner/privacy?section=requests');
  await page.getByLabel('Точка получения').selectOption('1');
  await page.getByLabel('Номер заказа', { exact: true }).fill(String(order.number));
  await page.getByLabel('Вид обращения').selectOption('withdrawal');
  await page.getByRole('button', { name: 'Зарегистрировать', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Подтвердите пароль', exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByLabel('Текущий пароль').fill(process.env.E2E_KITCHEN_PASSWORD!);
  await confirmation.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Подтвердить принадлежность', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Способ проверки').selectOption('in_person');
  await page.getByRole('button', { name: 'Подтвердить принадлежность', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Скачать данные', exact: true })).toBeEnabled();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать данные', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toMatch(/^privacy-request-/);
  await page.getByRole('button', { name: 'Блокировать спорные поля', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Блокировать спорные поля', exact: true }),
  ).toBeEnabled();
  let queue = await (await request.get('/api/staff/stores/1/orders')).json();
  expect(queue.find((o: { number: number }) => o.number === order.number).name).toBeUndefined();
  await page.getByText('Удаление и завершение', { exact: true }).click();
  await page.getByRole('button', { name: 'Подтверждаю удаление полей', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Завершить обращение', exact: true }),
  ).toBeEnabled();
  queue = await (await request.get('/api/staff/stores/1/orders')).json();
  expect(queue.find((o: { number: number }) => o.number === order.number).status).toBe('new');
  expect(queue.find((o: { number: number }) => o.number === order.number).note).toBeUndefined();
  await page.getByRole('button', { name: 'Завершить обращение', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Подтверждаю удаление полей', exact: true }),
  ).toHaveCount(0);
});

test('expired receipts stay in browser history with an honest label', async ({ page }) => {
  const token = 'expired-fixture-'.padEnd(43, 'x');
  await page.addInitScript(
    (t) =>
      localStorage.setItem(
        'shawarma-orders',
        JSON.stringify([{ token: t, number: 801, created_at: '2024-01-01T10:00:00Z' }]),
      ),
    token,
  );
  await page.route('**/api/orders/' + token, (route) =>
    route.fulfill({
      status: 410,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Срок хранения квитанции истёк.' }),
    }),
  );
  await page.goto('/orders');
  await expect(page.getByRole('link', { name: /Заказ №801/ })).toContainText(
    'Срок хранения квитанции истёк',
  );
  await page.getByRole('link', { name: /Заказ №801/ }).click();
  await expect(page.getByRole('heading', { name: 'Срок хранения квитанции истёк' })).toBeVisible();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('shawarma-orders')!)[0].expired),
  ).toBe(true);
});
