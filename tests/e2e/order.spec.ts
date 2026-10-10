import { test, expect } from '@playwright/test';
const password = process.env.E2E_KITCHEN_PASSWORD;
test.skip(!password, 'Set E2E_KITCHEN_PASSWORD and run the local app first.');
test('mobile checkout, private tracking auto-refresh, and staff controls', async ({
  browser,
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Меню', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.locator('.product-photo img').first()).toBeVisible();
  await page.getByRole('button', { name: 'В корзину: Классическая' }).click();
  await page.getByRole('button', { name: 'Открыть корзину' }).click();
  await page.getByRole('button', { name: 'Оформить заказ' }).click();
  await page.getByLabel('Ваше имя').fill('Тестовый гость');
  await page.getByLabel('Комментарий к заказу').fill('Без лука');
  await page.getByRole('button', { name: /Заказать ·/ }).click();
  await expect(page).toHaveURL(/\/track#/);
  const trackURL = page.url();
  const number = (await page.getByRole('heading', { name: /^ЗАКАЗ №/ }).innerText()).replace(
    'ЗАКАЗ №',
    '',
  );
  expect(trackURL.split('#')[1]).toHaveLength(43);
  const kitchenContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: { width: 390, height: 844 },
  });
  const kitchen = await kitchenContext.newPage();
  await kitchen.goto('/kitchen');
  await kitchen.getByLabel('Пароль', { exact: true }).fill(password!);
  await kitchen.getByRole('button', { name: 'Войти в кухню' }).click();
  await expect(kitchen.getByRole('heading', { name: 'Кухня', exact: true })).toBeVisible();
  const card = kitchen.locator('.kitchen-order').filter({ hasText: '№' + number });
  await expect(card).toBeVisible({ timeout: 12000 });
  await card.getByRole('button', { name: 'Начать готовить' }).click();
  await expect(card.getByRole('button', { name: 'Заказ готов' })).toBeVisible();
  await card.getByLabel('Минут для заказа ' + number).fill('22');
  await card.getByRole('button', { name: 'Сохранить время заказа ' + number }).click();
  await card.getByRole('button', { name: 'Заказ готов' }).click();
  // Customer page is untouched: this assertion verifies live polling, not a reload.
  await expect(page.getByRole('heading', { name: 'Горячая. Ваша.' })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator('.receipt-line')).toContainText('Классическая');
  const privateResponse = await page.request.get('/api/orders/' + number);
  expect(privateResponse.status()).toBe(404);
  await kitchen.getByRole('button', { name: 'Пауза', exact: true }).click();
  await page.goto('/');
  await expect(
    page.getByRole('status').filter({ hasText: 'Приём заказов временно' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'В корзину: Классическая' })).toBeDisabled();
  await kitchen.getByRole('button', { name: 'Возобновить' }).click();
  await kitchen.getByRole('button', { name: 'Меню', exact: true }).click();
  const product = kitchen.locator('.staff-product').filter({ hasText: 'Классическая' });
  await product.getByRole('button', { name: 'Изменить' }).click();
  await kitchen.getByLabel('Цена, ₽').fill('315');
  await kitchen.getByLabel('Доступен для заказа').uncheck();
  await kitchen.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(product).toContainText('Недоступен');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'В корзину: Классическая' })).toBeDisabled();
  const receipt = await page.request.get('/api/orders/' + trackURL.split('#')[1]);
  expect((await receipt.json()).total).toBe(290);
  // Restore demonstration menu after testing.
  await product.getByRole('button', { name: 'Изменить' }).click();
  await kitchen.getByLabel('Цена, ₽').fill('290');
  await kitchen.getByLabel('Доступен для заказа').check();
  await kitchen.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await kitchen.getByRole('button', { name: 'Заказы', exact: false }).click();
  await kitchen
    .locator('.kitchen-order')
    .filter({ hasText: '№' + number })
    .getByRole('button', { name: 'Выдать заказ' })
    .click();
  await page.goto(trackURL);
  await expect(page.getByRole('heading', { name: 'Приятного аппетита!' })).toBeVisible();
  await kitchen.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(kitchen.getByRole('button', { name: 'Войти в кухню' })).toBeVisible();
  await kitchenContext.close();
});
test('kitchen data cannot be read without authentication', async ({ request }) => {
  const result = await request.get('/api/kitchen/orders');
  expect(result.status()).toBe(401);
});
