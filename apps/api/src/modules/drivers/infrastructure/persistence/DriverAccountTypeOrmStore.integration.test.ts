import { createHash, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDataSource } from '../../../../infrastructure/database/data-source.js';
import { DriverAccountTypeOrmStore } from '../../../../infrastructure/dispatch/DriverAccountTypeOrmStore.js';
import { Driver } from '../../domain/entities/Driver.js';
import { DriverTypeOrmRepository } from './DriverTypeOrmRepository.js';
import { probeDriversDatabase } from '../../tests/support/test-database.js';

const database = await probeDriversDatabase();
if (!database.available) process.stderr.write(`[driver-binding:integration] Skipping: ${database.reason}.\n`);
const url = database.available ? database.url : null;

describe.skipIf(url === null)('Driver-account binding (PostgreSQL)', () => {
  let source: DataSource;
  let store: DriverAccountTypeOrmStore;
  let drivers: DriverTypeOrmRepository;
  const organizations: string[] = [];

  beforeAll(async () => {
    source = createDataSource({ url: url as string });
    await source.initialize();
    store = new DriverAccountTypeOrmStore(source);
    drivers = new DriverTypeOrmRepository(source);
  });

  afterAll(async () => {
    if (!source?.isInitialized) return;
    for (const table of ['driver_account_binding_history', 'driver_accounts', 'delivery_routes',
      'vehicles', 'drivers', 'users']) {
      await source.query(`DELETE FROM "${table}" WHERE organization_id = ANY($1::uuid[])`, [organizations]);
    }
    await source.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [organizations]);
    await source.destroy();
  });

  async function seed() {
    const organizationId = randomUUID();
    const driverId = randomUUID();
    const adminId = randomUUID();
    const userId = randomUUID();
    organizations.push(organizationId);
    await source.query(`INSERT INTO organizations (id, name, created_at)
      VALUES ($1,'Binding integration',now())`, [organizationId]);
    const addUser = async (id: string, role: string, status = 'active') => {
      await source.query(`INSERT INTO users
        (id, organization_id, email, password_hash, role, status, created_at)
        VALUES ($1,$2,$3,'test-only-hash',$4,$5,now())`,
      [id, organizationId, `${id}@example.test`, role, status]);
    };
    const addDriver = async (id: string) => {
      await drivers.save(Driver.create({
        id, organizationId, fullName: 'Test Driver',
        documentNumber: `DNI-${id.slice(0, 8).toUpperCase()}`,
        phone: '+51 911 222 333', licenseNumber: `L-${id.slice(0, 8).toUpperCase()}`,
        createdAt: '2026-10-27T15:00:00.000Z',
      }));
    };
    await addUser(adminId, 'ADMIN');
    await addUser(userId, 'DRIVER');
    await addDriver(driverId);
    return { organizationId, driverId, adminId, userId, addUser, addDriver };
  }

  it('persists a one-to-one link and audit without changing the catalog DTO', async () => {
    const ctx = await seed();
    const at = '2026-10-27T16:00:00.000Z';
    await expect(store.bind(ctx.organizationId, ctx.driverId, ctx.userId, ctx.adminId, at))
      .resolves.toEqual({ driverId: ctx.driverId, userId: ctx.userId });
    expect(await store.get(ctx.organizationId, ctx.driverId))
      .toEqual({ driverId: ctx.driverId, userId: ctx.userId });
    expect(await store.findDriverId(ctx.organizationId, ctx.userId)).toBe(ctx.driverId);
    expect(await drivers.findById(ctx.organizationId, ctx.driverId)).not.toHaveProperty('userId');
    await store.bind(ctx.organizationId, ctx.driverId, ctx.userId, ctx.adminId, at);
    const audit = await source.query<{ from_user_id: string | null; to_user_id: string | null }[]>(
      `SELECT from_user_id, to_user_id FROM driver_account_binding_history WHERE driver_id=$1`,
      [ctx.driverId]);
    expect(audit).toEqual([{ from_user_id: null, to_user_id: ctx.userId }]);
    await store.bind(ctx.organizationId, ctx.driverId, null, ctx.adminId, at);
    expect(await store.findDriverId(ctx.organizationId, ctx.userId)).toBeNull();
    expect((await source.query<{ id: string }[]>(
      `SELECT id FROM driver_account_binding_history WHERE driver_id=$1`, [ctx.driverId]))).toHaveLength(2);
  });

  it('lists same-tenant DRIVER accounts with binding state and without password hashes', async () => {
    const own = await seed();
    const other = await seed();
    const unboundId = randomUUID();
    const disabledId = randomUUID();
    const disabledDriverId = randomUUID();
    await own.addUser(unboundId, 'DRIVER');
    await own.addUser(disabledId, 'DRIVER', 'disabled');
    await own.addDriver(disabledDriverId);
    await store.bind(own.organizationId, own.driverId, own.userId, own.adminId,
      '2026-10-27T16:00:00.000Z');
    await source.query(`INSERT INTO driver_accounts (organization_id, driver_id, user_id)
      VALUES ($1,$2,$3)`, [own.organizationId, disabledDriverId, disabledId]);

    const accounts = await store.listAccounts(own.organizationId);

    expect(accounts).toEqual([
      { userId: unboundId, email: `${unboundId}@example.test`, status: 'active', driverId: null },
      { userId: own.userId, email: `${own.userId}@example.test`, status: 'active', driverId: own.driverId },
      { userId: disabledId, email: `${disabledId}@example.test`, status: 'disabled', driverId: disabledDriverId },
    ].sort((left, right) => left.email.localeCompare(right.email)));
    expect(accounts).not.toContainEqual(expect.objectContaining({ userId: other.userId }));
    expect(JSON.stringify(accounts)).not.toContain('test-only-hash');
    expect(accounts.every((account) => !('passwordHash' in account))).toBe(true);
  });

  it('rejects foreign, inactive and non-DRIVER accounts with no writes', async () => {
    const own = await seed();
    const other = await seed();
    const managerId = randomUUID();
    const disabledId = randomUUID();
    await own.addUser(managerId, 'DISPATCHER');
    await own.addUser(disabledId, 'DRIVER', 'disabled');
    const dataHash = async () => {
      const links = await source.query(`SELECT driver_id, user_id FROM driver_accounts
        WHERE organization_id=$1 ORDER BY driver_id`, [own.organizationId]);
      const history = await source.query(`SELECT driver_id, from_user_id, to_user_id
        FROM driver_account_binding_history WHERE organization_id=$1 ORDER BY driver_id, occurred_at`,
      [own.organizationId]);
      return createHash('sha256').update(JSON.stringify({ links, history })).digest('hex');
    };
    const beforeHash = await dataHash();
    for (const userId of [other.userId, managerId, disabledId]) {
      await expect(store.bind(own.organizationId, own.driverId, userId, own.adminId,
        '2026-10-27T16:00:00.000Z')).rejects.toThrow();
    }
    await expect(store.bind(own.organizationId, own.driverId, own.userId, managerId,
      '2026-10-27T16:00:00.000Z')).rejects.toThrow();
    expect(await store.get(own.organizationId, own.driverId))
      .toEqual({ driverId: own.driverId, userId: null });
    expect((await source.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM driver_account_binding_history WHERE driver_id=$1`,
      [own.driverId]))[0]?.count).toBe(0);
    await expect(store.get(other.organizationId, own.driverId)).rejects.toThrow();
    await expect(source.query(`INSERT INTO driver_accounts (organization_id, driver_id, user_id)
      VALUES ($1,$2,$3)`, [own.organizationId, own.driverId, other.userId])).rejects.toThrow();
    expect(await dataHash()).toBe(beforeHash);
  });

  it('allows exactly one of two concurrent bindings of the same account', async () => {
    const ctx = await seed();
    const otherDriverId = randomUUID();
    await ctx.addDriver(otherDriverId);
    const at = '2026-10-27T16:00:00.000Z';
    const results = await Promise.allSettled([
      store.bind(ctx.organizationId, ctx.driverId, ctx.userId, ctx.adminId, at),
      store.bind(ctx.organizationId, otherDriverId, ctx.userId, ctx.adminId, at),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rows = await source.query<{ driver_id: string }[]>(
      `SELECT driver_id FROM driver_accounts WHERE user_id=$1`, [ctx.userId]);
    expect(rows).toHaveLength(1);
    expect([ctx.driverId, otherDriverId]).toContain(rows[0]?.driver_id);
    expect((await source.query<{ id: string }[]>(
      `SELECT id FROM driver_account_binding_history WHERE organization_id=$1`,
      [ctx.organizationId]))).toHaveLength(1);
  });

  it('rejects linking an account while the driver has an active simulated route', async () => {
    const ctx = await seed();
    const at = '2026-10-27T16:00:00.000Z';
    const vehicleId = randomUUID();
    const routeId = randomUUID();
    await source.query(`INSERT INTO vehicles (id, organization_id, plate, type, capacity_kg,
      status, created_at, updated_at) VALUES ($1,$2,$3,'van',800,'active',now(),now())`,
    [vehicleId, ctx.organizationId, `S${vehicleId.slice(0, 6).toUpperCase()}`]);
    // A legacy opted-in route without a simulation actor never auto-closes, so it must not block.
    await source.query(`INSERT INTO delivery_routes (id, organization_id, public_code, planned_date,
      driver_id, vehicle_id, status, created_at, started_at, simulated_completion_enabled)
      VALUES ($1,$2,'SIM-BIND-1','2026-10-27',$3,$4,'in_progress',now(),now(),true)`,
    [routeId, ctx.organizationId, ctx.driverId, vehicleId]);
    await expect(store.bind(ctx.organizationId, ctx.driverId, ctx.userId, ctx.adminId, at))
      .resolves.toEqual({ driverId: ctx.driverId, userId: ctx.userId });
    await store.bind(ctx.organizationId, ctx.driverId, null, ctx.adminId, at);
    await source.query(`DELETE FROM driver_account_binding_history WHERE driver_id=$1`, [ctx.driverId]);

    // A dispatcher-owned simulation records its planning actor: that one blocks the link.
    await source.query(`UPDATE delivery_routes SET simulation_actor_user_id=$2 WHERE id=$1`,
      [routeId, ctx.adminId]);
    await expect(store.bind(ctx.organizationId, ctx.driverId, ctx.userId, ctx.adminId, at))
      .rejects.toMatchObject({ code: 'DRIVER_INVARIANT_VIOLATION',
        message: 'Driver has an active simulated route' });
    expect(await store.get(ctx.organizationId, ctx.driverId)).toEqual({ driverId: ctx.driverId, userId: null });
    expect(await source.query(`SELECT id FROM driver_account_binding_history WHERE driver_id=$1`,
      [ctx.driverId])).toHaveLength(0);

    await source.query(`UPDATE delivery_routes SET status='completed', completed_at=now() WHERE id=$1`, [routeId]);
    await expect(store.bind(ctx.organizationId, ctx.driverId, ctx.userId, ctx.adminId, at))
      .resolves.toEqual({ driverId: ctx.driverId, userId: ctx.userId });
  });
});
