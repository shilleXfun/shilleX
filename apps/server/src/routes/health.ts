import type { FastifyInstance } from 'fastify';

export default async function healthRoutes(app: FastifyInstance) {
  // Liveness: the process answers. Railway's health check reads this; it never touches the world.
  app.get('/health', async () => ({
    ok: true,
    db: app.deps.dbKind,
    liveTokenLookup: app.deps.config.liveTokenLookup,
    demoSimulator: app.deps.config.demoSimulator,
  }));
  // Whether the world is alive and making progress (world/health.ts), once bootAgents has set app.worldHealth.
  app.get('/health/world', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return app.worldHealth ? app.worldHealth() : { ok: true, world: 'off', warnings: [] };
  });
}
