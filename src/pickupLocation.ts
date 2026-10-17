import type { Settings, Store } from './types';

export type Coordinates = { latitude: number; longitude: number };
export function storeCoordinates(settings: Settings): Coordinates | null {
  const { latitude, longitude } = settings;
  return typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    Math.abs(longitude) <= 180
    ? { latitude, longitude }
    : null;
}
export function distanceMetres(a: Coordinates, b: Coordinates): number {
  const rad = (v: number) => (v * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude),
    dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)));
}
export function distanceLabel(metres: number): string {
  if (metres < 10) return 'Менее 10 м по прямой';
  return metres < 1000
    ? `${Math.max(10, Math.round(metres / 10) * 10)} м по прямой`
    : `${(metres / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} км по прямой`;
}
export function pointCountLabel(count: number): string {
  const forms = { one: 'точка', few: 'точки', many: 'точек', other: 'точки' };
  return `${count} ${forms[new Intl.PluralRules('ru').select(count) as keyof typeof forms]}`;
}
export function directionsURL(store: Store): string | null {
  const coords = storeCoordinates(store.settings);
  if (coords)
    return (
      'https://yandex.ru/maps/?' +
      new URLSearchParams({ rtext: `~${coords.latitude},${coords.longitude}`, rtt: 'pd' })
    );
  const url = store.settings.map_url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) return parsed.href;
  } catch {
    /* No verified route link. */
  }
  return null;
}
export function todayHours(settings: Settings, now = new Date()): string {
  if (!settings.schedule_enabled) return settings.hours_note || 'Часы работы уточняйте в точке';
  const msk = new Date(now.getTime() + 3 * 60 * 60 * 1000),
    day = msk.getUTCDay();
  const clock =
    String(msk.getUTCHours()).padStart(2, '0') + ':' + String(msk.getUTCMinutes()).padStart(2, '0');
  const previous = settings.opening_hours.find(
    (h) => h.day === (day + 6) % 7 && h.open > h.close && clock < h.close,
  );
  if (previous) return 'Открыто до ' + previous.close;
  const hours = settings.opening_hours.find((h) => h.day === day);
  return hours
    ? `Сегодня ${hours.open}–${hours.close}${hours.open > hours.close ? ' следующего дня' : ''}`
    : 'Сегодня выходной';
}
