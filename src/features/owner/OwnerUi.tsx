import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { Notice } from '@/shared/ui/Feedback';
import { type Store, type IntakeBlocker } from '@/shared/api/types';

export function OwnerLoading() {
  return (
    <div className="owner-loading" role="status" aria-label="Загрузка">
      <span />
      <span />
      <span />
    </div>
  );
}

export function RefreshStatus({
  error,
  lastUpdated,
  refresh,
}: {
  error: string;
  lastUpdated: Date | null;
  refresh: () => void;
}) {
  if (!error) return null;
  return (
    <div className="owner-refresh">
      <Notice>
        {error}
        {lastUpdated && (
          <>
            {' '}
            Показаны данные на{' '}
            {lastUpdated.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК; они
            могут быть устаревшими.
          </>
        )}
      </Notice>
      <button className="button secondary small" onClick={refresh}>
        <RefreshCw size={15} />
        Повторить
      </button>
    </div>
  );
}

export function ActionMenu({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) ref.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return (
    <details
      ref={ref}
      className={'owner-actions ' + className}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          ref.current?.removeAttribute('open');
          ref.current?.querySelector('summary')?.focus();
        }
      }}
    >
      <summary>
        {label}
        <ChevronDown size={15} />
      </summary>
      <div
        className="owner-action-popover"
        onClick={(e) => {
          if ((e.target as Element).closest('button,a')) {
            ref.current?.removeAttribute('open');
            ref.current?.querySelector('summary')?.focus();
          }
        }}
      >
        {children}
      </div>
    </details>
  );
}

const blockerLabels: Record<IntakeBlocker, string> = {
  archived: 'В архиве',
  unpublished: 'Черновик · не опубликована',
  privacy_unpublished: 'Не опубликованы документы оператора',
  owner_stopped: 'Стоп владельца',
  paused: 'Пауза кухни',
  outside_hours: 'Вне часов работы',
};

export function IntakeState({ store, full = false }: { store: Store; full?: boolean }) {
  const blockers = store.intake_blockers ?? [];
  return (
    <div className="owner-intake">
      <span className={'owner-state ' + (store.accepting_orders ? 'is-open' : 'is-closed')}>
        {store.accepting_orders
          ? 'Принимает заказы'
          : blockers.length
            ? blockerLabels[blockers[0]]
            : store.intake_message}
      </span>
      {full && blockers.length > 1 && (
        <ul>
          {blockers.slice(1).map((b) => (
            <li key={b}>{blockerLabels[b]}</li>
          ))}
        </ul>
      )}
      {full && store.owner_stopped && store.stop_reason && (
        <small>Причина: {store.stop_reason}</small>
      )}
      {full && store.settings.paused && store.settings.pause_message && (
        <small>Кухня: {store.settings.pause_message}</small>
      )}
    </div>
  );
}
