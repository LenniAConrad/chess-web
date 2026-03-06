import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { ensureAnonSession } from '../middleware/anonSession.js';
import { enforceRateLimit } from '../middleware/rateLimit.js';
import type { InMemoryRateLimiter } from '../services/rateLimiter.js';
import { SessionService } from '../services/sessionService.js';

const startSchema = z.object({
  mode: z.enum(['explore', 'mainline']).optional().default('explore'),
  autoNext: z.boolean().optional().default(true),
  puzzleId: z.string().uuid().optional()
});

const moveSchema = z.object({
  sessionId: z.string().uuid(),
  uciMove: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/i)
});

const sessionSchema = z.object({
  sessionId: z.string().uuid()
});

const nextSchema = z.object({
  sessionId: z.string().uuid(),
  mode: z.enum(['explore', 'mainline']).optional(),
  autoNext: z.boolean().optional().default(true)
});

const startPolicy = {
  burstLimit: 3,
  burstWindowMs: 1000,
  sustainedLimit: 60,
  sustainedWindowMs: 60_000
};

const actionPolicy = {
  burstLimit: 10,
  burstWindowMs: 1000,
  sustainedLimit: 300,
  sustainedWindowMs: 60_000
};

export async function registerSessionRoutes(
  app: FastifyInstance,
  options: {
    pool: Pool;
    limiter: InMemoryRateLimiter;
    sessionService: SessionService;
    enableDebugTreeRoute: boolean;
  }
): Promise<void> {
  const { pool, limiter, sessionService } = options;

  app.post('/api/v1/session/start', async (request, reply) => {
    const body = startSchema.parse(request.body ?? {});
    const allowed = await enforceRateLimit({
      request,
      reply,
      pool,
      limiter,
      key: `start:${request.ip}`,
      policy: startPolicy,
      route: '/api/v1/session/start'
    });

    if (!allowed) {
      return;
    }

    const anonSessionId = await ensureAnonSession(request, reply, pool);
    const started = body.puzzleId
      ? await sessionService.startSessionByPublicId({
          anonSessionId,
          mode: body.mode,
          autoNext: body.autoNext,
          publicId: body.puzzleId
        })
      : await sessionService.startRandomSession({
          anonSessionId,
          mode: body.mode,
          autoNext: body.autoNext
        });

    reply.send(started);
  });

  app.post('/api/v1/session/move', async (request, reply) => {
    const body = moveSchema.parse(request.body ?? {});
    const anonSessionId = await ensureAnonSession(request, reply, pool);

    const allowed = await enforceRateLimit({
      request,
      reply,
      pool,
      limiter,
      key: `move:${body.sessionId}`,
      policy: actionPolicy,
      route: '/api/v1/session/move',
      anonSessionId
    });

    if (!allowed) {
      return;
    }

    const result = await sessionService.playMove({
      sessionId: body.sessionId,
      uciMove: body.uciMove
    });

    reply.send(result);
  });

  app.post('/api/v1/session/hint', async (request, reply) => {
    const body = sessionSchema.parse(request.body ?? {});
    const anonSessionId = await ensureAnonSession(request, reply, pool);

    const allowed = await enforceRateLimit({
      request,
      reply,
      pool,
      limiter,
      key: `hint:${body.sessionId}`,
      policy: actionPolicy,
      route: '/api/v1/session/hint',
      anonSessionId
    });

    if (!allowed) {
      return;
    }

    const result = await sessionService.hint({ sessionId: body.sessionId });
    reply.send(result);
  });

  app.post('/api/v1/session/reveal', async (request, reply) => {
    const body = sessionSchema.parse(request.body ?? {});
    const anonSessionId = await ensureAnonSession(request, reply, pool);

    const allowed = await enforceRateLimit({
      request,
      reply,
      pool,
      limiter,
      key: `reveal:${body.sessionId}`,
      policy: actionPolicy,
      route: '/api/v1/session/reveal',
      anonSessionId
    });

    if (!allowed) {
      return;
    }

    const result = await sessionService.reveal({ sessionId: body.sessionId });
    reply.send(result);
  });

  app.post('/api/v1/session/skip-variation', async (request, reply) => {
    const body = sessionSchema.parse(request.body ?? {});
    const anonSessionId = await ensureAnonSession(request, reply, pool);

    const allowed = await enforceRateLimit({
      request,
      reply,
      pool,
      limiter,
      key: `skip:${body.sessionId}`,
      policy: actionPolicy,
      route: '/api/v1/session/skip-variation',
      anonSessionId
    });

    if (!allowed) {
      return;
    }

    const result = await sessionService.skipVariation({ sessionId: body.sessionId });
    reply.send(result);
  });

  app.post('/api/v1/session/next', async (request, reply) => {
    const body = nextSchema.parse(request.body ?? {});
    const anonSessionId = await ensureAnonSession(request, reply, pool);

    const allowed = await enforceRateLimit({
      request,
      reply,
      pool,
      limiter,
      key: `next:${body.sessionId}`,
      policy: actionPolicy,
      route: '/api/v1/session/next',
      anonSessionId
    });

    if (!allowed) {
      return;
    }

    const result = await sessionService.startNext({
      sessionId: body.sessionId,
      anonSessionId,
      mode: body.mode,
      autoNext: body.autoNext
    });

    reply.send(result);
  });

  if (options.enableDebugTreeRoute) {
    app.get('/api/v1/puzzles/:publicId/tree', async (request, reply) => {
      const params = z.object({ publicId: z.string().uuid() }).parse(request.params);
      const result = await sessionService.getPuzzleTree(params.publicId);
      reply.send(result);
    });
  }
}
