import { useState, type FormEvent } from 'react';
import { useStaffStore } from '../staff';
import { json, errorMessage } from '../api';
import { Notice } from '../ui';
import type { Settings } from '../types';
export function WorkerSettings({ settings, saved }: { settings: Settings; saved: () => void }) {
  const { request } = useStaffStore();
  const [minutes, setMinutes] = useState(settings.prep_minutes),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccess(false);
    try {
      await request('/operations', { method: 'PATCH', body: json({ prep_minutes: minutes }) });
      saved();
      setSuccess(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel" onSubmit={submit}>
      <h2>Работа смены</h2>
      <p>
        Пауза и доступность товаров меняются в кухне. Цены и часы работы настраивает управляющий или
        владелец.
      </p>
      <label>
        Обычное время приготовления, мин
        <input
          type="number"
          min={1}
          max={120}
          required
          value={minutes}
          onChange={(e) => {
            setMinutes(Number(e.target.value));
            setSuccess(false);
          }}
        />
      </label>
      <div className="time-presets" role="group" aria-label="Время приготовления">
        {[5, 10, 15, 20, 30].map((n) => (
          <button
            type="button"
            key={n}
            aria-pressed={minutes === n}
            onClick={() => {
              setMinutes(n);
              setSuccess(false);
            }}
            disabled={busy}
          >
            {n} мин
          </button>
        ))}
      </div>
      {error && <Notice>{error}</Notice>}
      {success && <Notice kind="success">Время сохранено.</Notice>}
      <button className="button" disabled={busy}>
        Сохранить время
      </button>
    </form>
  );
}
