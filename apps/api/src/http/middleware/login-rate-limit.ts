import type { LoginRateLimitConfig } from '../../config/config.js';

/**
 * Login attempt limiter (S9: in-memory is accepted for the MVP).
 *
 * The key is IP + normalized email, so one noisy client cannot lock out a
 * different account, and an attacker cannot exhaust a victim's quota from
 * another address. Only failures are recorded: a successful login must not
 * consume the window.
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

export class InMemoryLoginRateLimiter implements LoginRateLimiter {
  private readonly windows = new Map<string, AttemptWindow>();

  constructor(private readonly config: LoginRateLimitConfig) {}

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
    const nowMs = Date.now();
    const window = this.windows.get(key);

    if (window === undefined || window.resetAtMs <= nowMs) {
      this.windows.set(key, {
        count: 1,
        resetAtMs: nowMs + this.config.windowSeconds * 1000,
      });
      return;
    }

    window.count += 1;
  }
}
