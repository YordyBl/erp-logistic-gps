import { describe, expect, it } from 'vitest';

import { formatDayRange, limaToday, reportPeriods } from './reportPeriods.js';

describe('reportPeriods', () => {
  it('compara los últimos 7 días con los 7 anteriores, también entre meses', () => {
    expect(reportPeriods('week', '2026-11-18')).toMatchObject({
      period: { from: '2026-11-12', to: '2026-11-18' }, comparison: { from: '2026-11-05', to: '2026-11-11' },
    });
    expect(reportPeriods('week', '2026-03-03')).toMatchObject({
      period: { from: '2026-02-25', to: '2026-03-03' }, comparison: { from: '2026-02-18', to: '2026-02-24' },
    });
  });

  it('compara el mes en curso con el mismo tramo del mes anterior, recortado a su último día', () => {
    expect(reportPeriods('month', '2026-11-18')).toMatchObject({
      period: { from: '2026-11-01', to: '2026-11-18' }, comparison: { from: '2026-10-01', to: '2026-10-18' },
    });
    expect(reportPeriods('month', '2026-03-31').comparison).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(reportPeriods('month', '2027-01-10').comparison).toEqual({ from: '2026-12-01', to: '2026-12-10' });
  });

  it('compara el trimestre en curso con el mismo tramo del anterior', () => {
    expect(reportPeriods('quarter', '2026-11-18')).toMatchObject({
      period: { from: '2026-10-01', to: '2026-11-18' }, comparison: { from: '2026-07-01', to: '2026-08-18' },
    });
    expect(reportPeriods('quarter', '2027-02-05')).toMatchObject({
      period: { from: '2027-01-01', to: '2027-02-05' }, comparison: { from: '2026-10-01', to: '2026-11-05' },
    });
    expect(reportPeriods('quarter', '2026-05-31').comparison).toEqual({ from: '2026-01-01', to: '2026-02-28' });
  });

  it('toma el día de Lima, no el de UTC', () => {
    expect(limaToday(new Date('2026-12-01T03:00:00Z'))).toBe('2026-11-30');
  });

  it('describe los rangos en español', () => {
    expect(formatDayRange({ from: '2026-11-01', to: '2026-11-18' })).toBe('1 al 18 de noviembre');
    expect(formatDayRange({ from: '2026-10-01', to: '2026-11-18' })).toBe('1 de octubre al 18 de noviembre');
    expect(formatDayRange({ from: '2026-12-28', to: '2027-01-03' })).toBe('28 de diciembre de 2026 al 3 de enero de 2027');
    expect(formatDayRange({ from: '2026-11-18', to: '2026-11-18' })).toBe('18 de noviembre');
  });
});
