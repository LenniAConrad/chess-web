export interface RateLimitPolicy {
  burstLimit: number;
  burstWindowMs: number;
  sustainedLimit: number;
  sustainedWindowMs: number;
}

export type RateLimitDecision =
  | { action: 'allow' }
  | { action: 'throttle'; retryAfterSeconds: number }
  | { action: 'ban'; retryAfterSeconds: number };

interface RateState {
  events: number[];
  strikes: number[];
  cooldownUntil: number;
  banUntil: number;
}

function prune(values: number[], now: number, windowMs: number): number[] {
  return values.filter((value) => now - value <= windowMs);
}

export class InMemoryRateLimiter {
  private readonly states = new Map<string, RateState>();

  check(key: string, policy: RateLimitPolicy): RateLimitDecision {
    const now = Date.now();
    const state = this.states.get(key) ?? {
      events: [],
      strikes: [],
      cooldownUntil: 0,
      banUntil: 0
    };

    if (state.banUntil > now) {
      const retryAfterSeconds = Math.ceil((state.banUntil - now) / 1000);
      this.states.set(key, state);
      return { action: 'ban', retryAfterSeconds };
    }

    if (state.cooldownUntil > now) {
      const retryAfterSeconds = Math.ceil((state.cooldownUntil - now) / 1000);
      this.states.set(key, state);
      return { action: 'throttle', retryAfterSeconds };
    }

    state.events = prune(state.events, now, Math.max(policy.burstWindowMs, policy.sustainedWindowMs));
    const burstCount = state.events.filter((timestamp) => now - timestamp <= policy.burstWindowMs).length;
    const sustainedCount = state.events.filter((timestamp) => now - timestamp <= policy.sustainedWindowMs).length;

    if (burstCount >= policy.burstLimit || sustainedCount >= policy.sustainedLimit) {
      state.strikes = prune(state.strikes, now, 60 * 60 * 1000);
      state.strikes.push(now);

      if (state.strikes.length === 1) {
        state.cooldownUntil = now + 60_000;
        this.states.set(key, state);
        return { action: 'throttle', retryAfterSeconds: 60 };
      }

      if (state.strikes.length === 2) {
        state.banUntil = now + 15 * 60_000;
        this.states.set(key, state);
        return { action: 'ban', retryAfterSeconds: 15 * 60 };
      }

      state.banUntil = now + 24 * 60 * 60_000;
      this.states.set(key, state);
      return { action: 'ban', retryAfterSeconds: 24 * 60 * 60 };
    }

    state.events.push(now);
    this.states.set(key, state);
    return { action: 'allow' };
  }
}
