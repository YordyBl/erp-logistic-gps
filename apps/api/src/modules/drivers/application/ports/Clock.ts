/**
 * The module consumes the shared Clock contract through this port so use cases
 * depend only on `application/ports`; adapters live in composition.
 */
export type { Clock } from '../../../../shared/clock.js';
