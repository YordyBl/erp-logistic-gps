import { describe, expect, it, vi } from 'vitest';

import type { LoginRateLimitConfig } from '../../config/config.js';
import { InMemoryLoginRateLimiter } from '../middleware/login-rate-limit.js';

const config: LoginRateLimitConfig = {
  maxAttempts: 3,
  windowSeconds: 900,
};

describe('InMemoryLoginRateLimiter', () => {
  it('blocks a key after maxAttempts failures and reports remaining seconds', () => {
    const limiter = new InMemoryLoginRateLimiter(config);

    expect(limiter.retryAfterSeconds('1.2.3.4:a@b.co')).toBeUndefined();

    limiter.recordFailure('1.2.3.4:a@b.co');
    limiter.recordFailure('1.2.3.4:a@b.co');
    limiter.recordFailure('1.2.3.4:a@b.co');

    expect(limiter.retryAfterSeconds('1.2.3.4:a@b.co')).toBeGreaterThan(0);
  });

  it('keeps at most maxEntries windows by evicting the oldest first', () => {
    const limiter = new InMemoryLoginRateLimiter(config, 2);

    limiter.recordFailure('k-1');
    limiter.recordFailure('k-2');
    limiter.recordFailure('k-3');

    expect(limiter.size).toBe(2);
    // k-1 was the oldest entry, so it was evicted; k-2 and k-3 remain.
    expect(limiter.retryAfterSeconds('k-1')).toBeUndefined();
    expect(limiter.retryAfterSeconds('k-2')).toBeUndefined();
    expect(limiter.retryAfterSeconds('k-3')).toBeUndefined();
    expect(limiter.size).toBe(2);
  });

  it('sweeps expired windows before evicting when the cap is reached', () => {
    const now = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const shortWindowConfig: LoginRateLimitConfig = {
      maxAttempts: 3,
      windowSeconds: 1,
    };
    const limiter = new InMemoryLoginRateLimiter(shortWindowConfig, 2);

    limiter.recordFailure('k-1');
    limiter.recordFailure('k-2');

    // The window (1s) expires.
    vi.setSystemTime(now + 2_000);

    // The cap is reached, but k-1/k-2 are expired, so the sweep frees them.
    limiter.recordFailure('k-3');

    expect(limiter.size).toBe(1);
    expect(limiter.retryAfterSeconds('k-1')).toBeUndefined();
    expect(limiter.retryAfterSeconds('k-2')).toBeUndefined();

    vi.useRealTimers();
  });

  it('never indexes keys longer than the maximum key length', () => {
    const limiter = new InMemoryLoginRateLimiter(config);
    const oversized = `x${'a'.repeat(600)}`;

    limiter.recordFailure(oversized);

    expect(limiter.size).toBe(0);
    expect(limiter.retryAfterSeconds(oversized)).toBeUndefined();
  });

  it('exposes the tracked window count through size', () => {
    const limiter = new InMemoryLoginRateLimiter(config);

    expect(limiter.size).toBe(0);
    limiter.recordFailure('k-1');
    expect(limiter.size).toBe(1);
  });
});
