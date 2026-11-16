import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  DRIVER_ID,
  OTHER_ADMIN_ID,
  OTHER_ORGANIZATION_ID,
  buildTestApp,
} from './support/test-app.js';

const driverBody = {
  fullName: 'Valeria Gomez',
  documentNumber: 'DNI-123456',
  phone: '+51 987 123 456',
  licenseNumber: 'A-123456',
  status: 'active',
};

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('driver catalog and account selection', () => {
  it('keeps driver catalog and account options inside the operator/admin boundary', async () => {
    const testApp = buildTestApp();
    await testApp.seedOrganization();
    const admin = await testApp.seedUser();
    const driver = await testApp.seedUser({ id: DRIVER_ID, email: 'driver@lima.test', role: 'DRIVER' });
    const adminToken = await testApp.signIn(admin);
    const driverToken = await testApp.signIn(driver);
    const created = await request(testApp.app).post('/api/v1/drivers')
      .set(bearer(adminToken)).send(driverBody);
    expect(created.status).toBe(201);

    const [catalog, accountOptions, detail] = await Promise.all([
      request(testApp.app).get('/api/v1/drivers').set(bearer(driverToken)),
      request(testApp.app).get('/api/v1/drivers/accounts').set(bearer(driverToken)),
      request(testApp.app).get(`/api/v1/drivers/${created.body.data.id}`).set(bearer(driverToken)),
    ]);

    for (const response of [catalog, accountOptions, detail]) {
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
    }
  });

  it('returns only same-tenant DRIVER accounts with binding state to an ADMIN', async () => {
    const testApp = buildTestApp();
    await testApp.seedOrganization();
    const admin = await testApp.seedUser();
    const adminToken = await testApp.signIn(admin);
    const linkedAccount = await testApp.seedUser({ id: DRIVER_ID, email: 'linked@lima.test', role: 'DRIVER' });
    const availableAccount = await testApp.seedUser({ id: '33333333-3333-4333-8333-333333333334', email: 'available@lima.test', role: 'DRIVER' });
    await testApp.seedUser({ id: '33333333-3333-4333-8333-333333333335', email: 'disabled@lima.test', role: 'DRIVER', status: 'disabled' });
    await testApp.seedUser({ id: OTHER_ADMIN_ID, organizationId: OTHER_ORGANIZATION_ID, email: 'foreign@callao.test', role: 'DRIVER' });
    const driver = await request(testApp.app).post('/api/v1/drivers').set(bearer(adminToken)).send(driverBody);
    expect(driver.status).toBe(201);
    const linked = await request(testApp.app).put(`/api/v1/drivers/${driver.body.data.id}/account`)
      .set(bearer(adminToken)).send({ userId: linkedAccount.id });
    expect(linked.status).toBe(200);

    const response = await request(testApp.app).get('/api/v1/drivers/accounts').set(bearer(adminToken));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      { userId: availableAccount.id, email: availableAccount.email, status: 'active', driverId: null },
      { userId: linkedAccount.id, email: linkedAccount.email, status: 'active', driverId: driver.body.data.id },
    ].sort((left, right) => left.email.localeCompare(right.email)));
    expect(response.body.data.some((account: { userId: string }) =>
      account.userId === '33333333-3333-4333-8333-333333333335')).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('allows DISPATCHER catalog management but reserves account selection and binding for ADMIN', async () => {
    const testApp = buildTestApp();
    await testApp.seedOrganization();
    const dispatcher = await testApp.seedUser({ id: '33333333-3333-4333-8333-333333333336', email: 'dispatch@lima.test', role: 'DISPATCHER' });
    const token = await testApp.signIn(dispatcher);

    const [catalog, accounts] = await Promise.all([
      request(testApp.app).get('/api/v1/drivers').set(bearer(token)),
      request(testApp.app).get('/api/v1/drivers/accounts').set(bearer(token)),
    ]);

    expect(catalog.status).toBe(200);
    expect(accounts.status).toBe(403);
    expect(accounts.body.error.code).toBe('AUTH_FORBIDDEN');
  });

  /** Four own drivers (one inactive, one linked to an account) and one in the other organization. */
  async function seedCrew() {
    const testApp = buildTestApp();
    await testApp.seedOrganization();
    await testApp.seedOrganization({ id: OTHER_ORGANIZATION_ID, name: 'Callao Freight' });
    const admin = await testApp.seedUser();
    const adminToken = await testApp.signIn(admin);
    const otherAdmin = await testApp.seedUser({
      id: OTHER_ADMIN_ID, organizationId: OTHER_ORGANIZATION_ID, email: 'admin@callao.test', role: 'ADMIN',
    });
    const otherToken = await testApp.signIn(otherAdmin);
    const account = await testApp.seedUser({ id: DRIVER_ID, email: 'linked@lima.test', role: 'DRIVER' });
    const create = async (token: string, overrides: Record<string, unknown>) => {
      const response = await request(testApp.app).post('/api/v1/drivers').set(bearer(token))
        .send({ ...driverBody, ...overrides });
      expect(response.status).toBe(201);
      return response.body.data as { id: string };
    };
    const valeria = await create(adminToken, { fullName: 'Valeria Gómez', documentNumber: 'DNI-100', licenseNumber: 'A-100', phone: '911 111 111' });
    const bruno = await create(adminToken, { fullName: 'Bruno Díaz_Ruiz', documentNumber: 'DNI-200', licenseNumber: 'B-200', phone: '922 222 222' });
    const carla = await create(adminToken, { fullName: 'Carla Ríos', documentNumber: 'DNI-300', licenseNumber: 'A-300', phone: '933 333 333', status: 'inactive' });
    const ana = await create(adminToken, { fullName: 'Ana Quispe', documentNumber: 'DNI-400', licenseNumber: 'A-400', phone: '944 444 444' });
    const foreign = await create(otherToken, { fullName: 'Ana Foránea', documentNumber: 'DNI-100', licenseNumber: 'A-100', phone: '955 555 555' });
    const linked = await request(testApp.app).put(`/api/v1/drivers/${bruno.id}/account`)
      .set(bearer(adminToken)).send({ userId: account.id });
    expect(linked.status).toBe(200);
    return { testApp, adminToken, otherToken, valeria, bruno, carla, ana, foreign };
  }

  it('pages drivers by name with status and account facets, scoped to the organization', async () => {
    const { testApp, adminToken, otherToken, valeria, bruno, carla, ana, foreign } = await seedCrew();
    const list = (query: Record<string, string>, token = adminToken) =>
      request(testApp.app).get('/api/v1/drivers').query(query).set(bearer(token));
    const ids = async (query: Record<string, string>) =>
      (await list(query)).body.data.map((driver: { id: string }) => driver.id);

    const first = await list({});
    expect(first.status).toBe(200);
    expect(first.body.data.map((driver: { id: string }) => driver.id)).toEqual([ana.id, bruno.id, carla.id, valeria.id]);
    expect(first.body.meta).toEqual({
      page: 1, pageSize: 20, total: 4,
      counts: { status: { active: 3, inactive: 1 }, account: { linked: 1, unlinked: 3 } },
    });

    await expect(ids({ sort: 'fullName:desc' })).resolves.toEqual([valeria.id, carla.id, bruno.id, ana.id]);
    await expect(ids({ sort: 'createdAt:asc' })).resolves.toEqual([valeria.id, bruno.id, carla.id, ana.id]);
    const second = await list({ page: '2', pageSize: '3' });
    expect(second.body.data.map((driver: { id: string }) => driver.id)).toEqual([valeria.id]);

    // Segment filters: the facets ignore both, so every chip keeps its count.
    const inactive = await list({ status: 'inactive' });
    expect(inactive.body.data.map((driver: { id: string }) => driver.id)).toEqual([carla.id]);
    expect(inactive.body.meta.counts).toEqual({ status: { active: 3, inactive: 1 }, account: { linked: 1, unlinked: 3 } });
    const unlinked = await list({ account: 'unlinked' });
    expect(unlinked.body.data.map((driver: { id: string }) => driver.id)).toEqual([ana.id, carla.id, valeria.id]);
    expect(unlinked.body.meta).toMatchObject({ total: 3, counts: { status: { active: 3, inactive: 1 } } });
    await expect(ids({ account: 'linked' })).resolves.toEqual([bruno.id]);

    // Search ignores case and accents across name, document, license and phone.
    await expect(ids({ q: 'gomez' })).resolves.toEqual([valeria.id]);
    await expect(ids({ q: 'DÍAZ' })).resolves.toEqual([bruno.id]);
    await expect(ids({ q: 'dni-300' })).resolves.toEqual([carla.id]);
    await expect(ids({ q: 'a-400' })).resolves.toEqual([ana.id]);
    await expect(ids({ q: '911 111' })).resolves.toEqual([valeria.id]);
    await expect(ids({ q: '_' })).resolves.toEqual([bruno.id]);
    const searched = await list({ q: 'ana' });
    expect(searched.body.meta).toMatchObject({ total: 1, counts: { status: { active: 1, inactive: 0 }, account: { linked: 0, unlinked: 1 } } });

    await expect(ids({ ids: `${ana.id},${foreign.id}` })).resolves.toEqual([ana.id]);
    const other = await list({}, otherToken);
    expect(other.body.data.map((driver: { id: string }) => driver.id)).toEqual([foreign.id]);
  });

  it.each([
    ['an unknown sort field', { sort: 'phone:asc' }],
    ['an unknown status', { status: 'retired' }],
    ['an unknown account state', { account: 'pending' }],
    ['a page size above 100', { pageSize: '101' }],
    ['an unknown parameter', { limit: '5' }],
  ])('returns 400 for %s', async (_label, query) => {
    const testApp = buildTestApp();
    await testApp.seedOrganization();
    const token = await testApp.signIn(await testApp.seedUser());

    const response = await request(testApp.app).get('/api/v1/drivers').query(query).set(bearer(token));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('DRIVER_INVALID_INPUT');
  });

  it('keeps the whole tenant crew, oldest first, at /drivers/options for operators only', async () => {
    const { testApp, adminToken, valeria, bruno, carla, ana } = await seedCrew();
    const driverToken = await testApp.signIn(await testApp.seedUser({
      id: '33333333-3333-4333-8333-333333333339', email: 'plain-driver@lima.test', role: 'DRIVER',
    }));

    const response = await request(testApp.app).get('/api/v1/drivers/options').set(bearer(adminToken));
    const forbidden = await request(testApp.app).get('/api/v1/drivers/options').set(bearer(driverToken));

    expect(response.status).toBe(200);
    expect(response.body.data.map((driver: { id: string }) => driver.id)).toEqual([valeria.id, bruno.id, carla.id, ana.id]);
    expect(response.body.meta).toBeUndefined();
    expect(forbidden.status).toBe(403);
  });
});
