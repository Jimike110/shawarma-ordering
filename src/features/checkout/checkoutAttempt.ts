import { json } from '@/shared/api/client';
import { type Settings } from '@/shared/api/types';
import { type PrivacyChoice } from '@/features/privacy/types';

export interface Attempt {
  key: string;
  shop?: Settings;
  store_slug?: string;
  item_names?: string[];
  payload: {
    store_id?: number;
    name: string;
    note: string;
    privacy?: PrivacyChoice;
    telegram?: { intent_id?: string };
    items: {
      product_id: number;
      quantity: number;
      expected_price: number;
      options?: string[];
    }[];
  };
}

export function readAttempt(storeId: number): Attempt | null {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem('shawarma-attempt-v3:' + storeId) ??
        (storeId === 1 ? sessionStorage.getItem('shawarma-attempt-v2') : null) ??
        'null',
    );
    return saved &&
      typeof saved.key === 'string' &&
      /^[a-f0-9]{48}$/.test(saved.key) &&
      (saved.payload?.store_id === undefined
        ? storeId === 1
        : saved.payload.store_id === storeId) &&
      typeof saved.payload?.name === 'string' &&
      typeof saved.payload?.note === 'string' &&
      Array.isArray(saved.payload?.items) &&
      saved.payload.items.length > 0 &&
      saved.payload.items.length <= 30 &&
      saved.payload.items.every(
        (line: Attempt['payload']['items'][number]) =>
          line &&
          Number.isInteger(line.product_id) &&
          line.product_id > 0 &&
          Number.isInteger(line.quantity) &&
          line.quantity > 0 &&
          line.quantity <= 20 &&
          Number.isInteger(line.expected_price) &&
          line.expected_price > 0 &&
          (line.options === undefined ||
            (Array.isArray(line.options) &&
              line.options.every((id) => typeof id === 'string'))),
      )
      ? {
          ...saved,
          shop: safeShop(saved.shop),
          item_names:
            Array.isArray(saved.item_names) &&
            saved.item_names.every((n: unknown) => typeof n === 'string')
              ? saved.item_names
              : undefined,
          payload: { ...saved.payload, store_id: storeId },
        }
      : null;
  } catch {
    return null;
  }
}

export function persist(attempt: Attempt | null, storeId: number) {
  try {
    if (attempt) sessionStorage.setItem('shawarma-attempt-v3:' + storeId, json(attempt));
    else sessionStorage.removeItem('shawarma-attempt-v3:' + storeId);
    if (storeId === 1) sessionStorage.removeItem('shawarma-attempt-v2');
  } catch {}
}

function safeShop(value: unknown): Settings | undefined {
  if (!value || typeof value !== 'object') return;
  const s = value as Settings;
  if (
    !['shop_name', 'address', 'city', 'phone', 'hours_note', 'map_url', 'pause_message'].every(
      (k) => typeof s[k as keyof Settings] === 'string',
    ) ||
    !Number.isInteger(s.prep_minutes)
  )
    return;
  return {
    ...s,
    map_url: /^https:\/\//i.test(s.map_url) ? s.map_url : '',
    opening_hours: Array.isArray(s.opening_hours)
      ? s.opening_hours.filter(
          (h) =>
            h &&
            Number.isInteger(h.day) &&
            h.day >= 0 &&
            h.day <= 6 &&
            /^\d{2}:\d{2}$/.test(h.open) &&
            /^\d{2}:\d{2}$/.test(h.close),
        )
      : [],
  };
}

export function pendingAtSlug(slug: string): Attempt | null {
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key?.startsWith('shawarma-attempt-v3:')) continue;
      const id = Number(key.slice('shawarma-attempt-v3:'.length));
      if (!Number.isSafeInteger(id) || id < 1) continue;
      const attempt = readAttempt(id);
      if (attempt?.store_slug === slug && attempt.shop) return attempt;
    }
  } catch {}
  return null;
}
