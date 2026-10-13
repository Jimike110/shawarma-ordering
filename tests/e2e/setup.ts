import { request } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
export default async function setup() {
  const origin = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
  if (!process.env.E2E_KITCHEN_PASSWORD)
    throw new Error(
      'Run the suite in its isolated test stack and bootstrap the fixture owner first.',
    );
  const context = await request.newContext({ baseURL: origin });
  const response = await context.post('/api/auth/login', {
    headers: { Origin: new URL(origin).origin },
    data: {
      username: process.env.E2E_STAFF_USERNAME ?? 'owner',
      password: process.env.E2E_KITCHEN_PASSWORD,
    },
  });
  if (!response.ok()) throw new Error('Fixture owner login failed: ' + response.status());
  await mkdir('artifacts', { recursive: true });
  await context.storageState({ path: 'artifacts/e2e-owner-state.json' });
  await context.dispose();
}
