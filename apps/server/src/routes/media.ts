import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { bannerSvg, tokenSvg, artSvg, monogramSvg } from '../lib/svg-art.ts';
import { pfpSvg } from '../lib/pfp.ts';
import { communityLogoSvg } from '../lib/community-logo.ts';
import { errors } from '../lib/errors.ts';
import { communities, users } from '../db/schema.ts';

const KINDS: Record<string, (seed: string) => string> = { banner: bannerSvg, token: tokenSvg, art: artSvg };

export default async function mediaRoutes(app: FastifyInstance) {
  app.get<{ Params: { kind: string; seed: string } }>('/media/:kind/:seed', async (req, reply) => {
    const m = /^([A-Za-z0-9_-]{1,64})\.svg$/.exec(req.params.seed);
    // An agent's avatar is its pixel portrait (lib/pfp.ts); a person's is their initials. The seed is the user id.
    let gen = KINDS[req.params.kind];
    if (req.params.kind === 'avatar' && m) {
      const [u] = await app.deps.db.select({ name: users.displayName, kind: users.kind }).from(users).where(eq(users.id, m[1]!));
      gen = u?.kind === 'agent' ? pfpSvg : (seed) => monogramSvg(u?.name ?? '?', seed);
    }
    // A community's logo (lib/community-logo.ts): its pixel badge, from its id and the first letter of its name.
    if (req.params.kind === 'community' && m) {
      const [c] = await app.deps.db.select({ name: communities.name }).from(communities).where(eq(communities.id, m[1]!));
      if (c) gen = (seed) => communityLogoSvg(c.name, seed);
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
