import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDataSource } from '../../../../infrastructure/database/data-source.js';
import { RoutePlanningTypeOrmStore } from '../../../../infrastructure/dispatch/RoutePlanningTypeOrmStore.js';
import { DeliveryOrder } from '../../../delivery-orders/domain/entities/DeliveryOrder.js';
import { DeliveryAddress } from '../../../delivery-orders/domain/value-objects/DeliveryAddress.js';
import { Package } from '../../../delivery-orders/domain/value-objects/Package.js';
import { Recipient } from '../../../delivery-orders/domain/value-objects/Recipient.js';
import { DeliveryOrderTypeOrmRepository } from '../../../delivery-orders/infrastructure/persistence/DeliveryOrderTypeOrmRepository.js';
import { probeIntegrationDatabase } from '../../../delivery-orders/infrastructure/persistence/test-database.js';
import { Organization } from '../../../identity-and-access/domain/entities/Organization.js';
import { OrganizationTypeOrmRepository } from '../../../identity-and-access/infrastructure/persistence/OrganizationTypeOrmRepository.js';
import { DeliveryEvidenceTypeOrmStore } from './DeliveryEvidenceTypeOrmStore.js';

const probe = await probeIntegrationDatabase();
if (!probe.available) process.stderr.write(`[evidence-vault:integration] Skipping: ${probe.reason}.\n`);
const url = probe.available ? probe.url : null;
const AT = '2026-10-27T15:00:00.000Z';

interface SeededOrder {
  readonly id: string;
  readonly code: string;
}

