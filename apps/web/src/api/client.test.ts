import { describe, expect, it, vi } from 'vitest';

import { ApiClient } from './client.js';

describe('ApiClient dispatch planning', () => {
  it('uses the authenticated route list, create and reassignment contracts', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const client = new ApiClient({ fetcher, baseUrl: 'http://localhost:3000/api/v1' });
    client.setAccessToken('access-token');

    await client.listDispatchRoutes();
    await client.createDispatchRoute({
      publicCode: 'ROUTE-001', plannedDate: '2026-11-02', driverId: 'driver-1', vehicleId: 'vehicle-1',
      stops: [{ sequence: 1, addressLine: 'Av. Arequipa 100', orderIds: ['order-1', 'order-2'] }],
    });
    await client.reassignDispatchRoute('route/1', { driverId: 'driver-2' });

    const [listUrl, listInit] = fetcher.mock.calls[0] ?? [];
    expect(listUrl).toBe('http://localhost:3000/api/v1/delivery-routes');
    expect(listInit?.method).toBeUndefined();
    expect(new Headers(listInit?.headers).get('Authorization')).toBe('Bearer access-token');
    const [createUrl, createInit] = fetcher.mock.calls[1] ?? [];
    expect(createUrl).toBe('http://localhost:3000/api/v1/delivery-routes');
    expect(createInit?.method).toBe('POST');
    expect(JSON.parse(String(createInit?.body))).toMatchObject({ stops: [{ orderIds: ['order-1', 'order-2'] }] });
    const [reassignUrl, reassignInit] = fetcher.mock.calls[2] ?? [];
    expect(reassignUrl).toBe('http://localhost:3000/api/v1/delivery-routes/route%2F1');
    expect(reassignInit?.method).toBe('PATCH');
    expect(JSON.parse(String(reassignInit?.body))).toEqual({ driverId: 'driver-2' });
  });
});

describe('ApiClient tracking connection', () => {
  it('requests an authenticated one-use ticket over HTTP', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { ticket: 'opaque-ticket', expiresAt: '2026-11-02T12:00:30.000Z' } }), {
        status: 201, headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new ApiClient({ fetcher, baseUrl: '/api/v1' });
    client.setAccessToken('access-token');

    await expect(client.createTrackingTicket()).resolves.toMatchObject({ ticket: 'opaque-ticket' });

    const [url, request] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/tracking/ticket');
    expect(request).toMatchObject({ method: 'POST', body: '{}', credentials: 'include' });
    expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer access-token');
  });
});

describe('ApiClient dispatch dashboard', () => {
  it('loads the authenticated tenant dashboard summary', async () => {
    const summary = {
      ordersAwaitingPlanning: 2, routesInProgress: 1, deliveriesToday: 3, incidentsToday: 0,
      orderStatusCounts: { created: 2, planned: 0, assigned: 1, in_transit: 1, delivered: 3, returned: 0, cancelled: 0 },
      recentOrders: [], recentIncidents: [], activeRoutes: [],
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: summary }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const client = new ApiClient({ fetcher, baseUrl: '/api/v1' });
    client.setAccessToken('access-token');

    await expect(client.getDispatchDashboardSummary()).resolves.toEqual(summary);

    const [url, request] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/dashboard');
    expect(request?.method).toBeUndefined();
    expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer access-token');
  });
});

describe('ApiClient authentication', () => {
  it('sends email and password without a client-supplied organization', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: {
        accessToken: 'access-token',
        accessTokenExpiresAt: '2026-10-30T13:00:00.000Z',
        refreshTokenExpiresAt: '2026-11-06T12:00:00.000Z',
        user: { id: 'user-1', organizationId: 'org-1', email: 'driver@example.test', role: 'DRIVER' },
      } }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const client = new ApiClient({ fetcher, baseUrl: 'http://localhost:3000/api/v1' });

    await client.login('driver@example.test', 'password');

    const [, request] = fetcher.mock.calls[0] ?? [];
    expect(JSON.parse(String(request?.body))).toEqual({
      email: 'driver@example.test',
      password: 'password',
    });
  });
});

