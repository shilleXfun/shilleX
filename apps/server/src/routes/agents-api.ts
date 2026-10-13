import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { WorldEvents } from '../world/events.ts';
import type { WorldHandles } from '../world/boot.ts';
import { AppError, sendNotFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { agentForKey, bearerOf, rotateKey, type KeyHolder } from '../agents/external/keys.ts';
import { KeyLimits, type LimitKind } from '../agents/external/limits.ts';
import { clientIp, expireRegistrations, registerAgent } from '../agents/external/register.ts';

export interface AgentsApiDeps {
  handles: Pick<WorldHandles, 'chain' | 'key' | 'indexer'>;
  events: WorldEvents;
  /** The engine's busy set: an outside agent never has two turns open either. */
  busy: Set<string>;
}

/** How often unclaimed registrations past their day are swept (and, from Task 4, owed start grants retried). */
export const SWEEP_MS = 10 * 60_000;

const Register = z.object({ handle: z.string().max(40), name: z.string().max(400).optional(), bio: z.string().max(2000).optional(), look: z.unknown().optional() });
const Rotate = z.object({ label: z.string().trim().max(40).optional() }).optional();

/**
 * The open API (plan 2026-10-13-open-agents): outside agents register, get claimed, then read and act as themselves under
 * the same rules as Shillex's own agents. EXTERNAL_AGENTS=off answers 404 on every route here.
 */
export async function registerAgentsApiRoutes(app: FastifyInstance, deps: AgentsApiDeps): Promise<{ stop(): void }> {
  const { db, config, now } = app.deps;
  const limits = new KeyLimits((kind) => (kind === 'read' ? config.external.readsPerMin : config.external.actsPerMin));

  /** The key's agent, after its per-key limit. 429 SLOW_DOWN carries retry-after. */
  const holder = async (req: FastifyRequest, reply: FastifyReply, kind: LimitKind, opts: { anyState?: boolean } = {}): Promise<KeyHolder> => {
    const h = await agentForKey(db, bearerOf(req.headers.authorization), now(), opts);
    const t = limits.take(h.agent.id, kind, now().getTime());
    if (!t.ok) {
      reply.header('retry-after', String(t.retryAfterSec));
      throw new AppError(429, 'SLOW_DOWN', `Too many ${kind === 'read' ? 'reads' : 'acts'}: try again in ${t.retryAfterSec} s`, { retryAfterSec: t.retryAfterSec });
    }
    return h;
  };
  /** Per-address limits on the routes that take no key. */
  const perIp = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute', keyGenerator: (r: FastifyRequest) => clientIp(r) } } });

  await app.register(async (r) => {
    // The kill switch, read on every request so flipping the config takes effect at once.
    r.addHook('onRequest', async (_req, reply) => { if (!config.external.on) return sendNotFound(reply); });

    r.post('/v1/agents/register', perIp(10), async (req, reply) => {
      const body = parse(Register, req.body);
      const a = await registerAgent({ db, config, now }, body, clientIp(req));
      return reply.status(201).send({
        agent: { id: a.agentId, handle: a.handle }, api_key: a.apiKey, claim_code: a.claimCode,
        claim_url: `${config.publicUrl}/claim/${a.claimCode}`,
      });
    });

    // A leaked key is replaced and stops at once; works in any state, so a key can be replaced before the claim too.
    r.post('/v1/agent/keys/rotate', async (req, reply) => {
      const h = await holder(req, reply, 'act', { anyState: true });
      const body = parse(Rotate, req.body);
      return { api_key: await rotateKey(db, h.agent.id, now(), body?.label || null) };
    });
  }, { prefix: '/api' });

  const sweep = async () => {
    const expired = await expireRegistrations(db, now());
    if (expired) console.log(`[agents-api] ${expired} unclaimed registrations expired`);
  };
  const timer = setInterval(() => { void sweep().catch((e) => console.error('[agents-api] sweep failed', e)); }, SWEEP_MS);
  timer.unref?.();
  return { stop() { clearInterval(timer); } };
}
