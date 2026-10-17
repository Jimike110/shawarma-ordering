import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function mockTelegram(page: Page, granted = true) {
  await page.route('https://telegram.org/js/telegram-web-app.js', (r) =>
    r.fulfill({
      contentType: 'application/javascript',
      body: `
    sessionStorage.setItem('__telegram__initParams', JSON.stringify({tgWebAppData:'auth_date=synthetic'}));
    window.Telegram={WebApp:{initData:'auth_date=synthetic',colorScheme:'light',safeAreaInset:{top:0,bottom:0},contentSafeAreaInset:{top:0,bottom:0},
      ready(){},expand(){},isVersionAtLeast(){return true},setHeaderColor(){},setBackgroundColor(){},onEvent(){},offEvent(){},
      enableClosingConfirmation(){window.testClosing=true},disableClosingConfirmation(){window.testClosing=false},
      requestWriteAccess(cb){cb(${granted})},BackButton:{show(){},hide(){},onClick(){},offClick(){}}
    }};`,
    }),
  );
  await page.route('**/api/telegram/config', (r) =>
    r.fulfill({ json: { ready: true, bot_username: 'SyntheticTestBot' } }),
  );
  await page.route(/\/api\/privacy(?:\/versions\/\d+)?$/, async (r) => {
    const response = await r.fetch();
    const data = await response.json();
    await r.fulfill({
      json: {
        ...data,
        telegram_consent: 'Синтетическое отдельное согласие Telegram для проверки.',
      },
    });
  });
}

test('Telegram checkout preserves the exact intent on a lost response and opens protected status', async ({
  page,
}) => {
  await mockTelegram(page);
  const handle = 'h'.repeat(43),
    privateToken = 'p'.repeat(43);
  let sessions = 0,
    intents = 0;
  const submissions: unknown[] = [];
  await page.route('**/api/telegram/session', (r) => {
    sessions++;
    return r.fulfill({
      status: 201,
      json: { token: 'in-memory-only', expires_at: new Date(Date.now() + 1800000).toISOString() },
    });
  });
  await page.route('**/api/telegram/checkout-intents', (r) => {
    intents++;
    expect(r.request().headers().authorization).toBe('Bearer in-memory-only');
    return r.fulfill({ status: 201, json: { intent_id: 'i'.repeat(43) } });
  });
  const order = {
    number: 987,
    status: 'new',
    total: 290,
    items: [{ product_id: 1, name: 'Классическая', price: 290, quantity: 1 }],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    estimated_ready_at: new Date(Date.now() + 600000).toISOString(),
    token: privateToken,
    telegram_handle: handle,
    store_id: 1,
    store_slug: 'belorusskaya-4',
    shop: {
      shop_name: 'Тестовая точка',
      address: 'Белорусская ул., 4',
      city: 'Санкт-Петербург',
      opening_hours: [],
    },
  };
  await page.route('**/api/orders', (r) => {
    submissions.push(r.request().postDataJSON());
    return submissions.length === 1 ? r.abort('failed') : r.fulfill({ status: 201, json: order });
  });
  await page.route('**/api/telegram/orders/' + handle, (r) =>
    r.fulfill({
      json: {
        ...order,
        token: undefined,
        telegram_handle: undefined,
        telegram_delivery: 'pending',
      },
    }),
  );
  await page.goto('/tg/s/belorusskaya-4');
  await page.getByRole('button', { name: 'В корзину: Классическая' }).click();
  await page.getByRole('button', { name: 'Открыть корзину' }).click();
  await page.getByRole('button', { name: 'Оформить заказ' }).click();
  await expect(page).toHaveURL(/\/tg\/s\/belorusskaya-4\/checkout/);
  const alerts = page.getByRole('checkbox', { name: /Получать уведомления/ });
  await expect(alerts).not.toBeChecked();
  expect(sessions).toBe(0);
  await alerts.check();
  await page.getByRole('button', { name: /Заказать ·/ }).click();
  await expect(page.getByRole('button', { name: /Повторить отправку/ })).toBeVisible();
  await page.getByRole('button', { name: /Повторить отправку/ }).click();
  await expect(page).toHaveURL('/tg/order/' + handle);
  await expect(page.getByRole('heading', { name: 'ЗАКАЗ №987' })).toBeVisible();
  expect(submissions[0]).toEqual(submissions[1]);
  expect(intents).toBe(1);
  expect(sessions).toBe(1);
  await expect(page.getByText(/Сообщение ожидает отправки/)).toBeVisible();
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain('in-memory-only');
  expect(stored).not.toContain('auth_date=synthetic');
  expect(await page.evaluate(() => sessionStorage.getItem('__telegram__initParams'))).toBeNull();
});

test('Telegram permission denial keeps number-only checkout available and responsive', async ({
  page,
}) => {
  await mockTelegram(page, false);
  let identities = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/telegram/session')) identities++;
  });
  await page.goto('/tg/s/belorusskaya-4');
  await page.getByRole('button', { name: 'В корзину: Классическая' }).click();
  await page.getByRole('button', { name: 'Открыть корзину' }).click();
  await page.getByRole('button', { name: 'Оформить заказ' }).click();
  const alerts = page.getByRole('checkbox', { name: /Получать уведомления/ });
  await alerts.click();
  await expect(alerts).not.toBeChecked();
  await expect(page.getByText(/Можно продолжить заказ без уведомлений/)).toBeVisible();
  expect(identities).toBe(0);
  await expect(page.getByRole('button', { name: /Заказать ·/ })).toBeEnabled();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `artifacts/telegram-checkout-${width}.png`, fullPage: true });
  }
  await page.goto('/tg/telegram-consent');
  await expect(
    page.getByRole('heading', { name: 'Согласие на уведомления в Telegram' }),
  ).toBeVisible();
  const standard = await page.request.get('/s/belorusskaya-4'),
    telegram = await page.request.get('/tg/s/belorusskaya-4');
  expect(standard.headers()['x-frame-options']).toBe('DENY');
  expect(standard.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(telegram.headers()['x-frame-options']).toBeUndefined();
  expect(telegram.headers()['content-security-policy']).toContain('https://web.telegram.org');
});
