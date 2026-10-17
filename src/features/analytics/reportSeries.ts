import { type Report } from '@/features/analytics/types';

export const moscowDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

export function dailySeries(daily: Report['daily'], from: string, to: string): Report['daily'] {
  const start = Date.parse(from),
    end = Date.parse(to);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start ||
    end - start > 365 * 86400000
  )
    return [];
  const values = new Map(daily.map((d) => [d.date, d]));
  return Array.from({ length: Math.round((end - start) / 86400000) + 1 }, (_, i) => {
    const date = new Date(start + i * 86400000).toISOString().slice(0, 10);
    return values.get(date) ?? { date, orders: 0, completed_value: 0 };
  });
}

export const previousDate = (date: string, n: number) => {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
