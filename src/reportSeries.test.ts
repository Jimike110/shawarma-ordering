import { describe, expect, it } from 'vitest';
import { dailySeries } from './pages/Reports';
describe('daily report series', () => {
  it('fills missing days with zero without changing reported values across a year boundary', () => {
    expect(
      dailySeries(
        [
          { date: '2025-12-31', orders: 2, completed_value: 620 },
          { date: '2026-01-02', orders: 1, completed_value: 350 },
        ],
        '2025-12-31',
        '2026-01-02',
      ),
    ).toEqual([
      { date: '2025-12-31', orders: 2, completed_value: 620 },
      { date: '2026-01-01', orders: 0, completed_value: 0 },
      { date: '2026-01-02', orders: 1, completed_value: 350 },
    ]);
  });
  it('includes leap days and bounds invalid ranges', () => {
    expect(dailySeries([], '2024-02-28', '2024-03-01').map((d) => d.date)).toEqual([
      '2024-02-28',
      '2024-02-29',
      '2024-03-01',
    ]);
    expect(dailySeries([], '2026-01-02', '2026-01-01')).toEqual([]);
    expect(dailySeries([], 'bad', '2026-01-01')).toEqual([]);
    expect(dailySeries([], '2024-01-01', '2026-01-01')).toEqual([]);
  });
});
