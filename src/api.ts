export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
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
    const response = await fetch('/api' + path, {
      ...options,
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiError(
        data?.error ?? 'Не удалось выполнить запрос. Попробуйте ещё раз.',
        response.status,
      );
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
