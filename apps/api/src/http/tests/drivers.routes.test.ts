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
});
