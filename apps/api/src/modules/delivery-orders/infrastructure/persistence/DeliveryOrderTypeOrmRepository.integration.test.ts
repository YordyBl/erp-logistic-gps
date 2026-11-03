import { randomUUID } from 'node:crypto';

import { In, type DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDataSource } from '../../../../infrastructure/database/data-source.js';
import { GetDeliveryOrderUseCase } from '../../application/use-cases/get-delivery-order/GetDeliveryOrderUseCase.js';
import { DeliveryOrder } from '../../domain/entities/DeliveryOrder.js';
import {
  DeliveryOrderForbiddenError,
  DeliveryOrderInvariantError,
  DeliveryOrderNotFoundError,
} from '../../domain/errors/DeliveryOrderError.js';
import { toDeliveryOrderDto } from '../../application/dto/DeliveryOrderDto.js';
import { DeliveryAddress } from '../../domain/value-objects/DeliveryAddress.js';
import { Package } from '../../domain/value-objects/Package.js';
import { Recipient } from '../../domain/value-objects/Recipient.js';
import { DeliveryOrderTypeOrmRepository } from './DeliveryOrderTypeOrmRepository.js';
import { DeliveryOrderEntity } from './entities/DeliveryOrderEntity.js';
import { DeliveryOrderStatusHistoryEntity } from './entities/DeliveryOrderStatusHistoryEntity.js';
import { probeIntegrationDatabase } from './test-database.js';
import { Organization } from '../../../identity-and-access/domain/entities/Organization.js';
import { OrganizationTypeOrmRepository } from '../../../identity-and-access/infrastructure/persistence/OrganizationTypeOrmRepository.js';
import { OrganizationEntity } from '../../../identity-and-access/infrastructure/persistence/entities/OrganizationEntity.js';

const CREATED_AT = '2026-10-26T15:00:00.000Z';

const database = await probeIntegrationDatabase();

if (!database.available) {
  process.stderr.write(
    `[delivery-orders:integration] Skipping PostgreSQL adapter tests: ${database.reason}. ` +
      'Start the compose PostgreSQL service and set DATABASE_URL to run them.\n',
  );
}

const databaseUrl = database.available ? database.url : null;

