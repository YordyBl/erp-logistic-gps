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
import { probeIntegrationDatabase } from './test-database.js';

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
  const organizationIds: string[] = [];

  beforeAll(async () => {
    if (databaseUrl === null) {
      return;
    }

    dataSource = createDataSource({ url: databaseUrl });
    await dataSource.initialize();
    repository = new DeliveryOrderTypeOrmRepository(dataSource);
  });

  afterAll(async () => {
    if (dataSource === undefined || !dataSource.isInitialized) {
      return;
    }

    if (organizationIds.length > 0) {
      // The package rows cascade with their order, so one tenant-scoped delete
      // is enough and no test row leaks into a later run.
      await dataSource
        .getRepository(DeliveryOrderEntity)
        .delete({ organizationId: In(organizationIds) });
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

  function newOrganizationId(): string {
    const organizationId = randomUUID();
    organizationIds.push(organizationId);
    return organizationId;
  }

  function buildOrder(organizationId: string, publicCode: string): DeliveryOrder {
    return DeliveryOrder.create({
      id: randomUUID(),
      organizationId,
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
    const order = buildOrder(newOrganizationId(), 'LIMA-0001');

    await repositoryOrThrow().save(order);
    const loaded = await repositoryOrThrow().findById(order.id);

    expect(loaded).not.toBeNull();
    expect(toDeliveryOrderDto(loaded as DeliveryOrder)).toEqual(toDeliveryOrderDto(order));
    expect(loaded?.packages.map((item) => item.code)).toEqual(['PKG-001', 'PKG-002']);
  });

  it('replaces the package rows when an existing aggregate is saved again', async () => {
    const order = buildOrder(newOrganizationId(), 'SAN-MIGUEL-9');

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

  it('returns null for an unknown order id', async () => {
    await expect(repositoryOrThrow().findById(randomUUID())).resolves.toBeNull();
  });

  it('enforces public-code uniqueness per organization and scopes the lookup by organization', async () => {
    const firstOrganizationId = newOrganizationId();
    const secondOrganizationId = newOrganizationId();
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
      repositoryOrThrow().findByPublicCode(newOrganizationId(), 'CALLAO-0042'),
    ).resolves.toBeNull();
  });

  it('rejects a duplicate public code in the same organization without changing the stored order', async () => {
    const organizationId = newOrganizationId();
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
    const ownerOrganizationId = newOrganizationId();
    const otherOrganizationId = newOrganizationId();
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
    const order = buildOrder(newOrganizationId(), 'LA-VICTORIA-3');

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
