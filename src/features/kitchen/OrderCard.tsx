import { KitchenDialog } from '@/shared/ui/KitchenDialog';
import { useStaffStore } from '@/features/auth/storeContext';
import { useState } from 'react';
import { Clock3, Check } from 'lucide-react';
import { ApiError, errorMessage, json } from '@/shared/api/client';
import { Notice } from '@/shared/ui/Feedback';
import { clock, rub, statusLabels } from '@/shared/lib/format';
import { type Order, type Status } from '@/shared/api/types';
import { TimePresets } from '@/features/kitchen/TimePresets';

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

export function OrderCard({
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
        <span className={'status-badge status-' + order.status}>
          {statusLabels[order.status]}
        </span>
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
                {item.options
                  .map((o) => o.label + (o.portion ? ' · ' + o.portion : ''))
                  .join(', ')}
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
                  {['Товар закончился', 'Кухня перегружена', 'По просьбе гостя'].map(
                    (value) => (
                      <button
                        type="button"
                        key={value}
                        disabled={busy}
                        onClick={() => setReason(value)}
                      >
                        {value}
                      </button>
                    ),
                  )}
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
            <button
              className="cancel-order"
              disabled={busy}
              onClick={() => setCancelling(true)}
            >
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
