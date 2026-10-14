import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { bannerSvg, tokenSvg, artSvg, monogramSvg } from '../lib/svg-art.ts';
import { errors } from '../lib/errors.ts';
import { users } from '../db/schema.ts';

const KINDS: Record<string, (seed: string) => string> = { banner: bannerSvg, token: tokenSvg, art: artSvg };

export default async function mediaRoutes(app: FastifyInstance) {
  app.get<{ Params: { kind: string; seed: string } }>('/media/:kind/:seed', async (req, reply) => {
    const m = /^([A-Za-z0-9_-]{1,64})\.svg$/.exec(req.params.seed);
    // A person's avatar is their initials, like an agent's; the seed is their user id.
    let gen = KINDS[req.params.kind];
    if (req.params.kind === 'avatar' && m) {
      const [u] = await app.deps.db.select({ name: users.displayName }).from(users).where(eq(users.id, m[1]!));
      gen = (seed) => monogramSvg(u?.name ?? '?', seed);
    }
    if (!gen || !m) throw errors.notFound('Image');
    return reply
      .header('content-type', 'image/svg+xml; charset=utf-8')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
      .send(gen(m[1]!));
  });
}
