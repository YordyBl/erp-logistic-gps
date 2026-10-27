import { describe, expect, it } from 'vitest';

import {
  canTransitionDeliveryOrderStatus,
  DELIVERY_ORDER_STATUSES,
  INITIAL_DELIVERY_ORDER_STATUS,
  isDeliveryOrderStatus,
} from '../domain/policies/DeliveryOrderStatusPolicy.js';

describe('DeliveryOrderStatusPolicy', () => {
  it('starts every order in created', () => {
    expect(INITIAL_DELIVERY_ORDER_STATUS).toBe('created');
  });

  it('publishes the canonical order-side vocabulary', () => {
    expect([...DELIVERY_ORDER_STATUSES]).toEqual([
      'created',
      'planned',
      'assigned',
      'in_transit',
      'delivered',
      'returned',
      'cancelled',
    ]);
  });

  it('allows the delivery and warehouse-return path', () => {
    expect(canTransitionDeliveryOrderStatus('created', 'planned')).toBe(true);
    expect(canTransitionDeliveryOrderStatus('planned', 'assigned')).toBe(true);
    expect(canTransitionDeliveryOrderStatus('assigned', 'in_transit')).toBe(true);
    expect(canTransitionDeliveryOrderStatus('in_transit', 'delivered')).toBe(true);
    expect(canTransitionDeliveryOrderStatus('in_transit', 'returned')).toBe(true);
  });

  it('rejects skipping steps and leaving terminal states', () => {
    expect(canTransitionDeliveryOrderStatus('created', 'delivered')).toBe(false);
    expect(canTransitionDeliveryOrderStatus('delivered', 'returned')).toBe(false);
    expect(canTransitionDeliveryOrderStatus('returned', 'planned')).toBe(false);
    expect(canTransitionDeliveryOrderStatus('cancelled', 'created')).toBe(false);
  });

  it('recognizes only canonical status values', () => {
    expect(isDeliveryOrderStatus('in_transit')).toBe(true);
    expect(isDeliveryOrderStatus('failed')).toBe(false);
    expect(isDeliveryOrderStatus('')).toBe(false);
  });
});
