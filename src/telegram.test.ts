import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  inTelegramEntry,
  requestTelegramMessages,
  resetTelegramSession,
  telegramToken,
} from './telegram';

afterEach(() => {
  resetTelegramSession();
  window.history.replaceState({}, '', '/');
  delete window.Telegram;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function launch(granted = true) {
  window.history.replaceState({}, '', '/tg/');
  window.Telegram = {
    WebApp: {
      initData: 'signed-launch-fixture',
      isVersionAtLeast: () => true,
      requestWriteAccess: (cb: (ok: boolean) => void) => cb(granted),
      ready() {},
      expand() {},
      onEvent() {},
      offEvent() {},
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
    },
  };
}
describe('Telegram customer sessions', () => {
  it('does not authenticate ordinary browsing or request permission automatically', () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(inTelegramEntry()).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('deduplicates session creation and keeps its token out of storage', async () => {
    launch();
    const sessionStorageSpy = vi.spyOn(Storage.prototype, 'setItem');
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          token: 'opaque-session',
          expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    expect(await Promise.all([telegramToken(), telegramToken()])).toEqual([
      'opaque-session',
      'opaque-session',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].credentials).toBe('omit');
    expect(sessionStorageSpy).not.toHaveBeenCalled();
  });
  it('renews an expired memory session without saving raw initData', async () => {
    launch();
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            token: 'temporary',
            expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
          }),
          { status: 201 },
        ),
    );
    vi.stubGlobal('fetch', fetcher);
    await telegramToken();
    vi.setSystemTime(Date.now() + 31 * 60000);
    await telegramToken();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('honours declined messaging permission and does not attempt login', async () => {
    launch(false);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(await requestTelegramMessages()).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('replaces the memory session when Telegram launch identity changes', async () => {
    launch();
    const fetcher = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              token: 'session-' + fetcher.mock.calls.length,
              expires_at: new Date(Date.now() + 1800000).toISOString(),
            }),
            { status: 201 },
          ),
      );
    vi.stubGlobal('fetch', fetcher);
    expect(await telegramToken()).toBe('session-1');
    window.Telegram!.WebApp!.initData = 'another-signed-launch';
    expect(await telegramToken()).toBe('session-2');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
