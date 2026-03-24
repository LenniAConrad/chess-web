import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { createDbPool, runMigrations } from '@chess-web/db';
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { env } from './env.js';
import { registerSessionRoutes } from './routes/session.js';
import { InMemoryRateLimiter } from './services/rateLimiter.js';
import { SessionService } from './services/sessionService.js';
import { seedPuzzlesIfEmpty } from './services/seed.js';

export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug'
    }
  });

  let pool = createDbPool(env.DATABASE_URL);
  try {
    await runMigrations(pool);
  } catch (error) {
    app.log.warn(
      { error },
      'Primary database unavailable. Falling back to in-memory pg-mem for local development.'
    );

    try {
      await pool.end();
    } catch {
      // ignore pool close issues during fallback
    }

    pool = createDbPool('pgmem://local');
    await runMigrations(pool);
  }

  await app.register(cookie, {
    secret: env.COOKIE_SECRET,
    parseOptions: {
      path: '/',
      sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
      secure: env.NODE_ENV === 'production',
      httpOnly: true
    }
  });

  const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map((origin: string) => origin.trim());
  await app.register(cors, {
    origin: (origin: string | undefined, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed'), false);
    },
    credentials: true
  });

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", ...allowedOrigins],
        imgSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"]
      }
    },
    referrerPolicy: { policy: 'same-origin' }
  });

  const limiter = new InMemoryRateLimiter();
  const sessionService = new SessionService(pool);
  await seedPuzzlesIfEmpty(pool, env.SEED_PGN_FILE, env.SEED_MAX_PUZZLES);

  app.get('/health', async () => ({ status: 'ok' }));

  await registerSessionRoutes(app, {
    pool,
    limiter,
    sessionService,
    enableDebugTreeRoute: env.NODE_ENV !== 'production'
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      reply.code(400).send({ error: 'Invalid request payload', details: error.flatten() });
      return;
    }

    if (error instanceof Error && error.message.includes('not found')) {
      reply.code(404).send({ error: error.message });
      return;
    }

    if (error instanceof Error && error.message.includes('No puzzles available')) {
      reply.code(404).send({ error: error.message });
      return;
    }

    request.log.error(error);
    reply.code(500).send({ error: 'Internal server error' });
  });

  app.addHook('onClose', async () => {
    await pool.end();
  });

  return app;
}
