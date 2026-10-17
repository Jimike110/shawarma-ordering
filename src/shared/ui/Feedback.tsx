import { type ReactNode } from 'react';

export function Notice({ children, kind = 'error' }: { children: ReactNode; kind?: string }) {
  return (
    <div className={'notice ' + kind} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Loading() {
  return (
    <main className="container empty" role="status">
      <span className="spinner" /> Загружаем…
    </main>
  );
}
