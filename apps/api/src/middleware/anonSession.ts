import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { upsertAnonSession } from '@chess-web/db';
import type { Pool } from 'pg';
import { sha256 } from '../utils/hash.js';

const COOKIE_NAME = 'anon_sid';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function ensureAnonSession(
  request: FastifyRequest,
  reply: FastifyReply,
  pool: Pool
): Promise<string> {
  const cookieValue = request.cookies[COOKIE_NAME];
  const anonSessionId = typeof cookieValue === 'string' && UUID_REGEX.test(cookieValue)
    ? cookieValue
    : randomUUID();

  const ip = request.ip ?? 'unknown';
  const userAgent = request.headers['user-agent'] ?? 'unknown';

  await upsertAnonSession(pool, anonSessionId, sha256(String(userAgent)), sha256(ip));

  if (cookieValue !== anonSessionId) {
    reply.setCookie(COOKIE_NAME, anonSessionId, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30
    });
  }

  return anonSessionId;
}
