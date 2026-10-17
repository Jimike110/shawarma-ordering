import { test, expect } from './fixtures';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// This deliberately edits only a disposable Vite source COPY, never src/ in the
// running shop. Set the directory explicitly when running this development check.
test('staff contexts survive repeated kitchen and provider hot updates', async ({
  page,
  request,
}) => {
  const root = process.env.E2E_HMR_SOURCE_DIR;
  test.skip(!root, 'Requires a disposable Vite workspace copy');
  test.setTimeout(90000);
  await page.context().addCookies((await request.storageState()).cookies);
  let updates = 0;
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      if (
        String(payload).includes('"type":"update"') ||
        String(payload).includes('"type":"full-reload"')
      )
        updates++;
    }),
  );
  await page.goto('/owner');
  await expect(
    page.getByRole('heading', { name: 'Управление бизнесом', exact: true }),
  ).toBeVisible();
  for (const [file, needle] of [
    ['features/kitchen/Kitchen.tsx', '<h1>Кухня</h1>'],
    ['features/auth/StaffTop.tsx', 'className="staff-top"'],
    ['features/owner/OwnerLayout.tsx', 'className="owner-header"'],
  ]) {
    const path = join(root!, file),
      original = await readFile(path, 'utf8');
    const changed = original.replace(
      needle,
      needle.startsWith('<h1>')
        ? '<h1 data-hmr-probe="regression">Кухня</h1>'
        : needle + ' data-hmr-probe="regression"',
    );
    expect(changed).not.toBe(original);
    try {
      const before = updates;
      await writeFile(path, changed);
      await expect.poll(() => updates).toBeGreaterThan(before);
      await page.waitForTimeout(600);
      await expect(
        page.getByRole('heading', { name: 'Управление бизнесом', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Обновить страницу', exact: true }),
      ).toHaveCount(0);
      await expect(page.getByText('Missing staff authentication', { exact: false })).toHaveCount(0);
    } finally {
      const before = updates;
      await writeFile(path, original);
      await expect.poll(() => updates).toBeGreaterThan(before);
      await page.waitForLoadState('networkidle');
    }
    await page.getByRole('link', { name: 'Сотрудники', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Сотрудники', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Обзор', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Управление бизнесом', exact: true }),
    ).toBeVisible();
  }
  await page.goto('/staff/stores/1');
  await expect(page.getByRole('heading', { name: 'Кухня', exact: true })).toBeVisible();
  const path = join(root!, 'features/kitchen/Kitchen.tsx'),
    original = await readFile(path, 'utf8');
  try {
    await writeFile(
      path,
      original.replace('<h1>Кухня</h1>', '<h1 data-hmr-probe="kitchen">Кухня</h1>'),
    );
    await expect(page.locator('[data-hmr-probe="kitchen"]')).toBeVisible();
    await page.getByLabel('Раздел кухни', { exact: true }).selectOption('menu');
    await expect(page.getByRole('button', { name: 'Добавить товар', exact: true })).toBeVisible();
  } finally {
    const before = updates;
    await writeFile(path, original);
    await expect.poll(() => updates).toBeGreaterThan(before);
    await expect(page.locator('[data-hmr-probe="kitchen"]')).toHaveCount(0);
  }
});

test('route failures show a safe responsive recovery screen and preserve checkout data', async ({
  page,
}) => {
  test.skip(!process.env.E2E_HMR_SOURCE_DIR, 'Requires Vite module fault injection');
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'shawarma-attempt-v3:1',
      JSON.stringify({
        key: 'a'.repeat(48),
        payload: {
          store_id: 1,
          name: '',
          note: '',
          items: [{ product_id: 1, quantity: 1, expected_price: 300 }],
        },
      }),
    );
  });
  await page.route('**/src/features/catalog/Shop.tsx*', async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    body = body.replace(
      /function Shop\(\) \{/,
      'function Shop() { throw new Error("internal-fixture-detail");',
    );
    const headers = { ...response.headers(), 'cache-control': 'no-store' };
    delete headers.etag;
    delete headers['last-modified'];
    await route.fulfill({ response, body, headers });
  });
  await page.goto('/s/belorusskaya-4');
  await expect(
    page.getByRole('heading', { name: 'Не удалось открыть страницу', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('internal-fixture-detail', { exact: false })).toHaveCount(0);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  expect(
    await page.evaluate(() => JSON.parse(sessionStorage.getItem('shawarma-attempt-v3:1')!).key),
  ).toBe('a'.repeat(48));
  await page.unroute('**/src/features/catalog/Shop.tsx*');
  await page.getByRole('button', { name: 'Обновить страницу', exact: true }).click();
  await expect(page.locator('.product-card').first()).toBeVisible();
});
