import { test as base, expect, request as playwrightRequest } from '@playwright/test';
export const test = base.extend({
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
