import { describe, it, expect } from 'vitest';
import {
  distanceMetres,
  distanceLabel,
  directionsURL,
  storeCoordinates,
  todayHours,
} from '@/features/locations/pickupLocation';
import { preferredPickup, rememberPickup } from '@/features/locations/PickupStoresProvider';
import { type Settings, type Store } from '@/shared/api/types';

const settings: Settings = {
  shop_name: 'Fixture',
  address: 'Тестовый адрес',
  city: 'Санкт-Петербург',
  phone: '',
  map_url: '',
  hours_note: '',
  paused: false,
  prep_minutes: 15,
  pause_message: '',
  schedule_enabled: true,
  demo_mode: true,
  opening_hours: [{ day: 6, open: '11:00', close: '02:00' }],
};

describe('pickup locations', () => {
  it('does not silently choose the first store or restore a missing one', () => {
    localStorage.clear();
    const stores = [{ id: 1, slug: 'one', settings }] as Store[];
    expect(preferredPickup(stores)).toBeUndefined();
    rememberPickup('missing');
    expect(preferredPickup(stores)).toBeUndefined();
    rememberPickup('one');
    expect(preferredPickup(stores)?.id).toBe(1);
    localStorage.clear();
  });
  it('requires a complete finite coordinate pair, preserving real zero coordinates', () => {
    expect(storeCoordinates(settings)).toBeNull();
    expect(storeCoordinates({ ...settings, latitude: 59 })).toBeNull();
    expect(storeCoordinates({ ...settings, latitude: NaN, longitude: 30 })).toBeNull();
    expect(storeCoordinates({ ...settings, latitude: 91, longitude: 30 })).toBeNull();
    expect(storeCoordinates({ ...settings, latitude: 0, longitude: 0 })).toEqual({
      latitude: 0,
      longitude: 0,
    });
  });
  it('labels geographical distance honestly and produces a destination-only walking route', () => {
    const a = { latitude: 59.935643, longitude: 30.499839 };
    expect(distanceMetres(a, a)).toBe(0);
    expect(
      distanceMetres({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }),
    ).toBeCloseTo(111195, -1);
    expect(distanceLabel(1230)).toContain('по прямой');
    const link = directionsURL({ settings: { ...settings, ...a } } as Store)!;
    expect(link).toContain('yandex.ru/maps/');
    expect(new URL(link).searchParams.get('rtext')).toBe('~59.935643,30.499839');
    expect(
      directionsURL({ settings: { ...settings, map_url: 'javascript:alert(1)' } } as Store),
    ).toBeNull();
  });
  it('uses Moscow dates and handles a previous day overnight opening', () => {
    expect(todayHours(settings, new Date('2026-10-17T09:00:00Z'))).toBe(
      'Сегодня 11:00–02:00 следующего дня',
    );
    expect(todayHours(settings, new Date('2026-10-17T22:00:00Z'))).toBe('Открыто до 02:00');
    expect(todayHours(settings, new Date('2026-10-18T12:00:00Z'))).toBe('Сегодня выходной');
  });
});
