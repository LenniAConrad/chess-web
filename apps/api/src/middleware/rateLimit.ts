import { recordRateLimitEvent } from '@chess-web/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { InMemoryRateLimiter, RateLimitPolicy } from '../services/rateLimiter.js';
import { sha256 } from '../utils/hash.js';

export async function enforceRateLimit(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  pool: Pool;
  limiter: InMemoryRateLimiter;
  key: string;
  policy: RateLimitPolicy;
  route: string;
  anonSessionId?: string;
}): Promise<boolean> {
  const decision = input.limiter.check(input.key, input.policy);
  const ipHash = sha256(input.request.ip ?? 'unknown');

  if (decision.action !== 'allow') {
    await recordRateLimitEvent(input.pool, {
      ipHash,
      anonSessionId: input.anonSessionId,
      route: input.route,
      action: decision.action === 'ban' ? 'ban' : 'throttle'
    });

    input.reply.header('Retry-After', decision.retryAfterSeconds);
    if (decision.action === 'ban') {
      input.reply.code(403).send({ error: 'Rate limit ban active' });
      return false;
    }

    input.reply.code(429).send({ error: 'Rate limit exceeded' });
    return false;
  }

  await recordRateLimitEvent(input.pool, {
    ipHash,
    anonSessionId: input.anonSessionId,
    route: input.route,
    action: 'allow'
  });

  return true;
}
