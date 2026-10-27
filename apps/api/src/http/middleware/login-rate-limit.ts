import type { LoginRateLimitConfig } from '../../config/config.js';

/**
 * Login attempt limiter (S9: in-memory is accepted for the MVP).
 *
 * The key is IP + normalized email, so one noisy client cannot lock out a
 * different account, and an attacker cannot exhaust a victim's quota from
 * another address. Only failures are recorded: a successful login must not
 * consume the window.
 *
 * The store is memory-bounded: entries are swept when they expire, and when
 * the entry cap is reached after a sweep the oldest entry is evicted to make
 * room (oldest-first, because `Map` preserves insertion order). Keys longer
 * than `MAX_KEY_LENGTH` are never indexed. The cap protects the process from
 * OOM under credential-stuffing; per-key blocking is best-effort once the cap
 * is reached, which is the intended MVP tradeoff. `size` exposes the current
 * entry count for logs/metrics.
 *
 * The process-local store resets on restart and is not shared between replicas;
 * replacing it with Redis is a deployment change behind this interface, not an
 * HTTP change.
 */
export interface LoginRateLimiter {
  /**
   * Returns the number of seconds to wait when the key is blocked, or
   * `undefined` when the attempt may proceed.
   */
  retryAfterSeconds(key: string): number | undefined;
  recordFailure(key: string): void;
}

interface AttemptWindow {
  count: number;
  readonly resetAtMs: number;
}

export const DEFAULT_MAX_ENTRIES = 100_000;
const MAX_KEY_LENGTH = 512;

export class InMemoryLoginRateLimiter implements LoginRateLimiter {
  private readonly windows = new Map<string, AttemptWindow>();

  constructor(
    private readonly config: LoginRateLimitConfig,
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES,
  ) {}

  /** Current number of tracked failure windows (for observability). */
  get size(): number {
    return this.windows.size;
  }

  retryAfterSeconds(key: string): number | undefined {
    const nowMs = Date.now();
    const window = this.windows.get(key);

    if (window === undefined) {
      return undefined;
    }

    if (window.resetAtMs <= nowMs) {
      this.windows.delete(key);
      return undefined;
    }

    if (window.count < this.config.maxAttempts) {
      return undefined;
    }

    return Math.max(1, Math.ceil((window.resetAtMs - nowMs) / 1000));
  }

  recordFailure(key: string): void {
    if (key.length > MAX_KEY_LENGTH) {
      return;
    }

    const nowMs = Date.now();
    const window = this.windows.get(key);

    if (window === undefined || window.resetAtMs <= nowMs) {
      this.makeRoom(nowMs);
      this.windows.set(key, {
        count: 1,
        resetAtMs: nowMs + this.config.windowSeconds * 1000,
      });
      return;
    }

    window.count += 1;
  }

  private makeRoom(nowMs: number): void {
    if (this.windows.size < this.maxEntries) {
      return;
    }

    this.sweepExpired(nowMs);

    if (this.windows.size < this.maxEntries) {
      return;
    }

    const oldest = this.windows.keys().next();
    if (oldest.done !== true) {
      this.windows.delete(oldest.value);
    }
  }

  private sweepExpired(nowMs: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAtMs <= nowMs) {
        this.windows.delete(key);
      }
    }
  }
}
