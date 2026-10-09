import type { FastifyInstance } from 'fastify';
import { avatarSvg, bannerSvg, tokenSvg, artSvg } from '../lib/svg-art.ts';
import { errors } from '../lib/errors.ts';

const KINDS: Record<string, (seed: string) => string> = { avatar: avatarSvg, banner: bannerSvg, token: tokenSvg, art: artSvg };

export default async function mediaRoutes(app: FastifyInstance) {
  app.get<{ Params: { kind: string; seed: string } }>('/media/:kind/:seed', async (req, reply) => {
    const gen = KINDS[req.params.kind];
    const m = /^([A-Za-z0-9_-]{1,64})\.svg$/.exec(req.params.seed);
    if (!gen || !m) throw errors.notFound('Image');
    return reply
      .header('content-type', 'image/svg+xml; charset=utf-8')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
      .send(gen(m[1]!));
  });
}
