import { test, expect } from './fixtures';
import { createHash } from 'node:crypto';

test('kitchen plays the selected local recording with default sound and mute/reload controls', async ({
  page,
  request,
}) => {
  await page.context().addCookies((await request.storageState()).cookies);
  await page.addInitScript(() => {
    const state = { starts: 0, playingState: '', duration: 0, hasSamples: false, stops: 0 };
    (window as any).__kitchenAudio = state;
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = create.call(this),
        start = source.start.bind(source),
        stop = source.stop.bind(source);
      source.start = (when?: number) => {
        state.starts++;
        state.playingState = this.state;
        state.duration = source.buffer?.duration ?? 0;
        state.hasSamples = source.buffer?.getChannelData(0).some((sample) => sample !== 0) ?? false;
        start(when);
      };
      source.stop = (when?: number) => {
        state.stops++;
        stop(when);
      };
      return source;
    };
  });
  let orders: object[] = [];
  await page.route('**/api/staff/stores/1/orders', (route) => route.fulfill({ json: orders }));
  const audioDownload = page.waitForResponse((r) =>
    r.url().endsWith('/audio/new-order-313025.mp3'),
  );
  await page.goto('/staff/stores/1');
  const recording = await audioDownload;
  expect(recording.status()).toBe(200);
  expect(
    createHash('sha256')
      .update(await recording.body())
      .digest('hex'),
  ).toBe('aa17913b1c955243a72735aec0f778fc9260b3f9696f5f675d0e73faba176e58');
  const sound = page.locator('[data-kitchen-sound]');
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Здесь пока тихо', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__kitchenAudio.starts)).toBe(0);
  // Any ordinary kitchen action activates audio: no explicit sound toggle needed.
  await page.getByRole('button', { name: 'Обновить кухню', exact: true }).click();
  await expect(sound).toHaveText('Звук включён');
  const now = new Date().toISOString();
  orders = [
    {
      id: 99001,
      number: 99001,
      store_id: 1,
      status: 'new',
      name: 'Тест звука',
      items: [{ product_id: 1, name: 'Тестовый товар', price: 300, quantity: 1 }],
      total: 300,
      created_at: now,
      updated_at: now,
      estimated_ready_at: new Date(Date.now() + 900000).toISOString(),
    },
  ];
  await page.getByRole('button', { name: 'Обновить кухню', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__kitchenAudio.starts)).toBe(1);
  expect(await page.evaluate(() => (window as any).__kitchenAudio.playingState)).toBe('running');
  const decoded = await page.evaluate(() => (window as any).__kitchenAudio);
  expect(decoded.duration).toBeGreaterThan(2);
  expect(decoded.duration).toBeLessThan(5);
  expect(decoded.hasSamples).toBe(true);
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => (window as any).__kitchenAudio.stops)).toBe(1);
  orders = [...orders, { ...orders[0], id: 99002, number: 99002 }];
  await page.getByRole('button', { name: 'Обновить кухню', exact: true }).click();
  await expect(page.locator('.kitchen-order')).toHaveCount(2);
  expect(await page.evaluate(() => (window as any).__kitchenAudio.starts)).toBe(1);
  await page.reload();
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
});
