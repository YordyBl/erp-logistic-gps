import { describe, expect, it } from 'vitest';

import { chartCaption, limaToday, METRICS_PERIODS, periodLabel, periodRange, statsScope } from './metricsPeriod.js';

describe('metricsPeriod', () => {
  it('reads today in Lima, not in UTC', () => {
    // 03:00 UTC on 1 March is still 28 February in Lima.
    expect(limaToday(new Date('2026-03-01T03:00:00.000Z'))).toBe('2026-02-28');
    expect(limaToday(new Date('2026-11-16T15:00:00.000Z'))).toBe('2026-11-16');
  });

  it('turns every period into whole calendar months of planned days', () => {
    expect(periodRange('month', '2026-11-16')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(periodRange('3m', '2026-11-16')).toEqual({ from: '2026-09-01', to: '2026-11-30' });
    expect(periodRange('6m', '2026-02-10')).toEqual({ from: '2025-09-01', to: '2026-02-28' });
    expect(periodRange('year', '2026-11-16')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodRange('all', '2026-11-16')).toEqual({});
  });

  it('asks the server for the bars of the period: its months, or the last twelve for everything', () => {
    expect(statsScope('3m', '2026-11-16')).toEqual({ from: '2026-09-01', to: '2026-11-30' });
    expect(statsScope('all', '2026-11-16')).toEqual({ months: 12 });
    expect(chartCaption('month')).toBe('Este mes');
    expect(chartCaption('year')).toBe('Este año');
    expect(chartCaption('all')).toBe('Últimos 12 meses');
  });

  it('labels every option', () => {
    expect(METRICS_PERIODS.map((option) => option.label))
      .toEqual(['Este mes', 'Últimos 3 meses', 'Últimos 6 meses', 'Este año', 'Todo']);
    expect(periodLabel('3m')).toBe('últimos 3 meses');
    expect(periodLabel('all')).toBe('todo el historial');
  });
});
