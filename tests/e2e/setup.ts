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
  const menu = await (await context.get('/api/staff/stores/1/menu')).json();
  if (!menu.settings.address || menu.settings.latitude == null) {
    const configured = await context.put('/api/staff/stores/1/settings', {
      headers: { Origin: new URL(origin).origin },
      data: {
        ...menu.settings,
        address: 'Белорусская ул., 4',
        city: 'Санкт-Петербург',
        latitude: 59.935643,
        longitude: 30.499839,
      },
    });
    if (!configured.ok()) throw new Error('Fixture pickup setup failed: ' + configured.status());
  }
  // Explicit synthetic operator for the disposable stack only; application seeds stay blank.
  const privacy = await (await context.get('/api/owner/privacy')).json();
  if (!privacy.current) {
    const saved = await context.put('/api/owner/privacy/draft', {
      headers: { Origin: new URL(origin).origin },
      data: {
        revision: privacy.revision,
        draft: {
          kind: 'company',
          legal_name: 'Fixture operator — not a real business',
          inn: '1234567890',
          registration: '1234567890123',
          address: 'Isolated test stack',
          contact: 'privacy@example.invalid',
          contractors: 'Local test containers',
          locations: 'Disposable local fixtures only',
          staff_basis: 'Synthetic accounts',
          approved: true,
        },
      },
    });
    if (!saved.ok()) throw new Error('Fixture privacy draft failed: ' + saved.status());
    const state = await saved.json();
    const published = await context.post('/api/owner/privacy/publish', {
      headers: { Origin: new URL(origin).origin },
      data: { revision: state.revision },
    });
    if (!published.ok())
      throw new Error('Fixture privacy publication failed: ' + published.status());
  }
  await mkdir('artifacts', { recursive: true });
  await context.storageState({ path: 'artifacts/e2e-owner-state.json' });
  await context.dispose();
}
