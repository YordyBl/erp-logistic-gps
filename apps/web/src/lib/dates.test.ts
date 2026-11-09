import { describe, expect, it } from 'vitest';

import { formatPlannedDate, parseIsoDay, toIsoDay } from './dates.js';

describe('fechas de planificación', () => {
  it('conserva el mismo día de ida y vuelta entre la API y el calendario', () => {
    for (const day of ['2026-11-06', '2026-01-01', '2026-12-31', '2028-02-29']) {
      expect(toIsoDay(parseIsoDay(day)!)).toBe(day);
    }
  });

  it('no corre un día cuando la API entrega la fecha con hora', () => {
    expect(toIsoDay(parseIsoDay('2026-11-06T00:00:00.000Z')!)).toBe('2026-11-06');
    expect(toIsoDay(parseIsoDay('2026-11-06T05:00:00.000Z')!)).toBe('2026-11-06');
    expect(formatPlannedDate('2026-11-06T00:00:00.000Z')).toMatch(/^6 nov/);
  });

  it('usa los valores locales del día elegido, sin pasar por UTC', () => {
    expect(toIsoDay(new Date(2026, 10, 6, 23, 59))).toBe('2026-11-06');
    expect(toIsoDay(new Date(2026, 10, 6, 0, 0))).toBe('2026-11-06');
  });

  it('rechaza valores que no son una fecha real', () => {
    expect(parseIsoDay('')).toBeUndefined();
    expect(parseIsoDay('sin-fecha')).toBeUndefined();
    expect(parseIsoDay('2026-02-31')).toBeUndefined();
    expect(formatPlannedDate('sin-fecha')).toBe('sin-fecha');
  });
});
