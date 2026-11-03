import { describe, expect, it } from 'vitest';

import { classifyTrackingMutation } from '../tracking-mutation.js';

describe('classifyTrackingMutation', () => {
  it('publishes route and order state mutations only', () => {
    expect(classifyTrackingMutation('POST', '/api/v1/delivery-routes')).toBe('route');
    expect(classifyTrackingMutation('POST', '/api/v1/delivery-routes/route-id/complete')).toBe('route');
    expect(classifyTrackingMutation('POST', '/api/v1/delivery-orders')).toBe('order');
    expect(classifyTrackingMutation('POST', '/api/v1/delivery-orders/import')).toBe('order');
    expect(classifyTrackingMutation('POST', '/api/v1/delivery-orders/order-id/cancel')).toBe('order');
    expect(classifyTrackingMutation('PATCH', '/api/v1/delivery-orders/order-id')).toBe('order');
  });

  it('ignores reads and mutations that do not change route or order state', () => {
    expect(classifyTrackingMutation('GET', '/api/v1/delivery-orders')).toBeNull();
    expect(classifyTrackingMutation('POST', '/api/v1/delivery-orders/order-id/evidence')).toBeNull();
    expect(classifyTrackingMutation('PUT', '/api/v1/auth/refresh')).toBeNull();
  });
});