describe.skipIf(databaseUrl === null)('DeliveryOrderTypeOrmRepository (PostgreSQL)', () => {
  let dataSource: DataSource | undefined;
  let repository: DeliveryOrderTypeOrmRepository | undefined;
  let organizations: OrganizationTypeOrmRepository | undefined;
  const organizationIds: string[] = [];
  const customerIds = new Map<string, string>();

  beforeAll(async () => {
    if (databaseUrl === null) {
      return;
    }

    dataSource = createDataSource({ url: databaseUrl });
    await dataSource.initialize();
    repository = new DeliveryOrderTypeOrmRepository(dataSource);
    organizations = new OrganizationTypeOrmRepository(dataSource);
  });

  afterAll(async () => {
    if (dataSource === undefined || !dataSource.isInitialized) {
      return;
    }

    if (organizationIds.length > 0) {
      await dataSource.getRepository(DeliveryOrderStatusHistoryEntity).delete({
        organizationId: In(organizationIds),
      });
      // The package rows cascade with their order, so one tenant-scoped delete
      // is enough and no test row leaks into a later run. Organizations are
      // removed last because the order FK is RESTRICT.
      await dataSource
        .getRepository(DeliveryOrderEntity)
        .delete({ organizationId: In(organizationIds) });
      await dataSource.query('DELETE FROM customers WHERE organization_id = ANY($1::uuid[])', [organizationIds]);
      await dataSource
        .getRepository(OrganizationEntity)
        .delete({ id: In(organizationIds) });
    }

    await dataSource.destroy();
  });

  function repositoryOrThrow(): DeliveryOrderTypeOrmRepository {
    if (repository === undefined) {
      throw new Error('The repository adapter was not initialized');
    }

    return repository;
  }

  function dataSourceOrThrow(): DataSource {
    if (dataSource === undefined) {
      throw new Error('The test data source was not initialized');
    }

    return dataSource;
  }

  function organizationsOrThrow(): OrganizationTypeOrmRepository {
    if (organizations === undefined) {
      throw new Error('The organization repository adapter was not initialized');
    }

    return organizations;
  }

  /**
   * Creates the tenant row before any order references it: migration 2 added
   * `fk_delivery_orders_organization`, so a random id alone is no longer a
   * valid tenant.
   */
  async function newOrganizationId(): Promise<string> {
    const organizationId = randomUUID();
    organizationIds.push(organizationId);

    await organizationsOrThrow().save(
      Organization.create({
        id: organizationId,
        name: 'Delivery Orders Integration',
        createdAt: CREATED_AT,
      }),
    );
    const customerId = randomUUID();
    customerIds.set(organizationId, customerId);
    await dataSourceOrThrow().query(`INSERT INTO customers
      (id, organization_id, public_code, name, contact_name, contact_email, contact_phone, status, created_at)
      VALUES ($1,$2,'TEST-CUSTOMER','Integration Customer','Test Contact','integration@example.test','+51 900 000 001','active',$3)`,
    [customerId, organizationId, CREATED_AT]);

    return organizationId;
  }

  function buildOrder(organizationId: string, publicCode: string): DeliveryOrder {
    return DeliveryOrder.create({
      id: randomUUID(),
      organizationId,
      customerId: customerIds.get(organizationId)!,
      timeWindow: 'AM',
      publicCode,
      recipient: Recipient.create({
        name: 'Ana Quispe',
        phone: '+51 987 654 321',
      }),
      deliveryAddress: DeliveryAddress.create({
        addressLine: 'Av. Arequipa 1234, Dpto 501',
        district: 'Lince',
        latitude: -12.0716,
        longitude: -77.0365,
      }),
      packages: [
        Package.create({
          code: 'PKG-001',
          description: 'Caja mediana',
          weightKg: 2.5,
        }),
        Package.create({
          code: 'PKG-002',
          description: 'Sobre documentario',
        }),
      ],
      createdAt: CREATED_AT,
    });
  }

  it('round-trips an order with its packages and optional values', async () => {
    const order = buildOrder(await newOrganizationId(), 'LIMA-0001');

    await repositoryOrThrow().save(order);
    const loaded = await repositoryOrThrow().findById(order.id);

    expect(loaded).not.toBeNull();
    expect(toDeliveryOrderDto(loaded as DeliveryOrder)).toEqual(toDeliveryOrderDto(order));
    expect(loaded?.packages.map((item) => item.code)).toEqual(['PKG-001', 'PKG-002']);
  });

  it('atomically edits created order details without crossing tenants or changing status history', async () => {
    const organizationId = await newOrganizationId();
    const otherOrganizationId = await newOrganizationId();
    const order = buildOrder(organizationId, 'EDIT-001');
    const changedAt = '2026-10-26T15:01:00.000Z';
    const changes = {
      recipient: Recipient.create({ name: 'New Recipient', phone: '+51 999 888 777' }),
      deliveryAddress: DeliveryAddress.create({ addressLine: 'Av. Arequipa 900', district: 'Lince' }),
      packages: [Package.create({ code: 'NEW-001', description: 'Parcel' })],
    };
    await repositoryOrThrow().save(order);
    await expect(repositoryOrThrow().editDetails(otherOrganizationId, order.id, changes, changedAt))
      .rejects.toBeInstanceOf(DeliveryOrderForbiddenError);
    expect(toDeliveryOrderDto(await repositoryOrThrow().findById(order.id) as DeliveryOrder))
      .toEqual(toDeliveryOrderDto(order));
    const edited = await repositoryOrThrow().editDetails(organizationId, order.id, changes, changedAt);
    expect(edited.recipient.name).toBe(changes.recipient.name);
    expect(edited.deliveryAddress.latitude).toBeUndefined();
    expect(edited.packages.map((item) => item.code)).toEqual(['NEW-001']);
    expect(edited.createdAt).toBe(CREATED_AT);
    expect(edited.updatedAt).toBe(changedAt);
    expect(toDeliveryOrderDto(await repositoryOrThrow().findById(order.id) as DeliveryOrder))
      .toEqual(toDeliveryOrderDto(edited));
    await expect(repositoryOrThrow().findStatusHistory(organizationId, order.id)).resolves.toEqual([]);
    await repositoryOrThrow().cancel(organizationId, order.id, randomUUID(), changedAt);
    await expect(repositoryOrThrow().editDetails(organizationId, order.id, changes, changedAt))
      .rejects.toBeInstanceOf(DeliveryOrderInvariantError);
    expect((await repositoryOrThrow().findById(order.id))?.recipient.name).toBe('New Recipient');
    await expect(repositoryOrThrow().findStatusHistory(organizationId, order.id)).resolves.toHaveLength(1);
  });

  it('replaces the package rows when an existing aggregate is saved again', async () => {
    const order = buildOrder(await newOrganizationId(), 'SAN-MIGUEL-9');

    await repositoryOrThrow().save(order);
    await repositoryOrThrow().save(order);

    const loaded = await repositoryOrThrow().findById(order.id);
    expect(toDeliveryOrderDto(loaded as DeliveryOrder)).toEqual(toDeliveryOrderDto(order));

    const packages = await dataSourceOrThrow().query<{ count: number }[]>(
      'SELECT count(*)::int AS count FROM delivery_order_packages WHERE delivery_order_id = $1',
      [order.id],
    );
    expect(packages[0]?.count).toBe(2);
  });

  it('atomically persists cancellation with one readable audit record and leaves earlier data intact', async () => {
    const organizationId = await newOrganizationId();
    const order = buildOrder(organizationId, 'AUDIT-100');
    const actorUserId = randomUUID();
    const cancelledAt = '2026-10-26T15:01:00.000Z';
    await repositoryOrThrow().save(order);

    const cancelled = await repositoryOrThrow().cancel(organizationId, order.id, actorUserId, cancelledAt);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.createdAt).toBe(CREATED_AT);
    expect(cancelled.updatedAt).toBe(cancelledAt);
    expect(toDeliveryOrderDto(await repositoryOrThrow().findById(order.id) as DeliveryOrder))
      .toEqual(toDeliveryOrderDto(cancelled));
    expect((await repositoryOrThrow().findById(order.id))?.packages.map((item) => item.code))
      .toEqual(['PKG-001', 'PKG-002']);
    await expect(repositoryOrThrow().findStatusHistory(organizationId, order.id)).resolves.toEqual([
      { fromStatus: 'created', toStatus: 'cancelled', actorUserId, occurredAt: cancelledAt },
    ]);

    await expect(repositoryOrThrow().save(order)).rejects.toBeInstanceOf(DeliveryOrderInvariantError);
    await expect(repositoryOrThrow().cancel(organizationId, order.id, actorUserId, cancelledAt))
      .rejects.toBeInstanceOf(DeliveryOrderInvariantError);
    await expect(repositoryOrThrow().findStatusHistory(organizationId, order.id))
      .resolves.toHaveLength(1);
  });

  it('rolls back status if audit insertion fails, and rejects cross-tenant access without a write', async () => {
    const organizationId = await newOrganizationId();
    const otherOrganizationId = await newOrganizationId();
    const order = buildOrder(organizationId, 'AUDIT-200');
    await repositoryOrThrow().save(order);
    const actorUserId = randomUUID();
    await expect(repositoryOrThrow().cancel(otherOrganizationId, order.id, actorUserId, CREATED_AT))
      .rejects.toBeInstanceOf(DeliveryOrderForbiddenError);
    await expect(repositoryOrThrow().findStatusHistory(otherOrganizationId, order.id))
      .rejects.toBeInstanceOf(DeliveryOrderNotFoundError);

    // The direct adapter call bypasses the use-case UUID check so PostgreSQL
    // rejects the audit row after the status UPDATE, exercising rollback.
    await expect(repositoryOrThrow().cancel(organizationId, order.id, 'invalid-uuid', CREATED_AT))
      .rejects.toThrow();
    expect(toDeliveryOrderDto(await repositoryOrThrow().findById(order.id) as DeliveryOrder))
      .toEqual(toDeliveryOrderDto(order));
    await expect(repositoryOrThrow().findStatusHistory(organizationId, order.id)).resolves.toEqual([]);
  });

  it('returns null for an unknown order id', async () => {
    await expect(repositoryOrThrow().findById(randomUUID())).resolves.toBeNull();
  });

  it('lists tenant orders in stable order, retaining cancelled status and package order', async () => {
    const ownerId = await newOrganizationId();
    const foreignId = await newOrganizationId();
    const first = buildOrder(ownerId, 'LIST-001');
    const second = buildOrder(ownerId, 'LIST-002');
    const foreign = buildOrder(foreignId, 'LIST-003');
    await repositoryOrThrow().save(second);
    await repositoryOrThrow().save(first);
    await repositoryOrThrow().save(foreign);
    await repositoryOrThrow().cancel(ownerId, first.id, randomUUID(), CREATED_AT);

    const listed = await repositoryOrThrow().list(ownerId);
    expect(listed.map((order) => order.id)).toEqual([first.id, second.id].sort());
    expect(listed.find((order) => order.id === first.id)?.status).toBe('cancelled');
    expect(listed.find((order) => order.id === first.id)?.packages.map((item) => item.code))
      .toEqual(['PKG-001', 'PKG-002']);
    const foreignList = await repositoryOrThrow().list(foreignId);
    expect(foreignList.map((order) => order.id)).toEqual([foreign.id]);
    await expect(repositoryOrThrow().list(await newOrganizationId())).resolves.toEqual([]);
  });

  it('enforces public-code uniqueness per organization and scopes the lookup by organization', async () => {
    const firstOrganizationId = await newOrganizationId();
    const secondOrganizationId = await newOrganizationId();
    const first = buildOrder(firstOrganizationId, 'CALLAO-0042');
    const second = buildOrder(secondOrganizationId, 'CALLAO-0042');

    await repositoryOrThrow().save(first);
    await repositoryOrThrow().save(second);

    await expect(
      repositoryOrThrow().findByPublicCode(firstOrganizationId, 'CALLAO-0042'),
    ).resolves.toMatchObject({ id: first.id });
    await expect(
      repositoryOrThrow().findByPublicCode(secondOrganizationId, 'CALLAO-0042'),
    ).resolves.toMatchObject({ id: second.id });
    await expect(
      repositoryOrThrow().findByPublicCode(await newOrganizationId(), 'CALLAO-0042'),
    ).resolves.toBeNull();
  });

  it('rejects a duplicate public code in the same organization without changing the stored order', async () => {
    const organizationId = await newOrganizationId();
    const stored = buildOrder(organizationId, 'MIRAFLORES-7');
    const duplicate = buildOrder(organizationId, 'MIRAFLORES-7');

    await repositoryOrThrow().save(stored);

    await expect(repositoryOrThrow().save(duplicate)).rejects.toBeInstanceOf(
      DeliveryOrderInvariantError,
    );

    await expect(repositoryOrThrow().findById(duplicate.id)).resolves.toBeNull();
    const stillStored = await repositoryOrThrow().findById(stored.id);
    expect(toDeliveryOrderDto(stillStored as DeliveryOrder)).toEqual(toDeliveryOrderDto(stored));
  });

  it('lets the read use case distinguish a foreign order from a missing one', async () => {
    const ownerOrganizationId = await newOrganizationId();
    const otherOrganizationId = await newOrganizationId();
    const order = buildOrder(ownerOrganizationId, 'SURCO-010');

    await repositoryOrThrow().save(order);
    const useCase = new GetDeliveryOrderUseCase({ repository: repositoryOrThrow() });

    await expect(
      useCase.execute({ organizationId: otherOrganizationId, orderId: order.id }),
    ).rejects.toBeInstanceOf(DeliveryOrderForbiddenError);
    await expect(
      useCase.execute({ organizationId: ownerOrganizationId, orderId: randomUUID() }),
    ).rejects.toBeInstanceOf(DeliveryOrderNotFoundError);
    await expect(
      useCase.execute({ organizationId: ownerOrganizationId, orderId: order.id }),
    ).resolves.toMatchObject({ order: { id: order.id, organizationId: ownerOrganizationId } });
  });

  it('stores instants as timestamptz and runs sessions in America/Lima', async () => {
    const order = buildOrder(await newOrganizationId(), 'LA-VICTORIA-3');

    await repositoryOrThrow().save(order);

    const [timezone] = await dataSourceOrThrow().query<{ timezone: string }[]>(
      "SELECT current_setting('timezone') AS timezone",
    );
    const [column] = await dataSourceOrThrow().query<{ data_type: string }[]>(
      `SELECT data_type
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'delivery_orders'
          AND column_name = 'created_at'`,
    );

    expect(timezone?.timezone).toBe('America/Lima');
    expect(column?.data_type).toBe('timestamp with time zone');

    const loaded = await repositoryOrThrow().findById(order.id);
    expect(new Date(loaded?.createdAt ?? '').toISOString()).toBe(CREATED_AT);
  });
});
