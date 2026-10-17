import { useEffect, useRef, useState, type ReactNode } from 'react';
import { type Order } from '@/shared/api/types';

function useMinimumWidth(width: number) {
  const [matches, setMatches] = useState(
    () => window.matchMedia('(min-width: ' + width + 'px)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(min-width: ' + width + 'px)');
    const changed = () => setMatches(media.matches);
    changed();
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, [width]);
  return matches;
}

export function KitchenBoard({
  orders,
  board,
  renderOrder,
}: {
  orders: Order[];
  board: boolean;
  renderOrder: (order: Order) => ReactNode;
}) {
  const tablet = useMinimumWidth(800),
    wide = useMinimumWidth(1100);
  const [secondary, setSecondary] = useState('preparing');
  const boardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = boardRef.current;
    if (!tablet || !board || !element) return;
    const measure = () => {
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      const height = Math.max(220, viewport - element.getBoundingClientRect().top - 12);
      const value = Math.floor(height) + 'px';
      if (element.style.getPropertyValue('--kitchen-board-height') !== value)
        element.style.setProperty('--kitchen-board-height', value);
    };
    const observer = new ResizeObserver(measure);
    if (element.parentElement) observer.observe(element.parentElement);
    element.parentElement
      ?.querySelectorAll(':scope > *:not(.kitchen-board)')
      .forEach((node) => observer.observe(node));
    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [tablet, wide, board]);
  if (!tablet || !board)
    return orders.length ? (
      <div className="kitchen-grid">{orders.map(renderOrder)}</div>
    ) : (
      <div className="panel empty">
        <h2>Здесь пока тихо</h2>
        <p>Новые заказы появятся автоматически.</p>
      </div>
    );
  return (
    <div
      ref={boardRef}
      className={'kitchen-board ' + (wide ? 'kitchen-board-wide' : 'kitchen-board-medium')}
    >
      {(['new', 'preparing', 'ready'] as const)
        .filter((status) => wide || status === 'new' || status === secondary)
        .map((status) => {
          const values = orders.filter((o) => o.status === status);
          return (
            <section
              className={'kitchen-lane kitchen-lane-' + status}
              key={status}
              aria-label={
                status === 'new'
                  ? 'Новые заказы'
                  : status === 'preparing'
                    ? 'Заказы готовятся'
                    : 'К выдаче'
              }
            >
              <header className="kitchen-lane-header">
                <h2>
                  {status === 'new' ? 'Новые' : status === 'preparing' ? 'Готовим' : 'К выдаче'}{' '}
                  <span>{values.length}</span>
                </h2>
                {!wide && status !== 'new' && (
                  <div className="kitchen-lane-switch">
                    <button
                      aria-pressed={secondary === 'preparing'}
                      onClick={() => setSecondary('preparing')}
                    >
                      Готовим · {orders.filter((o) => o.status === 'preparing').length}
                    </button>
                    <button
                      aria-pressed={secondary === 'ready'}
                      onClick={() => setSecondary('ready')}
                    >
                      К выдаче · {orders.filter((o) => o.status === 'ready').length}
                    </button>
                  </div>
                )}
              </header>
              <div className="kitchen-lane-list">
                {values.length ? (
                  values.map(renderOrder)
                ) : (
                  <p className="kitchen-lane-empty">
                    {status === 'new' ? 'Новых заказов нет' : 'Здесь пока нет заказов'}
                  </p>
                )}
              </div>
            </section>
          );
        })}
    </div>
  );
}
