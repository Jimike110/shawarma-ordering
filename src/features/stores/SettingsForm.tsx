import { useStaffStore } from '@/features/auth/storeContext';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, errorMessage, json } from '@/shared/api/client';
import { Notice } from '@/shared/ui/Feedback';
import { type Settings } from '@/shared/api/types';
import { TimePresets } from '@/features/kitchen/TimePresets';

export function SettingsForm({
  settings,
  saved,
  expired,
}: {
  settings: Settings;
  saved: () => void;
  expired: () => void;
}) {
  const { request: api } = useStaffStore();
  const [value, setValue] = useState(settings),
    [dirty, setDirty] = useState(false);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState(false);
  useEffect(() => {
    if (!dirty) setValue(settings);
  }, [settings]);
  const change = (next: Settings) => {
    setValue(next);
    setDirty(true);
    setSuccess(false);
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<Settings>('/kitchen/settings', {
        method: 'PUT',
        body: json(value),
      });
      setValue(result);
      setDirty(false);
      setSuccess(true);
      saved();
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 401) expired();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel settings-form" onSubmit={submit}>
      <fieldset className="form-fields" disabled={busy}>
        <h2>Приём заказов</h2>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={value.paused}
            onChange={(e) => change({ ...value, paused: e.target.checked })}
          />
          Приостановить новые заказы
        </label>
        <p className="muted">Существующие заказы остаются в очереди.</p>
        <label>
          Базовое время приготовления, мин
          <input
            type="number"
            min={1}
            max={120}
            required
            value={value.prep_minutes}
            onChange={(e) => change({ ...value, prep_minutes: Number(e.target.value) })}
          />
        </label>
        <TimePresets
          value={value.prep_minutes}
          label="Базовое время приготовления"
          disabled={busy}
          onChange={(minutes) => change({ ...value, prep_minutes: minutes })}
        />
        <p className="field-hint">
          Выберите время или введите своё, затем сохраните настройки.
        </p>
        <label>
          Сообщение во время паузы
          <textarea
            rows={3}
            maxLength={300}
            value={value.pause_message}
            onChange={(e) => change({ ...value, pause_message: e.target.value })}
          />
        </label>
        <h2>Информация о заведении</h2>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={value.demo_mode ?? true}
            onChange={(e) => change({ ...value, demo_mode: e.target.checked })}
          />
          Демонстрационное меню и цены
        </label>
        <label>
          Название
          <input
            maxLength={100}
            value={value.shop_name ?? ''}
            onChange={(e) => change({ ...value, shop_name: e.target.value })}
          />
        </label>
        <label>
          Адрес самовывоза
          <input
            maxLength={200}
            value={value.address ?? ''}
            onChange={(e) => change({ ...value, address: e.target.value })}
          />
        </label>
        <label>
          Город
          <input
            maxLength={100}
            value={value.city ?? ''}
            onChange={(e) => change({ ...value, city: e.target.value })}
          />
        </label>
        <label>
          Телефон
          <input
            type="tel"
            maxLength={50}
            value={value.phone ?? ''}
            onChange={(e) => change({ ...value, phone: e.target.value })}
          />
        </label>
        <label>
          Ссылка на карту
          <input
            type="url"
            maxLength={1000}
            value={value.map_url ?? ''}
            placeholder="https://…"
            onChange={(e) => change({ ...value, map_url: e.target.value })}
          />
        </label>
        <fieldset className="pickup-location-editor">
          <legend>Расположение для гостей</legend>
          <p className="field-hint">
            Укажите проверенные координаты входа. Без координат точка останется в списке, но не
            будет показана меткой на карте.
          </p>
          <div className="form-row">
            <label>
              Широта
              <input
                type="number"
                min={-90}
                max={90}
                step="any"
                value={value.latitude ?? ''}
                placeholder="59.935643"
                onChange={(e) =>
                  change({
                    ...value,
                    latitude: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Долгота
              <input
                type="number"
                min={-180}
                max={180}
                step="any"
                value={value.longitude ?? ''}
                placeholder="30.499839"
                onChange={(e) =>
                  change({
                    ...value,
                    longitude: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <label>
            Метро или ориентир
            <input
              maxLength={150}
              value={value.landmark ?? ''}
              onChange={(e) => change({ ...value, landmark: e.target.value })}
            />
          </label>
          <label>
            Как найти вход
            <textarea
              maxLength={300}
              rows={2}
              value={value.entrance ?? ''}
              onChange={(e) => change({ ...value, entrance: e.target.value })}
            />
          </label>
        </fieldset>
        <label>
          Примечание о часах работы
          <input
            maxLength={250}
            value={value.hours_note ?? ''}
            onChange={(e) => change({ ...value, hours_note: e.target.value })}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={value.schedule_enabled ?? false}
            onChange={(e) => change({ ...value, schedule_enabled: e.target.checked })}
          />
          Принимать заказы по расписанию
        </label>
        <p className="muted">
          Время московское. Ночные смены заканчиваются на следующий день. Без расписания приём
          управляется кнопкой паузы.
        </p>
        {value.schedule_enabled && (
          <>
            <button
              type="button"
              className="button secondary small schedule-copy"
              disabled={!value.opening_hours?.some((h) => h.day === 1)}
              onClick={() => {
                const monday = value.opening_hours.find((h) => h.day === 1);
                if (monday)
                  change({
                    ...value,
                    opening_hours: [1, 2, 3, 4, 5, 6, 0].map((day) => ({ ...monday, day })),
                  });
              }}
            >
              Как в понедельник — на всю неделю
            </button>
            <div className="schedule-editor">
              {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                const hours = value.opening_hours?.find((h) => h.day === day),
                  label = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][day];
                const setHours = (open: string, close: string) =>
                  change({
                    ...value,
                    opening_hours: [
                      ...(value.opening_hours ?? []).filter((h) => h.day !== day),
                      { day, open, close },
                    ],
                  });
                return (
                  <div className="schedule-row" key={day}>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={!!hours}
                        onChange={(e) =>
                          e.target.checked
                            ? setHours('09:00', '22:00')
                            : change({
                                ...value,
                                opening_hours: value.opening_hours.filter((h) => h.day !== day),
                              })
                        }
                      />
                      {label}
                    </label>
                    <input
                      aria-label={'Открытие ' + label}
                      type="time"
                      disabled={!hours}
                      required={!!hours}
                      value={hours?.open ?? ''}
                      onChange={(e) => setHours(e.target.value, hours!.close)}
                    />
                    <span>—</span>
                    <input
                      aria-label={'Закрытие ' + label}
                      type="time"
                      disabled={!hours}
                      required={!!hours}
                      value={hours?.close ?? ''}
                      onChange={(e) => setHours(hours!.open, e.target.value)}
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}
        {error && <Notice>{error}</Notice>}
        {success && <Notice kind="success">Настройки сохранены.</Notice>}
        <div className="editor-actions">
          <span className="field-hint">
            {dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены'}
          </span>
          <button className="button">{busy ? 'Сохраняем…' : 'Сохранить настройки'}</button>
        </div>
      </fieldset>
    </form>
  );
}