describe('ApiClient evidence upload', () => {
  it('sends the raw photo with the assigned order, bearer token, and idempotency key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        data: {
          id: 'evidence-1',
          orderId: 'order-1',
          attemptId: 'attempt-1',
          incidentId: null,
          mimeType: 'image/jpeg',
          byteSize: 4,
          checksum: 'checksum',
          uploadedBy: 'driver-1',
          status: 'available',
          createdAt: '2026-10-29T12:00:00.000Z',
          availableAt: '2026-10-29T12:00:01.000Z',
        },
      }), { status: 201, headers: { 'Content-Type': 'application/json' } }),
    );
    const client = new ApiClient({ fetcher, baseUrl: 'http://localhost:3000/api/v1' });
    client.setAccessToken('access-token');
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'proof.jpg', { type: 'image/jpeg' });

    await client.uploadEvidence('order-1', file, 'retry-key-123');

    const [url, request] = fetcher.mock.calls[0] ?? [];
    const headers = new Headers(request?.headers);
    expect(url).toBe('http://localhost:3000/api/v1/delivery-orders/order-1/evidence');
    expect(request).toMatchObject({ method: 'POST', body: file, credentials: 'include' });
    expect(headers.get('Authorization')).toBe('Bearer access-token');
    expect(headers.get('Content-Type')).toBe('image/jpeg');
    expect(headers.get('Idempotency-Key')).toBe('retry-key-123');
  });
});

describe('ApiClient delivery-order import', () => {
  it('uploads CSV/XLSX as raw file content with the authenticated API client', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { importedOrders: [], rejectedOrders: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new ApiClient({ fetcher, baseUrl: 'http://localhost:3000/api/v1' });
    client.setAccessToken('access-token');
    const file = new File(['csv'], 'orders.csv', { type: 'text/csv' });

    await client.importDeliveryOrders(file);

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:3000/api/v1/delivery-orders/import');
    expect(init).toMatchObject({ method: 'POST', body: file, credentials: 'include' });
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('text/csv');
  });

  it('downloads the generated XLSX template through the authenticated client', async () => {
    const template = new Blob(['xlsx-bytes']);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(template, { status: 200 }));
    const client = new ApiClient({ fetcher, baseUrl: 'http://localhost:3000/api/v1' });

    const result = await client.downloadDeliveryOrderImportTemplate();

    expect(result).toBeInstanceOf(Blob);
    expect(await result.text()).toBe('xlsx-bytes');
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://localhost:3000/api/v1/delivery-orders/import/template');
  });
});

describe('ApiClient customer and order management', () => {
  it('lists and creates customers within the authenticated API context', async () => {
    const customer = {
      id: 'customer-1', organizationId: 'org-1', publicCode: 'CUS-001',
      name: 'Lima Supply', contactName: 'Ana Torres', contactEmail: 'ana@example.test',
      contactPhone: '+51 900 000 001', status: 'active', createdAt: '2026-11-02T10:00:00.000Z',
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [customer] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: customer }), { status: 201 }));
    const client = new ApiClient({ fetcher, baseUrl: '/api/v1' });
    client.setAccessToken('access-token');

    await expect(client.listCustomers()).resolves.toEqual([customer]);
    await expect(client.createCustomer({
      publicCode: 'CUS-001', name: 'Lima Supply', contactName: 'Ana Torres',
      contactEmail: 'ana@example.test', contactPhone: '+51 900 000 001',
    })).resolves.toEqual(customer);

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/v1/customers', '/api/v1/customers']);
    const [, request] = fetcher.mock.calls[1] ?? [];
    expect(JSON.parse(String(request?.body))).toEqual({
      publicCode: 'CUS-001', name: 'Lima Supply', contactName: 'Ana Torres',
      contactEmail: 'ana@example.test', contactPhone: '+51 900 000 001',
    });
    expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer access-token');
  });

  it('lists, creates and cancels delivery orders through the existing order endpoints', async () => {
    const order = {
      id: 'order-1', organizationId: 'org-1', customerId: 'customer-1', publicCode: 'ORD-001',
      timeWindow: 'AM',
      status: 'created', recipient: { name: 'Luis Paredes', phone: '+51 900 000 002' },
      deliveryAddress: { addressLine: 'Av. Lima 123', district: 'Lince', latitude: null, longitude: null },
      packages: [{ code: 'BOX-1', description: 'Caja', weightKg: null }],
      createdAt: '2026-11-02T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z',
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [order] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: order }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ...order, status: 'cancelled' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [
        { fromStatus: 'created', toStatus: 'cancelled', actorUserId: 'admin-1', occurredAt: order.updatedAt },
      ] }), { status: 200 }));
    const client = new ApiClient({ fetcher, baseUrl: '/api/v1' });
    client.setAccessToken('access-token');

    await expect(client.listDeliveryOrders()).resolves.toEqual([order]);
    await expect(client.createDeliveryOrder({
      customerId: 'customer-1', timeWindow: 'AM', publicCode: 'ORD-001', recipient: order.recipient,
      deliveryAddress: { addressLine: 'Av. Lima 123', district: 'Lince' },
      packages: [{ code: 'BOX-1', description: 'Caja' }],
    })).resolves.toEqual(order);
    await expect(client.cancelDeliveryOrder('order-1')).resolves.toMatchObject({ status: 'cancelled' });
    await expect(client.listDeliveryOrderStatusHistory('order-1')).resolves.toMatchObject([
      { fromStatus: 'created', toStatus: 'cancelled', actorUserId: 'admin-1' },
    ]);

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/delivery-orders', '/api/v1/delivery-orders', '/api/v1/delivery-orders/order-1/cancel',
      '/api/v1/delivery-orders/order-1/history',
    ]);
  });
});

