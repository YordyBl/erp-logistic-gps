import { describe, expect, it } from 'vitest';

import { countLabel, formatTimeAgo, initials } from './format.js';

describe('countLabel', () => {
  it('keeps the figure and picks singular or plural', () => {
    expect(countLabel(1, 'ruta', 'rutas')).toBe('1 ruta');
    expect(countLabel(0, 'ruta', 'rutas')).toBe('0 rutas');
    expect(countLabel(7, 'pedido', 'pedidos')).toBe('7 pedidos');
  });
});

describe('initials', () => {
  it('uses the first two words', () => {
    expect(initials('Andrés Demo Huamán')).toBe('AD');
    expect(initials('  Kevin  ')).toBe('K');
  });
});

describe('formatTimeAgo', () => {
  it('moves from minutes to hours and days', () => {
    const now = Date.parse('2026-11-06T12:00:00.000Z');
    expect(formatTimeAgo('2026-11-06T11:55:00.000Z', now)).toContain('5 minutos');
    expect(formatTimeAgo('2026-11-06T09:00:00.000Z', now)).toContain('3 horas');
  });
});
