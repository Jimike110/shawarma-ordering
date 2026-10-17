import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useOwnerDraft } from '@/features/owner/ownerContext';

export function Modal({
  title,
  children,
  close,
  guard = false,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  guard?: boolean;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const [dirty, setDirty] = useState(false);
  useOwnerDraft(guard && dirty);
  const dismiss = () => {
    if (
      !busy &&
      (!guard || !dirty || window.confirm('Есть несохранённые данные. Закрыть без сохранения?'))
    )
      close();
  };
  useEffect(() => {
    restore.current = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      restore.current?.focus();
    };
  }, []);
  return (
    <dialog
      className="admin-modal"
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
      onChange={() => {
        if (guard) setDirty(true);
      }}
    >
      <div className="section-top">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Закрыть" disabled={busy} onClick={dismiss}>
          ×
        </button>
      </div>
      <fieldset className="owner-form-fields" disabled={busy}>
        {children}
      </fieldset>
    </dialog>
  );
}
