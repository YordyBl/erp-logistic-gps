import { describe, expect, it } from 'vitest';

import { WebSocketTicketStore } from '../infrastructure/WebSocketTicketStore.js';

const identity = {
  id: 'a92a4997-812b-4539-99e6-6f8b0de81325',
  organizationId: '1ef02128-d9e3-41f4-86af-c2a29c08b87c',
  role: 'DISPATCHER' as const,
};

describe('WebSocketTicketStore', () => {
  it('issues opaque tickets and consumes each ticket exactly once', () => {
    const store = new WebSocketTicketStore({ ttlMilliseconds: 1_000, now: () => 10_000 });
    const issued = store.issue(identity);

    expect(issued.ticket).not.toContain(identity.id);
    expect(issued.expiresAt).toBe(new Date(11_000).toISOString());
    expect(store.consume(issued.ticket)).toEqual(identity);
    expect(store.consume(issued.ticket)).toBeNull();
  });

  it('rejects expired tickets without returning their identity', () => {
    let now = 10_000;
    const store = new WebSocketTicketStore({ ttlMilliseconds: 1_000, now: () => now });
    const issued = store.issue(identity);
    now = 11_000;

    expect(store.consume(issued.ticket)).toBeNull();
  });

  it('does not consume a different ticket when presented with an unknown value', () => {
    const store = new WebSocketTicketStore({ ttlMilliseconds: 1_000, now: () => 10_000 });
    const issued = store.issue(identity);

    expect(store.consume('not-a-ticket')).toBeNull();
    expect(store.consume(issued.ticket)).toEqual(identity);
  });

  it('binds a ticket to the origin that requested it and burns it on mismatch', () => {
    const store = new WebSocketTicketStore({ ttlMilliseconds: 1_000, now: () => 10_000 });
    const issued = store.issue(identity, 'https://app.example.test');

    expect(store.consume(issued.ticket, 'https://attacker.example.test')).toBeNull();
    expect(store.consume(issued.ticket, 'https://app.example.test')).toBeNull();
  });
});
