import { createHash, randomBytes } from 'node:crypto';

import type { UserRole } from '../../identity-and-access/domain/entities/User.js';

export interface WebSocketIdentity {
  readonly id: string;
  readonly organizationId: string;
  readonly role: UserRole;
}

interface TicketRecord {
  readonly identity: WebSocketIdentity;
  readonly origin: string | undefined;
  readonly expiresAt: number;
}

export interface WebSocketTicketStoreOptions {
  readonly ttlMilliseconds?: number;
  readonly now?: () => number;
  readonly maximumTickets?: number;
}

/** Process-local, one-use credentials; no access JWT is exposed to the socket URL. */
export class WebSocketTicketStore {
  private readonly records = new Map<string, TicketRecord>();
  private readonly ttlMilliseconds: number;
  private readonly now: () => number;
  private readonly maximumTickets: number;

  constructor(options: WebSocketTicketStoreOptions = {}) {
    this.ttlMilliseconds = options.ttlMilliseconds ?? 30_000;
    this.now = options.now ?? Date.now;
    this.maximumTickets = options.maximumTickets ?? 10_000;
  }

  issue(identity: WebSocketIdentity, origin?: string): { ticket: string; expiresAt: string } {
    const now = this.now();
    this.pruneExpired(now);
    if (this.records.size >= this.maximumTickets) {
      throw new Error('WebSocket ticket capacity has been reached');
    }

    const ticket = randomBytes(32).toString('base64url');
    const expiresAt = now + this.ttlMilliseconds;
    this.records.set(this.digest(ticket), {
      identity: {
        id: identity.id,
        organizationId: identity.organizationId,
        role: identity.role,
      },
      origin,
      expiresAt,
    });
    return { ticket, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Consumption is synchronous so concurrent upgrades cannot redeem one ticket twice. */
  consume(ticket: string, origin?: string): WebSocketIdentity | null {
    const key = this.digest(ticket);
    const record = this.records.get(key);
    if (record === undefined) return null;
    this.records.delete(key);
    if (record.expiresAt <= this.now() || record.origin !== origin) return null;
    return record.identity;
  }

  private pruneExpired(now: number): void {
    for (const [key, record] of this.records) {
      if (record.expiresAt <= now) this.records.delete(key);
    }
  }

  private digest(ticket: string): string {
    return createHash('sha256').update(ticket).digest('base64url');
  }
}
