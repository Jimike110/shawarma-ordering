import { useEffect, useRef, type ReactNode } from 'react';

export function KitchenDialog({
  title,
  children,
  close,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    trigger.current = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      trigger.current?.focus();
    };
  }, []);
  return (
    <dialog
      className="kitchen-dialog"
      ref={dialog}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Закрыть"
          disabled={busy}
          onClick={close}
        >
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
