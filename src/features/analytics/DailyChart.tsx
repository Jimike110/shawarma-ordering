import { dailySeries } from '@/features/analytics/reportSeries';
import { type Report } from '@/features/analytics/types';

export function DailyChart({
  daily,
  from,
  to,
}: {
  daily: Report['daily'];
  from: string;
  to: string;
}) {
  const days = dailySeries(daily, from, to),
    max = Math.max(2, ...days.map((d) => d.orders));
  const x = (i: number) =>
    days.length === 1 ? 300 : 10 + (i / Math.max(1, days.length - 1)) * 580;
  const y = (n: number) => 150 - (n / max) * 140;
  const label = (s: string) => s.slice(8) + '.' + s.slice(5, 7);
  return (
    <figure className="owner-chart">
      <figcaption>Количество заказов, шт.</figcaption>
      <div className="owner-chart-body">
        <div className="owner-chart-y">
          <span>{max}</span>
          <span>{Math.round(max / 2)}</span>
          <span>0</span>
        </div>
        <svg
          viewBox="0 0 600 160"
          preserveAspectRatio="none"
          role="img"
          aria-label={
            'Заказы по дням с ' + from + ' по ' + to + '; точные значения в таблице ниже'
          }
        >
          {[0, max / 2, max].map((n) => (
            <line key={n} x1="0" x2="600" y1={y(n)} y2={y(n)} stroke="var(--line)" />
          ))}
          <path
            d={days.map((d, i) => (i ? 'L' : 'M') + x(i) + ',' + y(d.orders)).join(' ')}
            fill="none"
            stroke="var(--orange)"
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
          />
          {days.map((d, i) => (
            <circle
              key={d.date}
              cx={x(i)}
              cy={y(d.orders)}
              r={days.length > 31 ? 2 : 4}
              fill="var(--orange)"
            >
              <title>
                {d.date}: {d.orders} заказов
              </title>
            </circle>
          ))}
        </svg>
      </div>
      <div className="owner-chart-x">
        <span>{label(from)}</span>
        {days.length > 2 && <span>{label(days[Math.floor(days.length / 2)].date)}</span>}
        <span>{label(to)}</span>
      </div>
    </figure>
  );
}
