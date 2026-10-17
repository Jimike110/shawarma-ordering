import { api, json } from '@/shared/api/client';

interface TelegramWebApp {
  initData: string;
  colorScheme?: string;
  safeAreaInset?: { top: number; bottom: number };
  contentSafeAreaInset?: { top: number; bottom: number };
  ready(): void;
  expand(): void;
  isVersionAtLeast(version: string): boolean;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  requestWriteAccess?(callback: (granted: boolean) => void): void;
  onEvent(name: string, callback: () => void): void;
  offEvent(name: string, callback: () => void): void;
  BackButton: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const inTelegramEntry = () => /^\/tg(?:\/|$)/.test(window.location.pathname);

export const telegramApp = () => (inTelegramEntry() ? window.Telegram?.WebApp : undefined);

let session: { token: string; expires_at: string } | null = null;

let opening: Promise<string> | null = null;

let launchData = '';

let generation = 0;

let sessionRequest: AbortController | null = null;

export function resetTelegramSession() {
  generation++;
  sessionRequest?.abort();
  sessionRequest = null;
  launchData = '';
  session = null;
  opening = null;
}

export async function telegramToken(): Promise<string> {
  const app = telegramApp();
  if (!app?.initData)
    throw new Error('Откройте приложение через кнопку «Заказать» в Telegram.');
  if (launchData !== app.initData) {
    resetTelegramSession();
    launchData = app.initData;
  }
  if (session && Date.parse(session.expires_at) > Date.now() + 5000) return session.token;
  if (!opening) {
    const currentGeneration = generation;
    sessionRequest = new AbortController();
    opening = api<{ token: string; expires_at: string }>('/telegram/session', {
      method: 'POST',
      body: json({ init_data: app.initData }),
      credentials: 'omit',
      signal: sessionRequest.signal,
    })
      .then((value) => {
        if (generation !== currentGeneration)
          throw new Error('Вход Telegram изменился. Откройте заказ заново.');
        session = value;
        return value.token;
      })
      .finally(() => {
        if (generation === currentGeneration) {
          opening = null;
          sessionRequest = null;
        }
      });
  }
  return opening;
}

export async function telegramHeaders() {
  return { Authorization: 'Bearer ' + (await telegramToken()) };
}

export function requestTelegramMessages(): Promise<boolean> {
  const app = telegramApp();
  if (!app?.initData || !app.isVersionAtLeast('6.9') || !app.requestWriteAccess)
    return Promise.resolve(false);
  return new Promise((resolve) => app.requestWriteAccess!(resolve));
}

export function telegramClosingConfirmation(dirty: boolean) {
  const app = telegramApp();
  if (!app?.isVersionAtLeast('6.2')) return;
  if (dirty) app.enableClosingConfirmation?.();
  else app.disableClosingConfirmation?.();
}

export interface TelegramConfig {
  ready: boolean;
  bot_username: string;
}
