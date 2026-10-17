import { test as base, expect, request as playwrightRequest } from '@playwright/test';
export const test = base.extend({
  page: async ({ page }, use) => {
    // Existing ordering regressions represent a returning guest. First-visit
    // picker checks explicitly remove this preference before loading the root.
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('e2e-pickup-seeded')) {
        localStorage.setItem('shawarma-pickup-store', 'belorusskaya-4');
        sessionStorage.setItem('e2e-pickup-seeded', '1');
      }
    });
    // Never exercise community tile servers with automated pan/zoom tests.
    await page.route('https://tile.openstreetmap.org/**', (r) => r.abort());
    await use(page);
  },
  request: async ({}, use) => {
    const context = await playwrightRequest.newContext({
      baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
      storageState: 'artifacts/e2e-owner-state.json',
    });
    await use(context);
    await context.dispose();
  },
});
export { expect };
