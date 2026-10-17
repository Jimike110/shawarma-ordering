import { useStaffStore } from '@/features/auth/storeContext';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { Notice } from '@/shared/ui/Feedback';
import { type Product } from '@/shared/api/types';

export function DeleteProductDialog({
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
