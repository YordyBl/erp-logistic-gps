import type { Clock } from '../../application/ports/Clock.js';
import type { IdGenerator } from '../../application/ports/IdGenerator.js';

/**
 * Deterministic clock for tests and demos.
 *
 * The port returns ISO-8601 instants; keeping the value fixed makes timestamp
 * assertions and domain events reproducible.
 */
export class FixedClock implements Clock {
  constructor(private readonly instant: string) {}

  now(): string {
    return this.instant;
  }
}

/**
 * Deterministic UUIDv4-shaped generator.
 *
 * The shape matters because the domain validates that internal identifiers are
 * UUIDs. Incrementing the last segment keeps assertions readable without
 * weakening the UUID contract.
 */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix = '00000000-0000-4000-8000-') {}

  nextId(): string {
    this.counter += 1;
    return `${this.prefix}${String(this.counter).padStart(12, '0')}`;
  }
}