describe.skipIf(url === null)('Evidence vault page (PostgreSQL)', () => {
  let source: DataSource;
  let store: DeliveryEvidenceTypeOrmStore;
  const organizations: string[] = [];

  beforeAll(async () => {
    source = createDataSource({ url: url as string });
    await source.initialize();
    store = new DeliveryEvidenceTypeOrmStore(source);
  });

  afterAll(async () => {
    if (!source?.isInitialized) return;
    await source.query(`DELETE FROM delivery_order_packages WHERE delivery_order_id IN
      (SELECT id FROM delivery_orders WHERE organization_id = ANY($1::uuid[]))`, [organizations]);
    for (const table of ['delivery_evidence', 'delivery_attempts', 'delivery_route_status_history',
      'delivery_order_status_history', 'delivery_stop_orders', 'delivery_orders', 'delivery_stops',
      'delivery_routes', 'drivers', 'vehicles', 'users', 'customers']) {
      await source.query(`DELETE FROM "${table}" WHERE organization_id = ANY($1::uuid[])`, [organizations]);
    }
    await source.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [organizations]);
    await source.destroy();
  });

  /**
   * One organization with a route over one order per spec, one attempt per
   * order, each order moved to the spec status. Codes are globally unique.
   */
  async function seed(specs: readonly { readonly suffix: string; readonly status: string; readonly recipient: string }[]) {
    const organizationId = randomUUID();
    const customerId = randomUUID();
    const driverId = randomUUID();
    const vehicleId = randomUUID();
    const userId = randomUUID();
    const tag = organizationId.slice(0, 8).toUpperCase();
    organizations.push(organizationId);
    await new OrganizationTypeOrmRepository(source).save(Organization.create({
      id: organizationId, name: 'Evidence vault integration', createdAt: AT,
    }));
    await source.query(`INSERT INTO customers
      (id, organization_id, public_code, name, contact_name, contact_email, contact_phone, status, created_at)
      VALUES ($1,$2,'VAULT-CUSTOMER','Vault Customer','Contact','vault@example.test','+51 900 000 001','active',$3)`,
    [customerId, organizationId, AT]);
    await source.query(`INSERT INTO users (id, organization_id, email, password_hash, role, status, created_at)
      VALUES ($1,$2,$3,'test-hash','ADMIN','active',$4)`, [userId, organizationId, `${userId}@example.test`, AT]);
    await source.query(`INSERT INTO drivers (id, organization_id, full_name, document_number,
      phone, license_number, status, created_at, updated_at)
      VALUES ($1,$2,'Vault Driver',$3,'+51 911 222 333',$4,'active',$5,$5)`,
    [driverId, organizationId, `DNI-${tag}`, `L-${tag}`, AT]);
    await source.query(`INSERT INTO vehicles (id, organization_id, plate, type, capacity_kg,
      status, created_at, updated_at) VALUES ($1,$2,$3,'van',800,'active',$4,$4)`,
    [vehicleId, organizationId, `V${tag.slice(0, 6)}`, AT]);

    const orderRepository = new DeliveryOrderTypeOrmRepository(source);
    const orders: SeededOrder[] = [];
    for (const spec of specs) {
      const code = `VLT-${tag}-${spec.suffix}`;
      const order = DeliveryOrder.create({
        id: randomUUID(), organizationId, customerId, publicCode: code, timeWindow: 'AM',
        recipient: Recipient.create({ name: spec.recipient, phone: '+51 987 654 321' }),
        deliveryAddress: DeliveryAddress.create({ addressLine: 'Av. Arequipa 1234', district: 'Lince',
          latitude: -12.05, longitude: -77.03 }),
        packages: [Package.create({ code: 'PKG-001', description: 'Parcel' })], createdAt: AT,
      });
      await orderRepository.save(order);
      orders.push({ id: order.id, code });
    }
    const route = await new RoutePlanningTypeOrmStore(source).plan({
      id: randomUUID(), organizationId, driverId, vehicleId, publicCode: `VLT-${tag}`,
      plannedDate: '2026-10-27', status: 'planned', createdAt: AT, simulatedCompletionEnabled: false,
      stops: orders.map((order, index) => ({ id: randomUUID(), sequence: index + 1, orderId: order.id })),
    }, userId);

    const attempts = new Map<string, string>();
    for (const [index, order] of orders.entries()) {
      const attemptId = randomUUID();
      attempts.set(order.id, attemptId);
      await source.query(`INSERT INTO delivery_attempts
        (id, organization_id, order_id, route_id, driver_id, attempt_number, status, started_at)
        VALUES ($1,$2,$3,$4,$5,1,'delivered',$6)`, [attemptId, organizationId, order.id, route.id, driverId, AT]);
      await source.query('UPDATE delivery_orders SET status=$3 WHERE organization_id=$1 AND id=$2',
        [organizationId, order.id, specs[index]!.status]);
    }

    /** Inserts one evidence row; `minute` orders them in time. */
    const addEvidence = async (order: SeededOrder, minute: number, status = 'available') => {
      const id = randomUUID();
      const createdAt = new Date(Date.UTC(2026, 9, 27, 16, minute)).toISOString();
      await source.query(`INSERT INTO delivery_evidence (id, organization_id, order_id, attempt_id,
        incident_id, object_key, mime_type, byte_size, checksum, uploaded_by, idempotency_key,
        status, created_at, available_at)
        VALUES ($1,$2,$3,$4,NULL,$5,'image/jpeg',100,$6,$7,$8,$9,$10,$11)`,
      [id, organizationId, order.id, attempts.get(order.id), `vault/${id}`, 'a'.repeat(64), userId,
        `vault-${id}`, status, createdAt, status === 'available' ? createdAt : null]);
      return { id, createdAt };
    };

    return { organizationId, orders, addEvidence };
  }

  it('lists available evidence of delivered or returned orders newest first, tenant-scoped', async () => {
    const tenant = await seed([
      { suffix: 'A', status: 'delivered', recipient: 'Ana Torres' },
      { suffix: 'B', status: 'returned', recipient: 'Bruno Díaz' },
      { suffix: 'C', status: 'in_transit', recipient: 'Carla Ruiz' },
    ]);
    const other = await seed([{ suffix: 'X', status: 'delivered', recipient: 'Ana Torres' }]);
    const [a, b, c] = tenant.orders as [SeededOrder, SeededOrder, SeededOrder];
    const first = await tenant.addEvidence(a, 1);
    const second = await tenant.addEvidence(b, 2);
    const third = await tenant.addEvidence(a, 3);
    await tenant.addEvidence(a, 4, 'pending_upload');
    await tenant.addEvidence(c, 5);
    await other.addEvidence(other.orders[0]!, 6);

    const page = await store.listVaultPage(tenant.organizationId, { page: 1, pageSize: 2 });
    expect(page.total).toBe(3);
    expect(page.items.map((item) => item.id)).toEqual([third.id, second.id]);
    expect(page.items[1]).toMatchObject({
      organizationId: tenant.organizationId,
      orderId: b.id,
      status: 'available',
      mimeType: 'image/jpeg',
      byteSize: 100,
      createdAt: second.createdAt,
      availableAt: second.createdAt,
      order: { id: b.id, publicCode: b.code, status: 'returned', recipientName: 'Bruno Díaz', district: 'Lince' },
    });
    expect(page.items[1]).not.toHaveProperty('objectKey');

    const next = await store.listVaultPage(tenant.organizationId, { page: 2, pageSize: 2 });
    expect(next).toEqual({ total: 3, items: [expect.objectContaining({ id: first.id })] });
  });

  it('filters by order code or recipient (literal ILIKE) and by order id', async () => {
    const tenant = await seed([
      { suffix: 'A', status: 'delivered', recipient: 'Ana Torres' },
      { suffix: 'B', status: 'delivered', recipient: 'Bruno 100%' },
    ]);
    const [a, b] = tenant.orders as [SeededOrder, SeededOrder];
    const ofA = await tenant.addEvidence(a, 1);
    const ofB = await tenant.addEvidence(b, 2);

    const byCode = await store.listVaultPage(tenant.organizationId, { page: 1, pageSize: 8, q: a.code.toLowerCase() });
    expect(byCode.items.map((item) => item.id)).toEqual([ofA.id]);

    const byRecipient = await store.listVaultPage(tenant.organizationId, { page: 1, pageSize: 8, q: 'torres' });
    expect(byRecipient.items.map((item) => item.id)).toEqual([ofA.id]);

    const literal = await store.listVaultPage(tenant.organizationId, { page: 1, pageSize: 8, q: '100%' });
    expect(literal.items.map((item) => item.id)).toEqual([ofB.id]);
    const wildcard = await store.listVaultPage(tenant.organizationId, { page: 1, pageSize: 8, q: '%' });
    expect(wildcard.items.map((item) => item.id)).toEqual([ofB.id]);

    const byOrder = await store.listVaultPage(tenant.organizationId, { page: 1, pageSize: 8, orderId: b.id });
    expect(byOrder).toEqual({ total: 1, items: [expect.objectContaining({ id: ofB.id })] });

    const empty = await store.listVaultPage(tenant.organizationId, { page: 9, pageSize: 8 });
    expect(empty).toEqual({ total: 2, items: [] });
  });
});
