// Verify real hot reload with a temporary CSS property; never signs in or writes shop data.
// Mount ./src:/app/src so this probe reaches the Windows source watched by Vite.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const target = new URL(process.env.PREVIEW_URL ?? 'http://host.docker.internal:5173');
if (!['localhost', '127.0.0.1', 'host.docker.internal', 'web'].includes(target.hostname))
  throw new Error('Development verification only supports local hosts.');
const cssURL = new URL('../src/styles.css', import.meta.url);
const marker = 'check-' + randomUUID();
const probe = `\n/* ${marker} */\n:root { --codex-hmr-check: ${marker}; }\n/* end ${marker} */\n`;
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
  args: ['--no-sandbox'],
});
let probeWritten = false;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  expect((await context.request.get(new URL('/@vite/client', target).href)).ok()).toBe(true);
  const health = await context.request.get(new URL('/api/health', target).href);
  expect((await health.json()).status).toBe('ok');
  const menu = await (await context.request.get(new URL('/api/menu', target).href)).json();
  expect(menu.products).toHaveLength(19);
  for (const path of ['/@fs/app/.env', '/@fs/app/backups/last-success']) {
    const response = await context.request.get(new URL(path, target).href);
    expect(response.status()).toBe(403);
  }
  const page = await context.newPage();
  let connected = false;
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string' && payload.includes('"type":"connected"')) connected = true;
    }),
  );
  await page.goto(target.href);
  await expect(page.locator('.product-card')).toHaveCount(19, { timeout: 30000 });
  await expect.poll(() => connected, { timeout: 15000 }).toBe(true);
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  await appendFile(cssURL, probe);
  probeWritten = true;
  await page.waitForFunction(
    (expected) =>
      getComputedStyle(document.documentElement).getPropertyValue('--codex-hmr-check').trim() ===
      expected,
    marker,
    { timeout: 30000 },
  );
  expect(navigations).toBe(0);
  // Remove only our exact block; preserve any edits made while the check was running.
  await writeFile(cssURL, (await readFile(cssURL, 'utf8')).replace(probe, ''));
  probeWritten = false;
  await page.waitForFunction(
    () =>
      getComputedStyle(document.documentElement).getPropertyValue('--codex-hmr-check').trim() ===
      '',
    undefined,
    { timeout: 30000 },
  );
  expect(navigations).toBe(0);
  console.log(
    'Vite WebSocket connected; source CSS updated and restored without navigation. API/menu preserved; private files blocked. No order or staff mutation.',
  );
} finally {
  if (probeWritten) await writeFile(cssURL, (await readFile(cssURL, 'utf8')).replace(probe, ''));
  await browser.close();
}
