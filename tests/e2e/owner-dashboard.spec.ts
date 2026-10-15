import { test, expect } from './fixtures';
import type { Page, APIRequestContext } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const origin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5173').origin;
async function owner(page: Page, request: APIRequestContext) {
  await page.context().addCookies((await request.storageState()).cookies);
}
async function write(request: APIRequestContext, path: string, data: unknown, method = 'POST') {
  const r = await request.fetch('/api' + path, { method, headers: { Origin: origin }, data });
  expect(r.status(), path).toBeGreaterThanOrEqual(200);
  expect(r.status(), path).toBeLessThan(300);
  return r.json();
}
async function confirm(request: APIRequestContext) {
  await write(request, '/auth/reauthenticate', { password: process.env.E2E_KITCHEN_PASSWORD });
}
async function second(request: APIRequestContext) {
  await confirm(request);
  return write(request, '/owner/stores', {
    slug: 'owner-review-' + Date.now(),
    name: 'Тестовая точка',
    address: 'Тестовый проспект, 12 · ' + Date.now(),
  });
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('owner routes, shared scope and responsive screens survive refresh and Back', async ({
  page,
  request,
}) => {
  const store = await second(request);
  await owner(page, request);
  await mkdir('artifacts/owner-redesign', { recursive: true });
  for (const route of [
    '/owner',
    '/owner/stores',
    '/owner/staff',
    '/owner/analytics',
    '/owner/privacy',
    '/owner/privacy?section=requests',
    '/owner/privacy?section=retention',
  ]) {
    await page.goto(route);
    await expect(page.locator('h1')).toBeVisible();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await fits(page);
      await page.screenshot({
        path: 'artifacts/owner-redesign/' + route.replaceAll(/[/?=]/g, '-') + '-' + width + '.png',
        fullPage: false,
      });
    }
  }
  await page.goto('/owner');
  await page.getByLabel('Точка', { exact: true }).selectOption(String(store.id));
  await page.getByRole('link', { name: 'Сотрудники', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/owner/staff\\?store_id=' + store.id));
  await page.reload();
  await expect(page.getByLabel('Точка', { exact: true })).toHaveValue(String(store.id));
  await page.getByRole('link', { name: 'Аналитика', exact: true }).click();
  await page.getByRole('button', { name: 'История заказов', exact: true }).click();
  await expect(page).toHaveURL(/view=orders/);
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Показатели', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.goto('/owner?store_id=999999');
  await expect(page.getByText('Выбранная точка недоступна. Показаны все точки.')).toBeVisible();
  await expect(page.getByLabel('Точка', { exact: true })).toHaveValue('');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.owner-account summary').click();
  await expect(page.getByRole('link', { name: 'Сменить пароль', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.owner-account summary')).toBeFocused();
});

test('store creation selects its unpublished draft without an unsaved-changes prompt', async ({
  page,
  request,
}) => {
  await confirm(request);
  await owner(page, request);
  await page.goto('/owner/stores');
  page.on('dialog', (d) => {
    throw new Error('Unexpected browser confirmation: ' + d.type());
  });
  await page.getByRole('button', { name: 'Добавить точку', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Новая точка', exact: true });
  await modal.getByLabel('Название', { exact: true }).fill('Новая тестовая');
  await modal.getByLabel('Адрес', { exact: true }).fill('Тестовая улица, 8');
  await modal.getByLabel('Адрес ссылки').fill('new-review-' + Date.now());
  await modal.getByRole('button', { name: 'Создать точку', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page).toHaveURL(/store_id=\d+/);
  await expect(page.getByLabel('Точка', { exact: true })).not.toHaveValue('');
  await expect(page.locator('.owner-store-row')).toHaveCount(1);
  await expect(page.locator('.owner-store-row')).toContainText('Черновик');
});

test('staff editing keeps mixed-store assignments and resumes a frozen change after confirmation', async ({
  page,
  request,
}) => {
  const store = await second(request);
  await confirm(request);
  const issued = await write(request, '/owner/users', {
    username: 'mixed-' + Date.now(),
    display_name: 'Смешанные назначения',
    phone: '',
    email: '',
    active: true,
    owner: false,
    memberships: [
      { store_id: 1, role: 'manager' },
      { store_id: store.id, role: 'worker' },
    ],
  });
  await owner(page, request);
  await page.goto('/owner/staff?store_id=' + store.id);
  const row = page.locator('.owner-staff-row').filter({ hasText: 'Смешанные назначения' });
  await row.locator('summary').click();
  await row.getByRole('button', { name: 'Изменить доступ' }).click();
  const modal = page.getByRole('dialog', { name: 'Доступ сотрудника', exact: true });
  await expect(modal.getByRole('checkbox', { name: /Белорусская/ })).toBeChecked();
  await expect(
    modal.getByRole('checkbox', { name: store.settings.address, exact: true }),
  ).toBeChecked();
  await modal.getByLabel('Имя сотрудника').fill('Сохранённые назначения');
  let calls = 0;
  await page.route('**/api/owner/users/' + issued.user.id, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    calls++;
    const data = route.request().postDataJSON();
    expect(data.memberships).toEqual([
      { store_id: 1, role: 'manager' },
      { store_id: store.id, role: 'worker' },
    ]);
    if (calls === 1)
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Подтвердите пароль.', code: 'reauthentication_required' }),
      });
    return route.continue();
  });
  await modal.getByRole('button', { name: 'Сохранить доступ' }).click();
  const pw = page.getByRole('dialog', { name: 'Подтвердите пароль', exact: true });
  await expect(pw).toBeVisible();
  await pw.getByLabel('Ваш пароль').fill(process.env.E2E_KITCHEN_PASSWORD!);
  await pw.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(modal).not.toBeVisible();
  expect(calls).toBe(2);
  const accounts = await (await request.get('/api/owner/users')).json();
  expect(accounts.find((u: any) => u.id === issued.user.id).memberships).toHaveLength(2);
  await page.getByRole('button', { name: 'Добавить сотрудника', exact: true }).click();
  const newModal = page.getByRole('dialog', { name: 'Новый сотрудник', exact: true });
  await expect(
    newModal.getByRole('checkbox', { name: store.settings.address, exact: true }),
  ).toBeChecked();
});

test('overlapping blockers stay visible and delayed reports never show the previous store', async ({
  page,
  request,
}) => {
  await owner(page, request);
  const base = (await (await request.get('/api/owner/stores')).json())[0];
  const points = [
    {
      ...base,
      id: 101,
      settings: { ...base.settings, address: 'Первая тестовая', paused: true },
      owner_stopped: true,
      stop_reason: 'Проверка стопа',
      accepting_orders: false,
      intake_blockers: ['privacy_unpublished', 'owner_stopped', 'paused', 'outside_hours'],
      counts: { new: 3, preparing: 2, ready: 1, overdue: 2 },
    },
    {
      ...base,
      id: 102,
      settings: { ...base.settings, address: 'Вторая тестовая' },
      accepting_orders: true,
      intake_blockers: [],
      counts: { new: 1, preparing: 0, ready: 0, overdue: 0 },
    },
  ];
  await page.route('**/api/owner/stores', (r) => r.fulfill({ json: points }));
  const report = {
    orders: 123,
    statuses: {},
    completed_value: 4000,
    average_basket: 100,
    preparation_samples: 0,
    ready_samples: 0,
    deadline_samples: 0,
    daily: [],
    products: [],
    stores: [],
  };
  await page.route('**/api/owner/analytics?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('store_id') === '102')
      await new Promise((r) => setTimeout(r, 800));
    await route.fulfill({
      json: {
        ...report,
        orders: new URL(route.request().url()).searchParams.get('store_id') === '102' ? 7 : 123,
      },
    });
  });
  await page.goto('/owner/stores?store_id=101');
  await expect(page.locator('.owner-store-row')).toContainText('Стоп владельца');
  await expect(page.locator('.owner-store-row')).toContainText('Пауза кухни');
  await expect(page.locator('.owner-store-row')).toContainText('Вне часов работы');
  await page.goto('/owner/analytics?store_id=101');
  await expect(page.locator('.report-metrics dd').first()).toHaveText('123');
  await page.getByLabel('Точка', { exact: true }).selectOption('102');
  await expect(page.locator('.report-metrics')).toHaveCount(0);
  await expect(page.locator('.report-metrics dd').first()).toHaveText('7');
  await page.route('**/api/owner/analytics?**', (route) =>
    route.fulfill({ status: 503, json: { error: 'Тестовая потеря связи' } }),
  );
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByText(/Показаны данные на/)).toBeVisible();
  await expect(page.locator('.report-metrics dd').first()).toHaveText('7');
});

test('privacy drafts warn on navigation and remain distinct from published documents', async ({
  page,
  request,
}) => {
  await owner(page, request);
  await page.goto('/owner/privacy');
  const input = page.getByLabel('Полное наименование организации / ФИО ИП');
  const saved = await input.inputValue();
  await input.fill('Несохранённый оператор');
  await expect(page.getByText('Есть несохранённые изменения', { exact: true })).toBeVisible();
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('link', { name: 'Сотрудники', exact: true }).click();
  await expect(input).toHaveValue('Несохранённый оператор');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Обращения', exact: true }).click();
  await expect(page).toHaveURL(/section=requests/);
  await page.getByRole('button', { name: 'Документы', exact: true }).click();
  await expect(input).toHaveValue(saved);
});

test('large lists, archived selection and empty states keep filters in the URL', async ({
  page,
  request,
}) => {
  await owner(page, request);
  const base = (await (await request.get('/api/owner/stores')).json())[0];
  const points = Array.from({ length: 20 }, (_, i) => ({
    ...base,
    id: i + 1,
    settings: { ...base.settings, address: 'Тестовая точка ' + (i + 1) },
    archived: i === 19,
    intake_blockers: i === 19 ? ['archived'] : [],
    accepting_orders: i !== 19,
  }));
  const staff = Array.from({ length: 80 }, (_, i) => ({
    id: 1000 + i,
    username: 'fixture-' + i,
    display_name: i === 0 ? 'Отключённый владелец' : 'Сотрудник ' + i,
    phone: '',
    email: '',
    owner: i === 0,
    active: i !== 0,
    password_required: false,
    last_login_at: null,
    memberships: i === 0 ? [] : [{ store_id: (i % 20) + 1, role: i % 2 ? 'worker' : 'manager' }],
  }));
  await page.route('**/api/owner/stores', (r) => r.fulfill({ json: points }));
  await page.route('**/api/owner/users', (r) => r.fulfill({ json: staff }));
  await page.goto('/owner/stores');
  await expect(page.locator('.owner-store-row')).toHaveCount(19);
  await page.getByLabel('Точка', { exact: true }).selectOption('20');
  await expect(page.locator('.owner-store-row')).toHaveCount(1);
  await expect(page.getByLabel('Состояние')).toHaveValue('archive');
  await page.getByRole('link', { name: 'Сотрудники', exact: true }).click();
  await expect(page.locator('.owner-staff-row')).toHaveCount(5);
  await expect(
    page.locator('.owner-staff-row').filter({ hasText: 'Отключённый владелец' }),
  ).toContainText('Доступ отключён');
  await page.getByLabel('Найти сотрудника').fill('fixture-19');
  await expect(page.locator('.owner-staff-row')).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel('Найти сотрудника')).toHaveValue('fixture-19');
  await page.getByLabel('Найти сотрудника').fill('нет совпадений');
  await expect(
    page.getByText('Сотрудников с такими условиями нет. Проверьте выбранную точку и фильтры.'),
  ).toBeVisible();
  await page.goto('/owner/staff');
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await fits(page);
  }
  await page.route('**/api/owner/stores', (r) => r.fulfill({ json: [] }));
  await page.goto('/owner');
  await expect(
    page.getByText('Пока нет точек. Добавьте первую, чтобы начать работу.'),
  ).toBeVisible();
});
