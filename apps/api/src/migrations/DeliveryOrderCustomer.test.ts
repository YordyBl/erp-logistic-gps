import type { QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { DeliveryOrderCustomer1793577600000 } from '../../migrations/1793577600000-DeliveryOrderCustomer.js';

describe('DeliveryOrderCustomer1793577600000', () => {
  it('refuses to alter any existing orders until each has a verified customer', async () => {
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ count: '2' }]);
    const runner = { query } as unknown as QueryRunner;

    await expect(new DeliveryOrderCustomer1793577600000().up(runner))
      .rejects.toThrow('2 delivery orders exist');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain('LOCK TABLE');
    expect(query.mock.calls[1]?.[0]).toContain('SELECT count(*)');
  });

  it('adds a non-null customer reference with a same-tenant foreign key when there are no orders', async () => {
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ count: '0' }]);
    const runner = { query } as unknown as QueryRunner;

    await new DeliveryOrderCustomer1793577600000().up(runner);

    expect(query).toHaveBeenCalledTimes(5);
    expect(query.mock.calls[3]?.[0]).toContain('ADD "customer_id" uuid NOT NULL');
    expect(query.mock.calls[4]?.[0]).toContain('FOREIGN KEY ("organization_id", "customer_id")');
  });
});
