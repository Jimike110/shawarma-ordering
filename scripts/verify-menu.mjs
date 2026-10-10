// Checks public data, local photos, and a guest basket in an isolated browser context.
// Never authenticates staff or submits an order.
import { chromium, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const manifest = JSON.parse(
  await readFile(new URL('../config/menu.json', import.meta.url), 'utf8'),
);
const target = new URL(process.env.PREVIEW_URL ?? 'http://host.docker.internal:5173');
if (!['localhost', '127.0.0.1', 'host.docker.internal', 'web'].includes(target.hostname))
  throw new Error('Menu verification only supports the local app.');
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
  args: ['--no-sandbox'],
});
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const response = await context.request.get(new URL('/api/menu', target).href);
  expect(response.ok()).toBe(true);
  const menu = await response.json();
  expect(menu.products).toHaveLength(19);
  expect(menu.settings.demo_mode).toBe(false);
  expect(menu.settings.shop_name.trim().length).toBeGreaterThan(0);
  for (const expected of manifest.products) {
    const actual = menu.products.find((product) => product.image === expected.image);
    expect(actual).toMatchObject({
      name: expected.name,
      price: expected.price,
      weight: expected.weight,
      category: expected.category,
    });
    expect(actual.id).toBeGreaterThan(3);
    const photo = await context.request.get(new URL(expected.image, target).href);
    expect(photo.ok()).toBe(true);
    expect(photo.headers()['content-type']).toContain('image/jpeg');
    expect(
      createHash('sha256')
        .update(await photo.body())
        .digest('hex'),
    ).toBe(expected.image_sha256);
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width > 720 ? 1000 : 844 });
    await page.goto(target.href);
    await expect(page.locator('.product-card')).toHaveCount(19);
    expect(await page.locator('.banner-image img').getAttribute('src')).toMatch(
      /^\/images\/menu\//,
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.images].map((image) => {
          image.loading = 'eager';
          return image.decode();
        }),
      );
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const searchPadding = await page
      .locator('.menu-search input')
      .evaluate((input) => parseFloat(getComputedStyle(input).paddingLeft));
    expect(searchPadding).toBeGreaterThanOrEqual(40);
    await page.screenshot({ path: `artifacts/menu-${width}.png`, fullPage: true });
    await page.screenshot({ path: `artifacts/menu-viewport-${width}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByPlaceholder('Найти в меню').fill('Кокосовый');
  await expect(page.locator('.product-card')).toHaveCount(1);
  await expect(page.locator('.product-card')).toContainText('300');
  await page.getByPlaceholder('Найти в меню').fill('');
  if (menu.accepting_orders) {
    await page.getByRole('button', { name: 'Подробнее: Шаверма в пите', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Шаверма в пите' });
    await expect(details).toContainText('360 г');
    await details.getByRole('button', { name: 'Добавить: Количество товара' }).click();
    await expect(details.getByRole('button', { name: /В корзину ·/ })).toContainText('560');
    await details.getByRole('button', { name: /В корзину ·/ }).click();
    await page.getByRole('button', { name: 'Подробнее: Картофель фри', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Картофель фри' })
      .getByRole('button', { name: /В корзину ·/ })
      .click();
    await page.getByRole('button', { name: 'Открыть корзину' }).click();
    await expect(page.getByRole('dialog', { name: 'Ваш заказ' })).toContainText('710');
    await page.getByRole('button', { name: 'Оформить заказ' }).click();
    await expect(page.getByRole('button', { name: /Заказать ·/ })).toContainText('710');
    await page.screenshot({ path: 'artifacts/menu-checkout-390.png', fullPage: true });
  }
  expect(errors).toEqual([]);
  console.log(
    'Verified 19 prices/portions/photo checksums, search, and 320–1440px storefronts. ' +
      (menu.accepting_orders
        ? 'Guest basket/checkout total: 710 RUB. No order submitted.'
        : 'Shop closed: basket/checkout check skipped.'),
  );
} finally {
  await browser.close();
}
