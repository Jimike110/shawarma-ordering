import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeTelegramFunctions } from './telegram-functions.mjs';
import { createServer } from 'vite';

test('Vite serves the Telegram entry on direct customer routes without changing the ordinary entry', async () => {
  const server = await createServer({
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    optimizeDeps: { noDiscovery: true, include: [], entries: [] },
  });
  try {
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    const origin = 'http://127.0.0.1:' + address.port;
    const telegram = await (await fetch(origin + '/tg/s/example/checkout')).text();
    assert.match(telegram, /\/src\/app\/telegram\.tsx/);
    assert.match(telegram, /telegram-storage\.js/);
    const ordinary = await (await fetch(origin + '/')).text();
    assert.match(ordinary, /\/src\/app\/main\.tsx/);
    assert.doesNotMatch(ordinary, /telegram-web-app\.js/);
  } finally {
    await server.close();
  }
});

test('Telegram HTML headers are narrow; scheduled dispatch is opt-in and secrets stay runtime-only', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'telegram-functions-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'dist/tg'), { recursive: true });
  writeFileSync(path.join(root, 'dist/tg/index.html'), '<html>synthetic</html>');
  writeTelegramFunctions(root);
  const target = path.join(root, 'netlify/functions/telegram-dispatch.mjs');
  assert.equal(existsSync(target), false);
  const entry = await import(
    pathToFileURL(path.join(root, 'netlify/functions/telegram-entry.mjs'))
  );
  const response = await entry.default();
  assert.equal(await response.text(), '<html>synthetic</html>');
  assert.equal(response.headers.get('X-Frame-Options'), null);
  assert.match(response.headers.get('Content-Security-Policy'), /https:\/\/web.telegram.org/);
  assert.equal(response.headers.get('Cache-Control'), 'no-cache');
  writeTelegramFunctions(root, true);
  const scheduled = await import(pathToFileURL(target));
  assert.equal(scheduled.config.schedule, '* * * * *');
  const previous = {
    origin: process.env.PUBLIC_ORIGIN,
    secret: process.env.TELEGRAM_DISPATCH_SECRET,
    enabled: process.env.TELEGRAM_ENABLED,
    fetch: globalThis.fetch,
  };
  t.after(() => {
    for (const [name, value] of Object.entries({
      PUBLIC_ORIGIN: previous.origin,
      TELEGRAM_DISPATCH_SECRET: previous.secret,
      TELEGRAM_ENABLED: previous.enabled,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    globalThis.fetch = previous.fetch;
  });
  process.env.TELEGRAM_ENABLED = 'true';
  process.env.PUBLIC_ORIGIN = 'https://synthetic.example.invalid';
  process.env.TELEGRAM_DISPATCH_SECRET = 'synthetic-runtime-secret';
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url.href, 'https://synthetic.example.invalid/api/internal/telegram-dispatch');
    assert.equal(init.headers.Authorization, 'Bearer synthetic-runtime-secret');
    assert.equal(init.redirect, 'error');
    return new Response(null, { status: 200 });
  };
  assert.equal((await scheduled.default()).status, 204);
  assert.equal(calls, 1);
  assert.doesNotMatch(readFileSync(target, 'utf8'), /synthetic-runtime-secret/);
  process.env.PUBLIC_ORIGIN = 'http://insecure.invalid';
  await assert.rejects(scheduled.default(), /HTTPS/);
  assert.equal(calls, 1);
  writeTelegramFunctions(root, false);
  assert.equal(existsSync(target), false);
});
