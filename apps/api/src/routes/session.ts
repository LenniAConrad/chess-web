import { resolve } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { getPuzzleCount } from '@chess-web/db';
import type { Pool } from 'pg';
import { z } from 'zod';
import { env } from '../env.js';
import { ensureAnonSession } from '../middleware/anonSession.js';
import { enforceRateLimit } from '../middleware/rateLimit.js';
import { importPgnFile, type PgnImportProgress } from '../services/pgnImport.js';
import type { InMemoryRateLimiter } from '../services/rateLimiter.js';
import { SessionService } from '../services/sessionService.js';

/**
 * Route payload schemas. These are the single source of truth for request
 * contract validation at the HTTP boundary.
 */
const startSchema = z.object({
  mode: z.enum(['explore', 'mainline']).optional().default('explore'),
  autoNext: z.boolean().optional().default(true),
  puzzleId: z.string().uuid().optional(),
  source: z.enum(['normal', 'history']).optional().default('normal')
});

const moveSchema = z.object({
  sessionId: z.string().uuid(),
  uciMove: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/i),
  skipSimilarVariations: z.boolean().optional().default(false)
});

const sessionSchema = z.object({
  sessionId: z.string().uuid()
});

const actionSessionSchema = z.object({
  sessionId: z.string().uuid(),
  skipSimilarVariations: z.boolean().optional().default(false)
});

const revealSchema = z.object({
  sessionId: z.string().uuid(),
  source: z.enum(['manual', 'auto']).optional().default('manual'),
  skipSimilarVariations: z.boolean().optional().default(false)
});

const historySchema = z.object({
  sessionId: z.string().uuid(),
  limit: z.coerce.number().int().positive().max(200).optional().default(24),
  includeCurrent: z.boolean().optional().default(false)
});

const nextSchema = z.object({
  sessionId: z.string().uuid(),
  mode: z.enum(['explore', 'mainline']).optional(),
  autoNext: z.boolean().optional().default(true)
});

const adminImportSchema = z.object({
  replaceExisting: z.boolean().optional().default(true)
});

const startPolicy = {
  burstLimit: 100,
  burstWindowMs: 1000,
  sustainedLimit: 6000,
  sustainedWindowMs: 60_000
};

const actionPolicy = {
  burstLimit: 10,
  burstWindowMs: 1000,
  sustainedLimit: 300,
  sustainedWindowMs: 60_000
};

interface AdminImportStatus {
  state: 'idle' | 'running' | 'completed' | 'failed';
  sourceFile: string | null;
  total: number;
  success: number;
  failed: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

const adminImportStatus: AdminImportStatus = {
  state: 'idle',
  sourceFile: null,
  total: 0,
  success: 0,
  failed: 0,
  startedAt: null,
  finishedAt: null,
  error: null
};

let activeAdminImport: Promise<void> | null = null;
const bundledImportFile = resolve(process.cwd(), 'puzzle_exports/stack_min_2plies_256k.pgn');
const bundledImportTotal = 256000;

function requireImportToken(
  request: { headers: Record<string, unknown> },
  reply: FastifyReply
): boolean {
  const token = request.headers['x-import-token'];
  if (token !== env.IMPORT_TOKEN) {
    reply.code(401).send({ error: 'Invalid import token' });
    return false;
  }

  return true;
}

/**
 * Register all puzzle session routes.
 *
 * Route pattern:
 * 1) validate body
 * 2) ensure anon session identity
 * 3) enforce rate limit policy
 * 4) call SessionService
 * 5) return normalized response payload
 */
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

  app.get('/api/v1/puzzles/count', async (_request, reply) => {
    const count = await getPuzzleCount(pool);
    reply.send({ count });
  });

  app.get('/api/v1/admin/import-status', async (request, reply) => {
    if (!requireImportToken(request, reply)) {
      return;
    }
    reply.send(adminImportStatus);
  });

