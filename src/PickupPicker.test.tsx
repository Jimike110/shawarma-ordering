import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PickupPicker } from './PickupPicker';
import type { Store, Settings } from './types';
vi.mock('./PickupMap', () => ({ PickupMap: () => <div>Test map</div> }));
const settings: Settings = {
  shop_name: 'Fixture',
  address: 'Первый адрес',
  city: 'Санкт-Петербург',
  phone: '',
  map_url: '',
  hours_note: '',
  paused: false,
  prep_minutes: 15,
  pause_message: '',
  schedule_enabled: false,
  demo_mode: true,
  opening_hours: [],
};
const stores: Store[] = [
  {
    id: 1,
    slug: 'first',
    published: true,
    archived: false,
    owner_stopped: false,
    stop_reason: '',
    settings,
    accepting_orders: true,
    intake_message: '',
  },
  {
    id: 2,
    slug: 'second',
    published: true,
    archived: false,
    owner_stopped: false,
    stop_reason: '',
    settings: {
      ...settings,
      address: 'Второй адрес',
      landmark: 'Метро для теста',
      latitude: 59.94,
      longitude: 30.5,
    },
    accepting_orders: false,
    intake_message: 'Приём на паузе',
  },
];
function mount(choose = vi.fn()) {
  render(
    <MemoryRouter>
      <PickupPicker stores={stores} onChoose={choose} refresh={() => {}} />
    </MemoryRouter>,
  );
  return choose;
}
describe('pickup selection', () => {
  it('previews an address and opens its menu only after confirmation, including missing pins', () => {
    const choose = mount();
    expect(choose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать точку: Первый адрес' }));
    expect(choose).not.toHaveBeenCalled();
    expect(screen.getByText('Метка на карте пока не указана.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Перейти к меню' }));
    expect(choose).toHaveBeenCalledWith(stores[0]);
  });
  it('searches landmarks and keeps unavailable locations labelled and browsable', () => {
    const choose = mount();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Метро для теста' } });
    expect(screen.queryByRole('button', { name: 'Выбрать точку: Первый адрес' })).toBeNull();
    expect(screen.getByText('Приём на паузе')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать точку: Второй адрес' }));
    expect(choose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Перейти к меню' }));
    expect(choose).toHaveBeenCalledWith(stores[1]);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'unknown' } });
    expect(screen.getByText('Точки не найдены')).toBeVisible();
  });
  it('requests geolocation only on a gesture and handles denial', async () => {
    const locate = vi.fn((_ok: PositionCallback, fail: PositionErrorCallback) =>
      fail({ code: 1 } as GeolocationPositionError),
    );
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: locate },
    });
    mount();
    expect(locate).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Рядом со мной' }));
    });
    expect(screen.getByText(/Доступ к геопозиции не разрешён/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Выбрать точку: Первый адрес' })).toBeEnabled();
  });
});
