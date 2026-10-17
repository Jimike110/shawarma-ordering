import { test, expect } from './fixtures';
import { mkdir } from 'node:fs/promises';

test('first visit, map pins, manual search, location access and responsive picker', async ({
  page,
  request,
}) => {
  const menu = await (await request.get('/api/menu')).json();
  const first = {
    ...menu.store,
    id: 1,
    slug: 'belorusskaya-4',
    published: true,
    archived: false,
    accepting_orders: true,
    intake_message: '',
    settings: {
      ...menu.settings,
      address: 'Белорусская ул., 4',
      latitude: 59.935643,
      longitude: 30.499839,
      landmark: 'Ориентир А',
    },
  };
  const second = {
    ...first,
    id: 10001,
    slug: 'pickup-fixture',
    settings: {
      ...first.settings,
      address: 'Тестовая улица, 18',
      latitude: 59.95,
      longitude: 30.45,
      landmark: 'Ориентир Б',
    },
  };
  await page.route('**/api/stores', (r) => r.fulfill({ json: [first, second] }));
  const referrers: string[] = [];
  await page.route('https://tile.openstreetmap.org/**', (r) => {
    referrers.push(r.request().headers().referer ?? '');
    return r.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4ioAAAAASUVORK5CYII=',
        'base64',
      ),
    });
  });
  await page.addInitScript(() => {
    (window as any).geoCalls = 0;
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (success: PositionCallback) => {
          (window as any).geoCalls++;
          success({ coords: { latitude: 59.95001, longitude: 30.45001 } } as GeolocationPosition);
        },
      },
      configurable: true,
    });
  });
  await page.goto('/locations');
  await page.evaluate(() => localStorage.removeItem('shawarma-pickup-store'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Где заберёте заказ?' })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => (window as any).geoCalls)).toBe(0);
  await expect(page.getByRole('button', { name: 'Заказать здесь', exact: true })).toHaveCount(0);
  await expect(page.locator('.pickup-map-pin')).toHaveCount(2);
  expect(referrers.length).toBeGreaterThan(0);
  expect(referrers.every((r) => r === new URL(page.url()).origin + '/')).toBe(true);
  await page
    .getByRole('button', { name: 'Выбрать точку на карте: Белорусская ул., 4', exact: true })
    .click();
  await expect(
    page.locator('.pickup-store-card').filter({ hasText: 'Белорусская ул., 4' }),
  ).toHaveClass(/is-selected/);
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: 'Рядом со мной' }).click();
  await expect(page.locator('.pickup-store-card').first()).toContainText('Тестовая улица, 18');
  await expect(page.locator('.pickup-card-distance').first()).toContainText('по прямой');
  expect(await page.evaluate(() => localStorage.getItem('shawarma-pickup-store'))).toBeNull();
  await page.getByRole('searchbox').fill('Ориентир Б');
  await expect(page.locator('.pickup-store-card')).toHaveCount(1);
  await expect(page.locator('.pickup-map-pin')).toHaveCount(1);
  await page.getByRole('searchbox').clear();
  await page
    .getByRole('button', { name: 'Выбрать точку: Тестовая улица, 18', exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole('button', { name: 'Выбрать точку на карте: Тестовая улица, 18', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('shawarma-pickup-store'))).toBeNull();
  await mkdir('artifacts/pickup', { recursive: true });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const tools = page.locator('.pickup-tools');
    expect(
      await tools.evaluate((el) =>
        Array.from(el.children).every((child) => {
          const bounds = child.getBoundingClientRect(),
            parent = el.getBoundingClientRect();
          return bounds.left >= parent.left && bounds.right <= parent.right;
        }),
      ),
    ).toBe(true);
    await page.getByRole('searchbox').blur();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `artifacts/pickup/first-visit-${width}.png`, fullPage: true });
  }
  await page
    .getByRole('button', { name: 'Выбрать точку: Белорусская ул., 4', exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole('button', { name: 'Выбрать точку на карте: Белорусская ул., 4', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Перейти к меню', exact: true }).click();
  await expect(page).toHaveURL(/\/s\/belorusskaya-4$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/s\/belorusskaya-4$/);
});

test('header picker supports Back, Escape, reload, keyboard and map failure', async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  await page.goto('/s/belorusskaya-4');
  const trigger = page.getByRole('button', { name: 'Адрес самовывоза', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Где заберёте заказ?' });
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.reload();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.pickup-store-card').first()).toBeVisible();
  await expect(
    dialog.getByText('Карта недоступна или загрузилась не полностью. Выберите адрес в списке.'),
  ).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await dialog.evaluate((d) => d.scrollWidth <= d.clientWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/pickup/header-dialog-${width}.png`, fullPage: false });
  }
  await dialog.getByRole('button', { name: 'Скрыть карту', exact: true }).click();
  await expect(dialog.locator('.pickup-map')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Закрыть выбор точки' }).click();
  await expect(dialog).toHaveCount(0);
});

test('unavailable saved locations are explained and refresh does not interrupt selection', async ({
  page,
  request,
}) => {
  const menu = await (await request.get('/api/menu')).json();
  const store = { ...menu.store, accepting_orders: false, intake_message: 'Приём на паузе' };
  await page.route('**/api/stores', (r) => r.fulfill({ json: [store] }));
  await page.goto('/');
  await expect(
    page.getByText('Сохранённая точка сейчас не принимает заказы.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('searchbox').fill('выбираю адрес');
  store.accepting_orders = true;
  const refreshed = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/stores');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await refreshed;
  await expect(page.getByRole('heading', { name: 'Где заберёте заказ?' })).toBeVisible();
  await expect(page.getByRole('searchbox')).toHaveValue('выбираю адрес');
  await page.evaluate(() => localStorage.setItem('shawarma-pickup-store', 'removed-location'));
  await page.reload();
  await expect(
    page.getByText('Ранее выбранная точка больше недоступна. Выберите другой адрес.'),
  ).toBeVisible();
});

test('address selection survives a failed lazy map download', async ({ page }) => {
  await page.route('**/*PickupMap*', (r) => r.abort());
  await page.goto('/locations');
  await expect(page.getByText('Не удалось загрузить карту. Выберите адрес ниже.')).toBeVisible();
  await page.locator('.pickup-store-choose').first().click();
  await expect(page).toHaveURL(/\/locations$/);
  await page.getByRole('button', { name: 'Перейти к меню', exact: true }).click();
  await expect(page).toHaveURL(/\/s\/belorusskaya-4$/);
});

async function swipe(page: import('@playwright/test').Page, x: number, fromY: number, toY: number) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y: fromY }],
    });
    for (let i = 1; i <= 10; i++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: fromY + ((toY - fromY) * i) / 10 }],
      });
      await page.waitForTimeout(20);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
}

test('mobile swipes scroll across the map and cards in one area, even on short screens', async ({
  page,
  request,
}) => {
  const menu = await (await request.get('/api/menu')).json();
  const stores = Array.from({ length: 10 }, (_, i) => ({
    ...menu.store,
    id: i + 1,
    published: true,
    archived: false,
    settings: {
      ...menu.settings,
      address: `Тестовый адрес, ${i + 1}`,
      latitude: 59.93 + i * 0.001,
      longitude: 30.49 + i * 0.002,
    },
  }));
  await page.route('**/api/stores', (r) => r.fulfill({ json: stores }));
  for (const { width, height } of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 768, height: 900 },
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto('/locations');
    const map = page.locator('.pickup-map');
    await expect(page.getByRole('button', { name: 'Двигать карту', exact: true })).toBeVisible();
    const bounds = (await map.boundingBox())!;
    expect(await map.evaluate((el) => getComputedStyle(el).touchAction)).toBe('pan-y');
    await swipe(page, width - 35, bounds.y + bounds.height * 0.65, bounds.y - 100);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(60);
    expect(
      await page.locator('.pickup-store-list').evaluate((el) => getComputedStyle(el).overflowY),
    ).toBe('visible');
    await page.locator('.pickup-store-choose').last().scrollIntoViewIfNeeded();
    await expect(page.locator('.pickup-store-choose').last()).toBeInViewport();
    await page.goto('/s/belorusskaya-4');
    await page.getByRole('button', { name: 'Адрес самовывоза', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Где заберёте заказ?' });
    const box = (await dialog.locator('.pickup-map').boundingBox())!;
    await swipe(page, width - 35, box.y + box.height * 0.65, box.y - 100);
    await expect.poll(() => dialog.evaluate((el) => el.scrollTop)).toBeGreaterThan(60);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await dialog.locator('.pickup-store-choose').last().scrollIntoViewIfNeeded();
    await expect(dialog.locator('.pickup-store-choose').last()).toBeInViewport();
    await page.getByRole('button', { name: 'Закрыть выбор точки' }).click();
    await expect(dialog).toHaveCount(0);
  }
  await page.setViewportSize({ width: 390, height: 440 });
  await page.goto('/s/belorusskaya-4?pickup=1');
  const dialog = page.getByRole('dialog', { name: 'Где заберёте заказ?' });
  await dialog.getByRole('searchbox').fill('Тестовый адрес, 10');
  await expect(dialog.locator('.pickup-store-choose')).toHaveCount(1);
  await dialog.locator('.pickup-store-choose').scrollIntoViewIfNeeded();
  await expect(dialog.locator('.pickup-store-choose')).toBeInViewport();
  await dialog.getByRole('button', { name: 'Скрыть карту', exact: true }).click();
  await expect(dialog.locator('.pickup-map')).toHaveCount(0);
});

test('map movement is explicit on touch screens and can be returned to page scrolling', async ({
  page,
}) => {
  await page.route('https://tile.openstreetmap.org/**', (r) =>
    r.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#c9d8b7"/><path d="M0 64H256M64 0V256M0 192H256M192 0V256" stroke="#fff" stroke-width="12"/><text x="80" y="130" fill="#53614b">Test tile</text></svg>',
    }),
  );
  await page.goto('/locations');
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible();
  const tileRendering = () =>
    page.locator('.pickup-map').evaluate((el) => ({
      position: getComputedStyle(el).position,
      overflow: getComputedStyle(el).overflow,
      tilePosition: getComputedStyle(el.querySelector('.leaflet-tile-loaded')!).position,
    }));
  const before = await tileRendering();
  expect(before).toEqual({ position: 'relative', overflow: 'hidden', tilePosition: 'absolute' });
  await expect(page.locator('.pickup-map')).toHaveClass(/leaflet-container/);
  await page.getByRole('button', { name: 'Двигать карту', exact: true }).click();
  await expect(page.locator('.pickup-map')).toHaveClass(/leaflet-container/);
  await expect(page.locator('.pickup-map')).toHaveClass(/is-interactive/);
  expect(await tileRendering()).toEqual(before);
  await page.screenshot({ path: 'artifacts/pickup/map-moving.png' });
  expect(await page.locator('.pickup-map').evaluate((el) => getComputedStyle(el).touchAction)).toBe(
    'none',
  );
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(page.locator('.pickup-map')).not.toHaveClass(/is-interactive/);
  await expect(page.locator('.pickup-map')).toHaveClass(/leaflet-container/);
  expect(await tileRendering()).toEqual(before);
  expect(await page.locator('.pickup-map').evaluate((el) => getComputedStyle(el).touchAction)).toBe(
    'pan-y',
  );
  const address = page.locator('.pickup-store-choose').first();
  await address.click();
  await expect(page.locator('.pickup-map')).toHaveClass(/leaflet-container/);
  await page.getByRole('button', { name: 'Двигать карту', exact: true }).click();
  const box = (await page.locator('.pickup-map').boundingBox())!;
  await swipe(page, box.x + box.width * 0.7, box.y + box.height * 0.7, box.y + box.height * 0.2);
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await address.click();
  await expect
    .poll(async () => {
      const pin = (await page.locator('.pickup-map-pin.is-selected').boundingBox())!;
      const map = (await page.locator('.pickup-map').boundingBox())!;
      return Math.abs(pin.y + pin.height - (map.y + map.height / 2));
    })
    .toBeLessThan(6);
  await expect(page).toHaveURL(/\/locations$/);
});
