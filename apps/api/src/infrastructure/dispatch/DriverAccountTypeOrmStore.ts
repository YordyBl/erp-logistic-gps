import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

import type { DriverAccountBindingStore, DriverAccountOption } from '../../modules/drivers/application/ports/DriverAccountBindingStore.js';
import { DriverInvariantError, DriverNotFoundError } from '../../modules/drivers/domain/errors/DriverError.js';
import { DriverEntity } from '../../modules/drivers/infrastructure/persistence/entities/DriverEntity.js';
import { UserEntity } from '../../modules/identity-and-access/infrastructure/persistence/entities/UserEntity.js';
import { readPostgresDriverError } from '../../modules/drivers/infrastructure/persistence/postgres-error.js';

interface BindingRow { readonly driver_id: string; readonly user_id: string }
interface DriverAccountOptionRow {
  readonly userId: string;
  readonly email: string;
  readonly status: 'active' | 'disabled';
  readonly driverId: string | null;
}

/** Database-owned binding and audit; tenant, account role and uniqueness share one transaction. */
export class DriverAccountTypeOrmStore implements DriverAccountBindingStore {
  constructor(private readonly source: DataSource) {}

  async get(organizationId: string, driverId: string) {
    const driver = await this.source.manager.findOne(DriverEntity, {
      where: { id: driverId, organizationId },
    });
    if (driver === null) throw new DriverNotFoundError(driverId);
    const rows = await this.source.query<BindingRow[]>(
      `SELECT user_id FROM driver_accounts WHERE organization_id=$1 AND driver_id=$2`,
      [organizationId, driverId]);
    return { driverId, userId: rows[0]?.user_id ?? null };
  }

  async listAccounts(organizationId: string): Promise<DriverAccountOption[]> {
    return this.source.query<DriverAccountOptionRow[]>(
      `SELECT users.id AS "userId", users.email AS email, users.status AS status,
        driver_accounts.driver_id AS "driverId"
       FROM users
       LEFT JOIN driver_accounts
         ON driver_accounts.organization_id=users.organization_id
        AND driver_accounts.user_id=users.id
       WHERE users.organization_id=$1 AND users.role='DRIVER'
         AND (users.status='active' OR driver_accounts.driver_id IS NOT NULL)
       ORDER BY users.email ASC, users.id ASC`,
      [organizationId]);
  }

  async findDriverId(organizationId: string, userId: string): Promise<string | null> {
    const rows = await this.source.query<BindingRow[]>(
      `SELECT driver_id FROM driver_accounts WHERE organization_id=$1 AND user_id=$2`,
      [organizationId, userId]);
    return rows[0]?.driver_id ?? null;
  }

  async bind(organizationId: string, driverId: string, userId: string | null,
    actorUserId: string, occurredAt: string) {
    try {
      return await this.source.transaction(async (manager) => {
        const driver = await manager.findOne(DriverEntity, {
          where: { id: driverId, organizationId }, lock: { mode: 'pessimistic_write' },
        });
        if (driver === null) throw new DriverNotFoundError(driverId);
        const actor = await manager.findOne(UserEntity, {
          where: { id: actorUserId, organizationId }, lock: { mode: 'pessimistic_read' },
        });
        if (actor === null || actor.role !== 'ADMIN' || actor.status !== 'active') {
          throw new DriverInvariantError('Only an active ADMIN account can bind drivers');
        }
        if (userId !== null) {
          const user = await manager.findOne(UserEntity, {
            where: { id: userId, organizationId }, lock: { mode: 'pessimistic_read' },
          });
          if (user === null) throw new DriverNotFoundError(driverId);
          if (user.role !== 'DRIVER' || user.status !== 'active') {
            throw new DriverInvariantError('Only an active DRIVER account can be linked');
          }
          // The driver row lock above serializes this check with simulated route planning.
          const simulated = await manager.query<unknown[]>(
            `SELECT 1 FROM delivery_routes WHERE organization_id=$1 AND driver_id=$2
              AND simulated_completion_enabled=true AND status IN ('planned','in_progress')`,
            [organizationId, driverId]);
          if (simulated.length > 0) {
            throw new DriverInvariantError('Driver has an active simulated route');
          }
        }
        const rows = await manager.query<BindingRow[]>(
          `SELECT user_id FROM driver_accounts WHERE organization_id=$1 AND driver_id=$2`,
          [organizationId, driverId]);
        const previous = rows[0]?.user_id ?? null;
        if (previous === userId) return { driverId, userId };
        if (previous !== null) {
          await manager.query(`DELETE FROM driver_accounts WHERE organization_id=$1 AND driver_id=$2`,
            [organizationId, driverId]);
        }
        if (userId !== null) {
          await manager.query(`INSERT INTO driver_accounts (organization_id, driver_id, user_id)
            VALUES ($1,$2,$3)`, [organizationId, driverId, userId]);
        }
        await manager.query(`INSERT INTO driver_account_binding_history
          (id, organization_id, driver_id, from_user_id, to_user_id, actor_user_id, occurred_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [randomUUID(), organizationId, driverId, previous, userId, actorUserId, occurredAt]);
        return { driverId, userId };
      });
    } catch (error) {
      if (readPostgresDriverError(error)?.constraint === 'driver_accounts_user_id_key') {
        throw new DriverInvariantError('Account is linked to another driver');
      }
      throw error;
    }
  }
}
