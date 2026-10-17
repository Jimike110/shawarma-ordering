import { useAuth } from '../auth';
import { nativeKitchenAction, useNativeKitchen } from '../nativeKitchen';
import { useKitchenHealth } from '../useKitchenHealth';
import { KitchenBoard } from './KitchenBoard';
import { KitchenDialog } from './KitchenDialog';
import { ToppingsPanel } from './ToppingsPanel';
import '../kitchen.css';
import { useStaffStore } from '../staffStore';
import { WorkerSettings } from './WorkerSettings';
import { useKitchenSound } from '../useKitchenSound';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Clock3,
  Pause,
  Play,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  UtensilsCrossed,
  Check,
  Volume2,
  VolumeX,
  Trash2,
  HomeIcon,
  Home,
  Flame,
} from 'lucide-react';
import { ApiError, errorMessage, json } from '../api';
import { usePolling } from '../usePolling';
import { FoodImage, Loading, Notice } from '../ui';
import { useMenu } from '../menu';
import { randomKey } from '../requestKey';
import {
  clock,
  rub,
  statusLabels,
  type Order,
  type Product,
  type Settings,
  type Status,
} from '../types';
import { Link } from 'react-router-dom';
const nextStatus: Partial<Record<Status, Status>> = {
  new: 'preparing',
  preparing: 'ready',
  ready: 'completed',
};
const actionLabels: Partial<Record<Status, string>> = {
  new: 'Начать готовить',
  preparing: 'Заказ готов',
  ready: 'Выдать заказ',
};
const preparationTimes = [5, 10, 15, 20, 30];
function KitchenControls({ children, section }: { children: ReactNode; section: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    ref.current?.removeAttribute('open');
  }, [section]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target))
        ref.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return (
    <details
      className="kitchen-controls"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          ref.current?.removeAttribute('open');
          ref.current?.querySelector('summary')?.focus();
        }
      }}
    >
      <summary aria-label="Управление кухней">
        <SlidersHorizontal size={21} />
      </summary>
      <div className="kitchen-controls-menu">{children}</div>
    </details>
  );
}
function PauseDialog({
  reason,
  setReason,
  busy,
  close,
  submit,
}: {
  reason: string;
  setReason: (s: string) => void;
  busy: boolean;
  close: () => void;
  submit: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const restore = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      restore?.focus();
    };
  }, []);
  return (
    <dialog
      className="admin-modal"
      ref={ref}
      aria-label="Пауза приёма заказов"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2>Пауза приёма заказов</h2>
        <p>Активные заказы останутся в работе. Причину увидит владелец.</p>
        <label>
          Причина паузы
          <textarea
            autoFocus
            required
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div className="form-actions">
          <button className="button" disabled={busy}>
            Приостановить
          </button>
          <button type="button" className="button secondary" disabled={busy} onClick={close}>
            Назад
          </button>
        </div>
      </form>
    </dialog>
  );
}
function TimePresets({
  value,
  onChange,
  disabled = false,
  label,
  values = preparationTimes,
  extra,
}: {
  value: number;
  onChange: (minutes: number) => void;
  disabled?: boolean;
  label: string;
  values?: readonly number[];
  extra?: ReactNode;
}) {
  return (
    <div className="time-presets" role="group" aria-label={label}>
      {values.map((minutes) => (
        <button
          type="button"
          key={minutes}
          disabled={disabled}
          aria-pressed={value === minutes}
          onClick={() => onChange(minutes)}
        >
          {minutes} мин
        </button>
      ))}
      {extra}
    </div>
  );
}
function OrderCard({
  order,
  reload,
  expired,
}: {
  order: Order;
  reload: () => void;
  expired: () => void;
}) {
  const { request: api } = useStaffStore();
  const [minutes, setMinutes] = useState(
    Math.max(
      1,
      Math.min(120, Math.ceil((Date.parse(order.estimated_ready_at) - Date.now()) / 60000)),
    ),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false),
    [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [customTime, setCustomTime] = useState(false);
  const closed = order.status === 'completed' || order.status === 'cancelled';
  const overdue =
    !closed && order.status !== 'ready' && Date.now() > Date.parse(order.estimated_ready_at);
  async function update(value: object) {
    if (busy) return;
    setBusy(true);
    setError('');
    setConfirmation('');
    try {
      await api('/kitchen/orders/' + order.id, { method: 'PATCH', body: json(value) });
      if ('eta_minutes' in value) {
        setConfirmation('Время готовности обновлено');
        setCustomTime(false);
      }
      reload();
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 401) expired();
      if (e instanceof ApiError && e.status === 409) {
        setError('Заказ уже изменён на другом устройстве. Обновляем очередь.');
        reload();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className={'kitchen-order ' + (overdue ? 'overdue' : '')}>
      <div className="kitchen-order-top">
        <strong>№{order.number}</strong>
        <span className={'status-badge status-' + order.status}>{statusLabels[order.status]}</span>
        <small>{clock(order.created_at)}</small>
      </div>
      <h3>{order.name}</h3>
      {overdue && <div className="overdue-label">Опаздываем · обновите время готовности</div>}
      {order.items.map((item, i) => (
        <div key={i} className="kitchen-item">
          <span>
            {item.quantity} × {item.name}
            {item.portion && <span className="receipt-options">{item.portion}</span>}
            {!!item.options?.length && (
              <small className="receipt-options">
                {item.options.map((o) => o.label + (o.portion ? ' · ' + o.portion : '')).join(', ')}
              </small>
            )}
          </span>
          <b>{rub(item.price * item.quantity)}</b>
        </div>
      ))}
      {order.note && <p className="order-note">{order.note}</p>}
      {order.cancellation_reason && (
        <p className="order-note">Причина отмены: {order.cancellation_reason}</p>
      )}
      <div className="kitchen-order-meta">
        <span>
          <Clock3 size={15} /> К {clock(order.estimated_ready_at)}
        </span>
        <b>{rub(order.total)}</b>
      </div>
      {!closed && (
        <>
          <button
            className="button full"
            disabled={busy}
            onClick={() => void update({ status: nextStatus[order.status] })}
          >
            {busy ? 'Сохраняем…' : actionLabels[order.status]}
          </button>
          {order.status !== 'ready' && (
            <form
              className="eta-form"
              onSubmit={(e) => {
                e.preventDefault();
                void update({ eta_minutes: minutes });
              }}
            >
              <div className="eta-presets">
                <span>Готовность через</span>
                <TimePresets
                  value={minutes}
                  label={'Время готовности заказа ' + order.number}
                  disabled={busy}
                  values={[5, 10, 15, 20]}
                  extra={
                    <button
                      type="button"
                      aria-label="Своё время"
                      title="Своё время"
                      disabled={busy}
                      onClick={() => setCustomTime(true)}
                    >
                      Своё
                    </button>
                  }
                  onChange={(value) => {
                    setMinutes(value);
                    void update({ eta_minutes: value });
                  }}
                />
              </div>
              {customTime && (
                <KitchenDialog
                  title={'Время заказа №' + order.number}
                  busy={busy}
                  close={() => setCustomTime(false)}
                >
                  <label>
                    Своё время{' '}
                    <input
                      aria-label={'Минут для заказа ' + order.number}
                      type="number"
                      value={minutes}
                      min={1}
                      max={120}
                      required
                      disabled={busy}
                      onChange={(e) => setMinutes(Number(e.target.value))}
                    />{' '}
                    мин
                  </label>
                  <button
                    className="button secondary small"
                    aria-label={'Сохранить время заказа ' + order.number}
                    disabled={busy}
                  >
                    <Check size={16} /> Применить
                  </button>
                </KitchenDialog>
              )}
            </form>
          )}
          {cancelling ? (
            <KitchenDialog
              title={'Отменить заказ №' + order.number + '?'}
              busy={busy}
              close={() => setCancelling(false)}
            >
              <form
                className="cancel-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (reason.trim())
                    void update({ status: 'cancelled', cancellation_reason: reason.trim() });
                }}
              >
                <label>
                  Причина отмены
                  <input
                    value={reason}
                    maxLength={300}
                    required
                    disabled={busy}
                    placeholder="Сообщим клиенту"
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <div
                  className="reason-presets"
                  role="group"
                  aria-label="Варианты сообщения клиенту"
                >
                  {['Товар закончился', 'Кухня перегружена', 'По просьбе гостя'].map((value) => (
                    <button
                      type="button"
                      key={value}
                      disabled={busy}
                      onClick={() => setReason(value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <div className="form-row">
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={busy}
                    onClick={() => setCancelling(false)}
                  >
                    Оставить заказ
                  </button>
                  <button className="button danger small" disabled={busy || !reason.trim()}>
                    Подтвердить отмену
                  </button>
                </div>
              </form>
            </KitchenDialog>
          ) : (
            <button className="cancel-order" disabled={busy} onClick={() => setCancelling(true)}>
              Отменить заказ
            </button>
          )}
        </>
      )}
      {error && <Notice>{error}</Notice>}
      {confirmation && (
        <p className="inline-success" role="status">
          {confirmation}
        </p>
      )}
    </article>
  );
}
function DeleteProductDialog({
  product,
  close,
  deleted,
  expired,
}: {
  product: Product;
  close: () => void;
  deleted: (alreadyRemoved: boolean) => void;
  expired: () => void;
}) {
  const { request: api } = useStaffStore();
  const ref = useRef<HTMLDialogElement>(null);
  const removed = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const restore = document.activeElement as HTMLElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (removed.current) document.getElementById('kitchen-menu-heading')?.focus();
      else restore?.focus();
    };
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/kitchen/products/' + product.id, { method: 'DELETE' });
      removed.current = true;
      deleted(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        removed.current = true;
        deleted(true);
      } else {
        setError(errorMessage(e));
        if (e instanceof ApiError && e.status === 401) expired();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      className="admin-modal"
      ref={ref}
      aria-labelledby="delete-product-title"
      aria-describedby="delete-product-description"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <form onSubmit={submit}>
        <h2 id="delete-product-title">Удалить товар?</h2>
        <p id="delete-product-description">
          «{product.name}» будет удалён из меню этой точки. Отменить удаление нельзя.
        </p>
        <p className="muted">Состав и цены в уже оформленных заказах сохранятся.</p>
        {error && <Notice>{error}</Notice>}
        <div className="form-actions">
          <button
            autoFocus
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={close}
          >
            Отмена
          </button>
          <button type="submit" className="button danger" disabled={busy}>
            {busy ? 'Удаляем…' : 'Удалить товар'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
function ProductEditor({
  product,
  done,
  expired,
}: {
  product: Product;
  done: () => void;
  expired: () => void;
}) {
  const { request: api } = useStaffStore();
  const [value, setValue] = useState({
    ...product,
    ingredients: product.ingredients ?? '',
    allergens: product.allergens ?? '',
    options: product.options ?? [],
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(product.id ? '/kitchen/products/' + product.id : '/kitchen/products', {
        method: product.id ? 'PUT' : 'POST',
        body: json(value),
      });
      done();
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 401) expired();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel product-editor" onSubmit={submit}>
      <fieldset className="form-fields" disabled={busy}>
        <h2>{product.id ? 'Редактировать товар' : 'Новый товар'}</h2>
        <label>
          Название
          <input
            value={value.name}
            maxLength={100}
            required
            onChange={(e) => setValue({ ...value, name: e.target.value })}
          />
        </label>
        <label>
          Описание
          <textarea
            value={value.description}
            maxLength={600}
            rows={3}
            onChange={(e) => setValue({ ...value, description: e.target.value })}
          />
        </label>
        <div className="form-row">
          <label>
            Цена, ₽
            <input
              type="number"
              min={1}
              max={1000000}
              required
              value={value.price}
              onChange={(e) => setValue({ ...value, price: Number(e.target.value) })}
            />
          </label>
          <label>
            Вес / объём
            <input
              maxLength={40}
              value={value.weight}
              onChange={(e) => setValue({ ...value, weight: e.target.value })}
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Категория
            <input
              maxLength={100}
              required
              value={value.category}
              onChange={(e) => setValue({ ...value, category: e.target.value })}
            />
          </label>
          <label>
            Порядок
            <input
              type="number"
              min={0}
              max={10000}
              value={value.sort_order}
              onChange={(e) => setValue({ ...value, sort_order: Number(e.target.value) })}
            />
          </label>
        </div>
        <label>
          Фото: путь /images/... или HTTPS
          <input
            maxLength={1000}
            required
            value={value.image}
            onChange={(e) => setValue({ ...value, image: e.target.value })}
          />
        </label>
        <label>
          Состав
          <textarea
            rows={3}
            maxLength={600}
            value={value.ingredients}
            onChange={(e) => setValue({ ...value, ingredients: e.target.value })}
            placeholder="Укажите полный состав"
          />
        </label>
        <label>
          Аллергены
          <textarea
            rows={2}
            maxLength={300}
            value={value.allergens}
            onChange={(e) => setValue({ ...value, allergens: e.target.value })}
            placeholder="Только подтверждённые сведения"
          />
        </label>
        <fieldset className="option-editor">
          <legend>Опции товара</legend>
          <p className="muted">Дополнения с ценой или бесплатные изменения. До 12 опций.</p>
          {value.options.map((option, index) =>
            option.topping_id ? (
              <p key={option.id}>{option.label} · Управление в разделе «Добавки и соусы»</p>
            ) : (
              <div className="option-editor-row" key={option.id}>
                <label>
                  Название опции
                  <input
                    required
                    maxLength={80}
                    value={option.label}
                    onChange={(e) =>
                      setValue({
                        ...value,
                        options: value.options.map((o, i) =>
                          i === index ? { ...o, label: e.target.value } : o,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Доплата, ₽
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    required
                    value={option.price}
                    onChange={(e) =>
                      setValue({
                        ...value,
                        options: value.options.map((o, i) =>
                          i === index ? { ...o, price: Number(e.target.value) } : o,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  className="remove-line"
                  type="button"
                  aria-label={'Удалить опцию ' + (option.label || index + 1)}
                  onClick={() =>
                    setValue({ ...value, options: value.options.filter((_, i) => i !== index) })
                  }
                >
                  Удалить
                </button>
              </div>
            ),
          )}
          <button
            type="button"
            className="button secondary small"
            disabled={value.options.length >= 12}
            onClick={() =>
              setValue({
                ...value,
                options: [
                  ...value.options,
                  { id: 'opt-' + randomKey().slice(0, 12), label: '', price: 0 },
                ],
              })
            }
          >
            Добавить опцию
          </button>
        </fieldset>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={value.available}
            onChange={(e) => setValue({ ...value, available: e.target.checked })}
          />{' '}
          Доступен для заказа
        </label>
        {error && <Notice>{error}</Notice>}
        <div className="form-row">
          <button type="button" className="button secondary" onClick={done}>
            Закрыть
          </button>
          <button className="button">{busy ? 'Сохраняем…' : 'Сохранить'}</button>
        </div>
      </fieldset>
    </form>
  );
}
function SettingsForm({
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
      const result = await api<Settings>('/kitchen/settings', { method: 'PUT', body: json(value) });
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
        <p className="field-hint">Выберите время или введите своё, затем сохраните настройки.</p>
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
export function Kitchen({ accountMenu }: { accountMenu?: ReactNode }) {
  const { invalidate, user } = useAuth();
  const { request: api, role, id: storeId } = useStaffStore();
  const auth = true;
  const setAuth = (_: boolean) => invalidate();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState('orders'),
    [filter, setFilter] = useState('active');
  const [pauseDialog, setPauseDialog] = useState(false),
    [pauseReason, setPauseReason] = useState('');
  const [editing, setEditing] = useState<Product | null>(null),
    [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<Product | null>(null),
    [menuNotice, setMenuNotice] = useState('');
  const native = useNativeKitchen();
  const sound = useKitchenSound(native.native);
  const loadOrders = useCallback(
    async (signal: AbortSignal) => {
      try {
        return await api<Order[]>('/kitchen/orders', { signal });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) setAuth(false);
        throw e;
      }
    },
    [api, invalidate],
  );
  const queue = usePolling(loadOrders, 5000, auth === true),
    menu = useMenu();
  const health = useKitchenHealth(
    user,
    queue.lastUpdated,
    sound.ready,
    sound.enabled,
    native.native,
  );
  useEffect(() => {
    if (!auth || !queue.data) return;
    sound.setPending(queue.data.some((o) => o.status === 'new'));
  }, [queue.data, auth, sound.setPending]);
  const expired = () => setAuth(false);
  const refresh = () => {
    queue.refresh();
    menu.refresh();
  };
  async function togglePause() {
    if (!menu.data || busy) return;
    setBusy(true);
    setError('');
    try {
      const reason = menu.data.settings.paused ? '' : pauseReason;
      if (!menu.data.settings.paused && !reason.trim()) {
        setPauseDialog(true);
        return;
      }
      await api('/kitchen/operations', {
        method: 'PATCH',
        body: json({ paused: !menu.data.settings.paused, reason }),
      });
      setPauseReason('');
      setPauseDialog(false);
      menu.refresh();
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 401) expired();
    } finally {
      setBusy(false);
    }
  }
  async function toggleProduct(product: Product) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/kitchen/products/' + product.id + '/availability', {
        method: 'PATCH',
        body: json({ available: !product.available }),
      });
      menu.refresh();
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 401) expired();
    } finally {
      setBusy(false);
    }
  }
  const orders = queue.data ?? [],
    active = orders.filter((o) => o.status !== 'completed' && o.status !== 'cancelled');
  const overdue = active.filter(
    (o) => o.status !== 'ready' && Date.now() > Date.parse(o.estimated_ready_at),
  ).length;
  const visible = (filter === 'active' ? active : orders.filter((o) => o.status === filter))
    .filter((o) =>
      (o.number + ' ' + o.name).toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')),
    )
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const newOrders = orders.filter((o) => o.status === 'new').length;
  const monitoring = native.native ? native.state.monitoring : sound.enabled;
  const audioReady = native.native ? native.state.audio_ready : sound.ready;
  const showNew = () => {
    setTab('orders');
    setFilter('new');
    setSearch('');
  };
  const intake = !menu.data
    ? 'Подключаемся…'
    : menu.data.store?.owner_stopped
      ? 'Стоп владельца'
      : menu.data.settings.paused
        ? 'Приём на паузе'
        : menu.data.accepting_orders
          ? 'Принимаем заказы'
          : menu.data.intake_message || 'Не принимаем заказы';
  return (
    <main
      className={
        'container kitchen kitchen-tablet' +
        (tab === 'orders' && filter === 'active' ? ' kitchen-board-active' : '')
      }
    >
      <div className="kitchen-operations-header">
        <div className="kitchen-topbar">
          <div className="kitchen-location">
            <div>
              <Link to={'/kitchen'} className="brand">
                <span className="brand-mark">
                  <Flame size={25} />
                </span>
              </Link>
            </div>
            <h1>Кухня</h1>
            <span title={menu.data?.settings.address}>
              {menu.data?.settings.address || 'Подключаемся…'}
            </span>
          </div>
          <button
            className="kitchen-new-count"
            onClick={showNew}
            aria-pressed={tab === 'orders' && filter === 'new'}
          >
            Новые <b>{newOrders}</b>
          </button>
          <select
            className="kitchen-section-select"
            aria-label="Раздел кухни"
            value={tab}
            onChange={(e) => setTab(e.target.value)}
          >
            <option value="orders">Заказы · {active.length}</option>
            <option value="menu">Меню</option>
            <option value="settings">Настройки</option>
          </select>
          <KitchenControls section={tab}>
            <p className="kitchen-control-title">Управление кухней</p>
            <p className="fine-print">{intake}</p>
            <button
              className="button secondary"
              disabled={!menu.data || busy || menu.data.store?.owner_stopped}
              onClick={() => void togglePause()}
            >
              {menu.data?.settings.paused ? <Play size={16} /> : <Pause size={16} />}
              {menu.data?.settings.paused ? 'Возобновить' : 'Пауза'}
            </button>
            <button
              className="button secondary"
              onClick={() => (native.native ? nativeKitchenAction('test') : sound.test())}
            >
              Проверить звук
            </button>
            {native.native && (
              <button className="button secondary" onClick={() => nativeKitchenAction('settings')}>
                Громкость и разрешения
              </button>
            )}
            <p className="fine-print">
              Оповещения повторяются, пока есть новые заказы.{' '}
              {native.native
                ? 'Фоновый мониторинг работает отдельно от страницы.'
                : 'Для фоновых оповещений используйте приложение кухни.'}
            </p>
            {accountMenu}
          </KitchenControls>
        </div>
        <div className="kitchen-statusline">
          <span
            className={'intake-status ' + (!menu.data?.accepting_orders ? 'paused' : '')}
            title={intake}
          >
            <span className="status-dot" />
            <span className="kitchen-intake-label">{intake}</span>
          </span>
          <button
            className="kitchen-sound-status"
            data-kitchen-sound
            onClick={() =>
              native.native
                ? nativeKitchenAction(
                    monitoring && !audioReady ? 'settings' : monitoring ? 'stop' : 'start',
                  )
                : sound.toggle()
            }
            aria-pressed={monitoring}
            aria-label={
              monitoring && audioReady
                ? 'Остановить оповещения'
                : native.native
                  ? monitoring
                    ? 'Громкость и разрешения'
                    : 'Включить уведомления кухни'
                  : 'Активировать звук'
            }
          >
            {monitoring && audioReady ? <Volume2 size={18} /> : <VolumeX size={18} />}
            {monitoring && audioReady
              ? 'Звук включён'
              : native.native && monitoring
                ? 'Проверить звук'
                : 'Включить звук'}
          </button>
          <span
            className="kitchen-connection"
            title={
              queue.lastUpdated ? 'Обновлено ' + clock(queue.lastUpdated.toISOString()) : undefined
            }
          >
            {queue.error ? 'Нет связи' : queue.lastUpdated ? 'На связи' : 'Подключение…'}
          </span>
          <button className="icon-button" aria-label="Обновить кухню" onClick={refresh}>
            <RefreshCw size={18} />
          </button>
        </div>
        {pauseDialog && (
          <PauseDialog
            reason={pauseReason}
            setReason={setPauseReason}
            busy={busy}
            close={() => setPauseDialog(false)}
            submit={() => void togglePause()}
          />
        )}
      </div>
      {health.stale && (
        <Notice kind="warning">
          Нет свежей связи более 15 секунд. Показана последняя очередь; состояние заказов не
          подтверждено. Приём новых заказов продолжается.
        </Notice>
      )}
      {(native.native ? !native.state.monitoring : !sound.enabled) && (
        <Notice kind="warning">
          Оповещения остановлены на этом устройстве. Новые заказы продолжают поступать.
        </Notice>
      )}
      {native.native && native.state.error && <Notice kind="warning">{native.state.error}</Notice>}
      {health.heartbeatError && (
        <Notice kind="warning">
          Не удалось передать состояние устройства владельцу. Проверьте связь.
        </Notice>
      )}
      {!native.native &&
        (sound.error ? (
          <Notice>{sound.error}</Notice>
        ) : (
          sound.enabled &&
          !sound.ready && (
            <p className="fine-print" role="status">
              Звук включён по умолчанию и ожидает первого нажатия на странице.
            </p>
          )
        ))}
      {error && <Notice>{error}</Notice>}
      {queue.error && <Notice>Очередь не обновилась. {queue.error}</Notice>}
      {menu.error && <Notice>Меню не обновилось. {menu.error}</Notice>}
      {tab === 'orders' && (
        <>
          <div className="kitchen-queue-controls">
            <label className="queue-search">
              <span className="sr-only">Найти заказ</span>
              <input
                type="search"
                placeholder="Номер заказа или имя"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <select
              aria-label="Статус заказов"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {[
                ['active', 'В работе · ' + active.length],
                ['new', 'Новые · ' + newOrders],
                ['preparing', 'Готовим · ' + orders.filter((o) => o.status === 'preparing').length],
                ['ready', 'К выдаче · ' + orders.filter((o) => o.status === 'ready').length],
                ['completed', 'Выданы'],
                ['cancelled', 'Отменены'],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {overdue > 0 && <span className="text-error">Опаздывают: {overdue}</span>}
          </div>
          {queue.loading && !queue.data ? (
            <p role="status">Загружаем очередь…</p>
          ) : visible.length === 0 && (filter !== 'active' || !!search) ? (
            <div className="panel empty">
              <UtensilsCrossed size={30} />
              <h2>{search ? 'Заказ не найден' : 'Здесь пока тихо'}</h2>
              <p>
                {search
                  ? 'Попробуйте другое имя или номер.'
                  : 'Новые заказы появятся автоматически.'}
              </p>
            </div>
          ) : (
            <KitchenBoard
              orders={visible}
              board={filter === 'active'}
              renderOrder={(order) => (
                <OrderCard key={order.id} order={order} reload={queue.refresh} expired={expired} />
              )}
            />
          )}
        </>
      )}
      {tab === 'menu' && (
        <>
          <ToppingsPanel products={menu.data?.products ?? []} saved={menu.refresh} />
          {deleting && (
            <DeleteProductDialog
              product={deleting}
              close={() => setDeleting(null)}
              expired={expired}
              deleted={(alreadyRemoved) => {
                setMenuNotice(
                  alreadyRemoved
                    ? `«${deleting.name}» уже отсутствует в меню.`
                    : `«${deleting.name}» удалён из меню.`,
                );
                setDeleting(null);
                menu.refresh();
              }}
            />
          )}
          {editing ? (
            <ProductEditor
              key={editing.id}
              product={editing}
              expired={expired}
              done={() => {
                setEditing(null);
                menu.refresh();
              }}
            />
          ) : (
            <>
              <div className="section-top">
                <h2 id="kitchen-menu-heading" tabIndex={-1}>
                  Ваше меню
                </h2>
                {role !== 'worker' && (
                  <button
                    className="button small"
                    onClick={() =>
                      setEditing({
                        id: 0,
                        name: '',
                        description: '',
                        price: 290,
                        image: '/images/classic.jpg',
                        weight: '',
                        category: 'Шаверма',
                        available: true,
                        sort_order: (menu.data?.products.length ?? 0) + 1,
                        ingredients: '',
                        allergens: '',
                        options: [],
                      })
                    }
                  >
                    <Plus size={18} /> Добавить товар
                  </button>
                )}
              </div>
              {menuNotice && <Notice kind="success">{menuNotice}</Notice>}
              {menu.data?.products.length === 0 && <p className="muted">Меню пока пусто.</p>}
              <div className="staff-products">
                {menu.data?.products.map((p) => (
                  <div className="panel staff-product" key={p.id}>
                    <FoodImage src={p.image} alt={p.name} />
                    <div>
                      <h3>{p.name}</h3>
                      <b>{rub(p.price)}</b>
                      <button
                        className={
                          'availability-toggle ' + (p.available ? 'available-label' : 'text-error')
                        }
                        type="button"
                        role="switch"
                        aria-checked={p.available}
                        aria-label={'В продаже: ' + p.name}
                        disabled={busy}
                        onClick={() => void toggleProduct(p)}
                      >
                        <span className="toggle-track">
                          <i />
                        </span>
                        {p.available ? 'В продаже' : 'Недоступен'}
                      </button>
                    </div>
                    {role !== 'worker' && !p.topping_id && (
                      <div className="staff-product-actions">
                        <button
                          className="button secondary small"
                          disabled={busy}
                          onClick={() => setEditing(p)}
                        >
                          Изменить
                        </button>
                        <button
                          type="button"
                          className="button secondary small product-delete"
                          aria-label={'Удалить товар ' + p.name}
                          disabled={busy}
                          onClick={() => {
                            setMenuNotice('');
                            setDeleting(p);
                          }}
                        >
                          <Trash2 size={16} aria-hidden="true" /> Удалить
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {tab === 'settings' &&
        menu.data &&
        (role === 'worker' ? (
          <WorkerSettings settings={menu.data.settings} saved={menu.refresh} />
        ) : (
          <SettingsForm settings={menu.data.settings} saved={menu.refresh} expired={expired} />
        ))}
    </main>
  );
}
