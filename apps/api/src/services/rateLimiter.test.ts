import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter } from './rateLimiter.js';

describe('InMemoryRateLimiter', () => {
  it('throttles and escalates to bans', () => {
    const limiter = new InMemoryRateLimiter();
    const policy = {
      burstLimit: 1,
      burstWindowMs: 1000,
      sustainedLimit: 2,
      sustainedWindowMs: 60_000
    };

    expect(limiter.check('k', policy).action).toBe('allow');

    const second = limiter.check('k', policy);
    expect(second.action).toBe('throttle');

    const third = limiter.check('k', policy);
    expect(['ban', 'throttle']).toContain(third.action);
  });
});
