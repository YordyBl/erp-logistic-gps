import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { buildTestApp, bearer } from './support/test-app.js';
import type { AppDependencies } from '../app.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const EVIDENCE_ID = '55555555-5555-4555-8555-555555555555';

describe('delivery evidence routes in the composed app', () => {
  it('allows a DRIVER to upload evidence without opening the order catalog', async () => {
    const uploadEvidence = vi.fn().mockResolvedValue({
      evidence: {
        id: EVIDENCE_ID,
        orderId: ORDER_ID,
        attemptId: '44444444-4444-4444-8444-444444444444',
        incidentId: null,
        mimeType: 'image/jpeg',
        byteSize: 4,
        checksum: 'a'.repeat(64),
        uploadedBy: '33333333-3333-4333-8333-333333333333',
        status: 'available',
        createdAt: '2026-11-02T12:00:00.000Z',
        availableAt: '2026-11-02T12:00:00.000Z',
      },
    });
    const deliveryExecution = {
      uploadEvidence: { execute: uploadEvidence },
      listEvidence: { execute: vi.fn().mockResolvedValue({ evidence: [] }) },
      downloadEvidence: { execute: vi.fn() },
    } as unknown as NonNullable<AppDependencies['deliveryExecution']>;
    const testApp = buildTestApp({ deliveryExecution });
    await testApp.seedOrganization({ id: ORGANIZATION_ID });
    const driver = await testApp.seedUser({
      id: '33333333-3333-4333-8333-333333333333',
      role: 'DRIVER',
    });
    const token = await testApp.signIn(driver);

    const upload = await request(testApp.app)
      .post(`/api/v1/delivery-orders/${ORDER_ID}/evidence`)
      .set(bearer(token))
      .set('Content-Type', 'image/jpeg')
      .set('Idempotency-Key', 'evidence-upload-test')
      .send(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const catalog = await request(testApp.app)
      .get('/api/v1/delivery-orders')
      .set(bearer(token));
    const orderDetail = await request(testApp.app)
      .get(`/api/v1/delivery-orders/${ORDER_ID}`)
      .set(bearer(token));

    expect(upload.status).toBe(201);
    expect(uploadEvidence).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORGANIZATION_ID,
      orderId: ORDER_ID,
      actorUserId: driver.id,
      idempotencyKey: 'evidence-upload-test',
      declaredMimeType: 'image/jpeg',
      bytes: expect.any(Buffer),
    }));
    expect(catalog.status).toBe(403);
    expect(orderDetail.status).toBe(403);
  });
});
