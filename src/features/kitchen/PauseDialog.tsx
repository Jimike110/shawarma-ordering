import { useEffect, useRef } from 'react';

export function PauseDialog({
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
