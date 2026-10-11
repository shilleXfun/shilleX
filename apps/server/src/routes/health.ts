import type { FastifyInstance } from 'fastify';

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({
    ok: true,
    db: app.deps.dbKind,
    liveTokenLookup: app.deps.config.liveTokenLookup,
    demoSimulator: app.deps.config.demoSimulator,
  }));
}
