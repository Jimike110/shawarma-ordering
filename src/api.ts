export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
let staffRefresh: Promise<boolean> | null = null;
async function refreshStaffSession() {
  if (!staffRefresh) {
    staffRefresh = (async () => {
      const c = new AbortController();
      const timer = setTimeout(() => c.abort(), 6000);
      try {
        const r = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal: c.signal,
        });
        if (r.status >= 500 || r.status === 429)
          throw new Error('Не удалось продлить вход. Проверьте связь и повторите запрос.');
        return r.status === 200;
      } finally {
        clearTimeout(timer);
      }
    })().finally(() => {
      staffRefresh = null;
    });
  }
  return staffRefresh;
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
    12000,
  );
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  try {
    const request = () =>
      fetch('/api' + path, {
        ...options,
        credentials: 'same-origin',
        cache: 'no-store',
        headers,
        signal: controller.signal,
      });
    let response = await request();
    const staffPath = /^(\/(staff|owner|kitchen)\/|\/auth\/(me|logout|change-password)$)/.test(
      path,
    );
    if (
      response.status === 401 &&
      staffPath &&
      !controller.signal.aborted &&
      (await refreshStaffSession())
    )
      response = await request();
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (
        response.status === 401 &&
        /^(\/(staff|owner)\/|\/auth\/(me|logout|change-password)$)/.test(path)
      )
        window.dispatchEvent(new Event('staff-session-expired'));
      throw new ApiError(
        data?.error ?? 'Не удалось выполнить запрос. Попробуйте ещё раз.',
        response.status,
        data?.code,
      );
    }
    if (data === null) throw new Error('Сервер вернул некорректный ответ.');
    return data as T;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
export const json = (value: unknown) => JSON.stringify(value);
export const errorMessage = (error: unknown) =>
  error instanceof TypeError
    ? 'Нет связи с сервером. Проверьте интернет.'
    : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      ? 'Сервер не ответил вовремя. Попробуйте ещё раз.'
      : error instanceof Error
        ? error.message
        : 'Не удалось подключиться. Проверьте интернет.';
