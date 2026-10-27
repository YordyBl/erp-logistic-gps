/**
 * Time source for application use cases.
 *
 * Timestamps cross the application boundary as ISO-8601 instants with a time
 * designator (UTC `Z` from {@link SystemClock}). The ratified convention is
 * America/Lima everywhere (architecture plan §2): the API and UI present the
 * same instant at the Lima offset (`-05:00`, no daylight saving). Enforcing the
 * timezone at the database and HTTP serialization layers is infrastructure work
 * for a later phase.
 */
export interface Clock {
  /** Current instant as an ISO-8601 string, for example `2026-10-26T15:00:00.000Z`. */
  now(): string;
}

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}
