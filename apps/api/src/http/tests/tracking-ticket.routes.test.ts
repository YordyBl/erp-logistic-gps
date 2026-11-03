import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { buildTestApp, bearer, validOrderBody } from './support/test-app.js';

describe('WebSocket ticket endpoint', () => {
  it('requires authentication and returns a non-cacheable one-use ticket for the current identity', async () => {
    const issueTicket = vi.fn().mockReturnValue({
      ticket: 'opaque-one-use-ticket',
      expiresAt: '2026-11-02T12:00:30.000Z',
    });
    const trackingHub = { issueTicket, publish: vi.fn().mockResolvedValue(undefined) };
    const testApp = buildTestApp({ trackingHub });
    await testApp.seedOrganization();
    const user = await testApp.seedUser();
    const token = await testApp.signIn(user);

    const unauthorized = await request(testApp.app).post('/api/v1/tracking/ticket');
    const issued = await request(testApp.app).post('/api/v1/tracking/ticket')
      .set(bearer(token)).set('Origin', 'http://localhost:5173');

    expect(unauthorized.status).toBe(401);
    expect(issueTicket).toHaveBeenCalledTimes(1);
    expect(issueTicket).toHaveBeenCalledWith({
      id: user.id,
      organizationId: user.organizationId,
      role: user.role,
    }, 'http://localhost:5173');
    expect(issued.status).toBe(201);
    expect(issued.headers['cache-control']).toBe('private, no-store');
    expect(issued.body.data).toEqual({
      ticket: 'opaque-one-use-ticket',
      expiresAt: '2026-11-02T12:00:30.000Z',
    });
  });

  it('publishes only successful order mutations to the authenticated tenant channel', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const trackingHub = { issueTicket: vi.fn(), publish };
    const testApp = buildTestApp({ seedTestCustomer: true, trackingHub });
    await testApp.seedOrganization();
    const admin = await testApp.seedUser();
    const token = await testApp.signIn(admin);

    const rejected = await request(testApp.app).post('/api/v1/delivery-orders')
      .set(bearer(token)).send({ invalid: true });
    const created = await request(testApp.app).post('/api/v1/delivery-orders')
      .set(bearer(token)).send(validOrderBody());

    expect(rejected.status).toBe(400);
    expect(created.status).toBe(201);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(admin.organizationId, 'order');
  });

});
