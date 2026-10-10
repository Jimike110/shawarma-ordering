// Read-only visual check against the running local app. Never signs staff in or places orders.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const target = new URL(process.env.PREVIEW_URL ?? 'http://host.docker.internal:5173');
if (!['localhost', '127.0.0.1', 'host.docker.internal', 'web'].includes(target.hostname)) {
  throw new Error('Preview capture only supports the local app.');
}
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width > 720 ? 1000 : 844 });
    await page.goto(target.href);
    await page.locator('.product-card').first().waitFor();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.images].map((image) => {
          // Full-page captures must request catalogue images below the viewport too.
          image.loading = 'eager';
          return image.decode().catch(() => {});
        }),
      );
    });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) {
      throw new Error('Horizontal overflow at width ' + width);
    }
    await page.screenshot({ path: `artifacts/shop-${width}.png`, fullPage: true });
  }
  if (errors.length) throw new Error('Browser errors: ' + errors.join('; '));
  console.log(
    'Local storefront captured at 320, 390, 768, and 1440px; no horizontal overflow or page errors.',
  );
} finally {
  await browser.close();
}
