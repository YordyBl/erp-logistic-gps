import type { QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { DeliveryOrderTimeWindow1793664000000 } from '../../migrations/1793664000000-DeliveryOrderTimeWindow.js';

describe('DeliveryOrderTimeWindow1793664000000', () => {
  it('refuses to invent a window for existing orders before issuing DDL', async () => {
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ count: '3' }]);
    const runner = { query } as unknown as QueryRunner;

    await expect(new DeliveryOrderTimeWindow1793664000000().up(runner))
      .rejects.toThrow('3 delivery orders exist');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain('LOCK TABLE');
    expect(query.mock.calls[1]?.[0]).toContain('SELECT count(*)');
  });

  it('adds a required AM/PM column when the order table is empty', async () => {
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce(undefined);
    const runner = { query } as unknown as QueryRunner;

    await new DeliveryOrderTimeWindow1793664000000().up(runner);

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[2]?.[0]).toContain('"time_window" varchar(2) NOT NULL');
    expect(query.mock.calls[2]?.[0]).toContain("CHECK (\"time_window\" IN ('AM', 'PM'))");
  });
});