describe('ApiClient driver management', () => {
  it('loads drivers and account options and writes only through scoped driver endpoints', async () => {
    const driver = {
      id: 'driver-1', organizationId: 'org-1', fullName: 'Valeria Gomez',
      documentNumber: 'DNI-123456', phone: '+51 987 123 456', licenseNumber: 'A-123456',
      status: 'active', createdAt: '2026-11-02T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z',
    };
    const account = { userId: 'user-1', email: 'driver@example.test', status: 'active', driverId: null };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [driver] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [account] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: driver }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: driver }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { driverId: driver.id, userId: account.userId } }), { status: 200 }));
    const client = new ApiClient({ fetcher, baseUrl: '/api/v1' });
    client.setAccessToken('admin-token');

    await expect(client.listDrivers()).resolves.toEqual([driver]);
    await expect(client.listDriverAccounts()).resolves.toEqual([account]);
    await expect(client.createDriver({
      fullName: driver.fullName, documentNumber: driver.documentNumber,
      phone: driver.phone, licenseNumber: driver.licenseNumber,
    })).resolves.toEqual(driver);
    await expect(client.updateDriver(driver.id, { status: 'inactive' })).resolves.toEqual(driver);
    await expect(client.bindDriverAccount(driver.id, account.userId)).resolves.toEqual({ driverId: driver.id, userId: account.userId });

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/drivers', '/api/v1/drivers/accounts', '/api/v1/drivers',
      '/api/v1/drivers/driver-1', '/api/v1/drivers/driver-1/account',
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toMatchObject({ documentNumber: 'DNI-123456' });
    expect(JSON.parse(String(fetcher.mock.calls[4]?.[1]?.body))).toEqual({ userId: 'user-1' });
  });
});

describe('ApiClient vehicle management', () => {
  it('uses the existing tenant-scoped vehicle catalog endpoints and preserves explicit capacity clearing', async () => {
    const vehicle = {
      id: 'vehicle-1', organizationId: 'org-1', plate: 'ABC-123', type: 'Van', capacityKg: 1200,
      status: 'active', createdAt: '2026-11-02T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z',
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [vehicle] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: vehicle }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ...vehicle, capacityKg: null, status: 'inactive' } }), { status: 200 }));
    const client = new ApiClient({ fetcher, baseUrl: '/api/v1' });
    client.setAccessToken('operator-token');

    await expect(client.listVehicles()).resolves.toEqual([vehicle]);
    await expect(client.createVehicle({ plate: 'abc-123', type: 'Van', capacityKg: 1200 }))
      .resolves.toEqual(vehicle);
    await expect(client.updateVehicle(vehicle.id, { capacityKg: null, status: 'inactive' }))
      .resolves.toMatchObject({ capacityKg: null, status: 'inactive' });

    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
      ['/api/v1/vehicles', 'GET'], ['/api/v1/vehicles', 'POST'], ['/api/v1/vehicles/vehicle-1', 'PATCH'],
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      plate: 'abc-123', type: 'Van', capacityKg: 1200,
    });
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({ capacityKg: null, status: 'inactive' });
  });
});