  app.post('/api/v1/admin/import-bundled', async (request, reply) => {
    if (!requireImportToken(request, reply)) {
      return;
    }

    if (activeAdminImport) {
      reply.code(409).send({ error: 'Import already running', status: adminImportStatus });
      return;
    }

    const body = adminImportSchema.parse(request.body ?? {});
    const sourceFile = bundledImportFile;

    adminImportStatus.state = 'running';
    adminImportStatus.sourceFile = sourceFile;
    adminImportStatus.total = bundledImportTotal;
    adminImportStatus.success = 0;
    adminImportStatus.failed = 0;
    adminImportStatus.startedAt = new Date().toISOString();
    adminImportStatus.finishedAt = null;
    adminImportStatus.error = null;

    activeAdminImport = (async () => {
      try {
        const result = await importPgnFile(pool, sourceFile, {
          replaceExisting: body.replaceExisting,
          totalHint: bundledImportTotal,
          onProgress: (progress: PgnImportProgress) => {
            adminImportStatus.total = progress.total;
            adminImportStatus.success = progress.success;
            adminImportStatus.failed = progress.failed;
          }
        });

        adminImportStatus.state = 'completed';
        adminImportStatus.total = result.total;
        adminImportStatus.success = result.success;
        adminImportStatus.failed = result.failed;
        adminImportStatus.finishedAt = new Date().toISOString();
      } catch (error) {
        adminImportStatus.state = 'failed';
        adminImportStatus.error = error instanceof Error ? error.message : 'Unknown import error';
        adminImportStatus.finishedAt = new Date().toISOString();
      } finally {
        activeAdminImport = null;
      }
    })();

    reply.code(202).send({
      status: 'started',
      sourceFile,
      replaceExisting: body.replaceExisting
    });
  });

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
    const startedFromHistory = body.source === 'history';
    const started = body.puzzleId
      ? await sessionService.startSessionByPublicId({
          anonSessionId,
          mode: body.mode,
          autoNext: body.autoNext,
          publicId: body.puzzleId,
          startedFromHistory
        })
      : await sessionService.startRandomSession({
          anonSessionId,
          mode: body.mode,
          autoNext: body.autoNext,
          startedFromHistory: false
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
      uciMove: body.uciMove,
      skipSimilarVariations: body.skipSimilarVariations
    });

    reply.send(result);
  });

  app.post('/api/v1/session/load', async (request, reply) => {
    const body = sessionSchema.parse(request.body ?? {});
    const anonSessionId = await ensureAnonSession(request, reply, pool);

    const allowed = await enforceRateLimit({
      request,
      reply,
      pool,
      limiter,
      key: `load:${body.sessionId}`,
      policy: actionPolicy,
      route: '/api/v1/session/load',
      anonSessionId
    });

    if (!allowed) {
      return;
    }

    const result = await sessionService.loadSession({
      sessionId: body.sessionId,
      anonSessionId
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

  app.post('/api/v1/session/history', async (request, reply) => {
    const body = historySchema.parse(request.body ?? {});
    const anonSessionId = await ensureAnonSession(request, reply, pool);

    const allowed = await enforceRateLimit({
      request,
      reply,
      pool,
      limiter,
      key: `history:${body.sessionId}`,
      policy: actionPolicy,
      route: '/api/v1/session/history',
      anonSessionId
    });

    if (!allowed) {
      return;
    }

    const result = await sessionService.getSessionHistory({
      sessionId: body.sessionId,
      anonSessionId,
      limit: body.limit,
      includeCurrent: body.includeCurrent
    });
    reply.send(result);
  });

  app.post('/api/v1/session/history/clear', async (request, reply) => {
    const body = sessionSchema.parse(request.body ?? {});
    const anonSessionId = await ensureAnonSession(request, reply, pool);

    const allowed = await enforceRateLimit({
      request,
      reply,
      pool,
      limiter,
      key: `history-clear:${body.sessionId}`,
      policy: actionPolicy,
      route: '/api/v1/session/history/clear',
      anonSessionId
    });

    if (!allowed) {
      return;
    }

    const result = await sessionService.clearSessionHistory({
      sessionId: body.sessionId,
      anonSessionId
    });
    reply.send(result);
  });

  app.post('/api/v1/session/tree', async (request, reply) => {
    const body = sessionSchema.parse(request.body ?? {});
    const anonSessionId = await ensureAnonSession(request, reply, pool);

    const allowed = await enforceRateLimit({
      request,
      reply,
      pool,
      limiter,
      key: `tree:${body.sessionId}`,
      policy: actionPolicy,
      route: '/api/v1/session/tree',
      anonSessionId
    });

    if (!allowed) {
      return;
    }

    const result = await sessionService.getSessionTree({
      sessionId: body.sessionId,
      anonSessionId
    });
    reply.send(result);
  });

  app.post('/api/v1/session/reveal', async (request, reply) => {
    const body = revealSchema.parse(request.body ?? {});
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

    const result = await sessionService.reveal({
      sessionId: body.sessionId,
      source: body.source,
      skipSimilarVariations: body.skipSimilarVariations
    });
    reply.send(result);
  });

  app.post('/api/v1/session/skip-variation', async (request, reply) => {
    const body = actionSessionSchema.parse(request.body ?? {});
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

    const result = await sessionService.skipVariation({
      sessionId: body.sessionId,
      skipSimilarVariations: body.skipSimilarVariations
    });
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

  app.post('/api/v1/session/prefetch-next', async (request, reply) => {
    const body = nextSchema.parse(request.body ?? {});
    const anonSessionId = await ensureAnonSession(request, reply, pool);

    const allowed = await enforceRateLimit({
      request,
      reply,
      pool,
      limiter,
      key: `prefetch-next:${body.sessionId}`,
      policy: actionPolicy,
      route: '/api/v1/session/prefetch-next',
      anonSessionId
    });

    if (!allowed) {
      return;
    }

    const result = await sessionService.prefetchNext({
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
