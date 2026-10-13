import { loadEnvFile } from 'node:process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
const target = new URL(process.env.LOCAL_API_URL ?? 'http://localhost:5173');
if (!['localhost', '127.0.0.1', 'web'].includes(target.hostname))
  throw new Error(
    'This setup script only supports the local app. Use Kitchen → Settings for a hosted app.',
  );
const storeId = Number(process.env.STORE_ID);
if (
  !Number.isSafeInteger(storeId) ||
  storeId < 1 ||
  !process.env.STAFF_USERNAME ||
  !process.env.STAFF_PASSWORD
)
  throw new Error(
    'Provide STORE_ID, STAFF_USERNAME and STAFF_PASSWORD explicitly, or use the store settings screen.',
  );
const config = JSON.parse(await readFile(new URL('../config/shop.json', import.meta.url), 'utf8'));
let cookie = '';
async function call(path, method = 'GET', body) {
  const response = await fetch(new URL('/api/' + path, target), {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: process.env.PUBLIC_ORIGIN,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error('Shop configuration request failed: HTTP ' + response.status);
  return response;
}
try {
  const login = await call('auth/login', 'POST', {
    username: process.env.STAFF_USERNAME,
    password: process.env.STAFF_PASSWORD,
  });
  cookie =
    login.headers
      .getSetCookie()
      .find((value) => value.startsWith('staff_session='))
      ?.split(';')[0] ?? '';
  if (!cookie) throw new Error('Kitchen session was not established.');
  const menu = await (await call(`staff/stores/${storeId}/menu`)).json();
  await call(`staff/stores/${storeId}/settings`, 'PUT', { ...menu.settings, ...config });
  console.log('Configured Я люблю шаверму · Белорусская ул., 4 · daily 09:00–22:00 Moscow time.');
} finally {
  if (cookie) await call('auth/logout', 'POST', {}).catch(() => {});
}
