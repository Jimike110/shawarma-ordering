import { test } from 'node:test';
import assert from 'node:assert/strict';

// Run against the built nginx site, never Vite: production headers are supplied
// by the host. Netlify function response headers have their own packaging test.
const origin = process.env.HEADER_TEST_ORIGIN;
const options = { skip: !origin && 'Set HEADER_TEST_ORIGIN to a built nginx test site.' };

async function html(path) {
  const response = await fetch(new URL(path, origin), {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('content-type'), /text\/html/, path);
  const body = await response.text();
  assert.match(body, /<html/i, path);
  return { headers: response.headers, body };
}

test('ordinary customer and staff pages deny framing', options, async () => {
  for (const path of [
    '/s/belorusskaya-4', '/orders', '/privacy', '/kitchen', '/owner', '/tg-other',
  ]) {
    const { headers, body } = await html(path);
    assert.equal(headers.get('x-frame-options'), 'DENY', path);
    assert.match(headers.get('content-security-policy'), /frame-ancestors 'none'/, path);
    assert.doesNotMatch(body, /telegram-web-app\.js/, path);
  }
});

test('only Telegram customer routes allow Telegram framing and load its SDK', options, async () => {
  for (const path of ['/tg/', '/tg/s/belorusskaya-4', '/tg/order/synthetic']) {
    const { headers, body } = await html(path);
    assert.equal(headers.get('x-frame-options'), null, path);
    const policy = headers.get('content-security-policy');
    assert.match(
      policy,
      /frame-ancestors 'self' https:\/\/web\.telegram\.org https:\/\/\*\.telegram\.org;/,
      path,
    );
    assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/, path);
    assert.match(body, /telegram-web-app\.js/, path);
    assert.match(headers.get('cache-control'), /no-cache/, path);
  }
});
