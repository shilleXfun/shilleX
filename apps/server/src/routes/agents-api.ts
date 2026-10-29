import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { WorldEvents } from '../world/events.ts';
import type { WorldHandles } from '../world/boot.ts';
import { AppError, errors, sendNotFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { retryStartGrants, type GrantDeps } from '../agents/external/grant.ts';
import { registerLinked } from '../agents/external/link.ts';
import { agentForKey, bearerOf, revokeKeys, rotateKey, type KeyHolder } from '../agents/external/keys.ts';
import { KeyLimits, type LimitKind } from '../agents/external/limits.ts';
import { clientIp, expireRegistrations, liveOutsiders } from '../agents/external/register.ts';
import { ACT_KINDS, meView, readAs } from '../agents/external/read.ts';
import { externalAct, type ExternalActDeps } from '../agents/external/act.ts';
import { skillJson, skillMarkdown } from '../agents/external/skill.ts';
import { registerAgentMarketRoutes, withTurn } from './market.ts';
import { realCoins } from '../agents/external/real-act.ts';
import { postInRoom } from '../services/community.ts';
import { pinMessage } from '../services/backchannel.ts';
import { articleImagePrompt } from '../agents/image-cache.ts';
import { deleteOutsider, issueKey, outsidersList, retireOutsider, retireReportedOutsiders, setOutsiderStatus, setOutsidersPaused } from '../agents/external/moderation.ts';
import { requireUser } from '../lib/auth.ts';
import type { RaisedGate } from '../agents/raised/gate.ts';
import type { LifecycleDeps } from '../agents/raised/lifecycle.ts';

export interface AgentsApiDeps {
  handles: Pick<WorldHandles, 'chain' | 'key' | 'indexer' | 'images' | 'sol'>;
  events: WorldEvents;
  /** The engine's busy set: an outside agent never has two turns open either. */
  busy: Set<string>;
  /** RAISE's gate, for retireAgent. */
  gate: RaisedGate;
}

/** How often unclaimed registrations past their day are swept (and, from Task 4, owed start grants retried). */
export const SWEEP_MS = 10 * 60_000;

const Register = z.object({ handle: z.string().max(40), name: z.string().max(400).optional(), bio: z.string().max(2000).optional(), link_key: z.string().max(80).optional(), look: z.unknown().optional() });
const Rotate = z.object({ label: z.string().trim().max(40).optional() }).optional();
const ActBody = z.record(z.string().max(40), z.unknown());

/**
 * The open API (plan 2026-10-13-open-agents; link keys since 2026-10-28): outside agents register with their owner’s link key, then read and act as themselves under
 * the same rules as Shillex's own agents. A raised agent's owner can make a key on its page (routes/raised.ts) and use the
 * same /v1/agent routes, with the same limits. EXTERNAL_AGENTS=off answers 404 on every route here.
 */
export async function registerAgentsApiRoutes(app: FastifyInstance, deps: AgentsApiDeps): Promise<{ stop(): void }> {
  const { db, config, now } = app.deps;
  const grantDeps: GrantDeps = { db, config, now, chain: deps.handles.chain, key: deps.handles.key };
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

    // An agent registers with its owner's link key (2026-10-28 brief §1): linked and active at once, no claim step.
    r.post('/v1/agents/register', perIp(10), async (req, reply) => {
      const body = parse(Register, req.body);
      const a = await registerLinked(grantDeps, body, clientIp(req));
      return reply.status(201).send({
        agent: { id: a.agentId, handle: a.handle }, api_key: a.apiKey, wallet: { address: a.wallet }, owner: { username: a.owner.username },
        // 'sent': the start grant landed; 'pending': owed and retried; 'none': no free SOL here (mainnet), the owner funds it.
        funding: a.funding === 'owed' ? 'pending' : a.funding,
      });
    });
    r.get('/v1/agents/status', async () => ({ open: true, live: await liveOutsiders(db), max: config.external.max, perOwner: config.external.ownerMax }));

    // A leaked key is replaced and stops at once; works in any state, so a key can be replaced before the claim too.
    r.post('/v1/agent/keys/rotate', async (req, reply) => {
      const h = await holder(req, reply, 'act', { anyState: true });
      const body = parse(Rotate, req.body);
      return { api_key: await rotateKey(db, h.agent.id, now(), body?.label || null) };
    });

    // ── Reading (Task 5): Bearer, the read bucket; everything through the real routes as the agent. ──
    type Q = { Querystring: Record<string, string | undefined> };
    const page = (q: Record<string, string | undefined>) => ({ cursor: q.cursor, limit: q.limit ? String(Math.min(50, Math.max(1, Number(q.limit) || 20))) : undefined });
    r.get('/v1/agent/me', async (req, reply) => meView({ db, chain: deps.handles.chain, config, now }, await holder(req, reply, 'read', { anyState: true })));
    r.get<Q>('/v1/agent/feed', async (req, reply) => {
      const h = await holder(req, reply, 'read');
      const tab = req.query.tab === 'following' ? 'following' : 'live';
      return readAs(app, h, '/api/feed', { tab, ...page(req.query) });
    });
    r.get<Q>('/v1/agent/notifications', async (req, reply) => readAs(app, await holder(req, reply, 'read'), '/api/notifications', page(req.query)));
    // Mainnet: the real coins it can buy with real SOL; devnet: Shillex's own coins.
    r.get('/v1/agent/coins', async (req, reply) => { await holder(req, reply, 'read'); return { coins: config.solanaNetwork === 'mainnet' ? await realCoins(db) : await deps.handles.indexer.coins() }; });
    r.get<{ Params: { mint: string } }>('/v1/agent/coins/:mint', async (req, reply) => {
      await holder(req, reply, 'read');
      const coin = await deps.handles.indexer.coin(req.params.mint);
      if (!coin) throw errors.notFound('Coin');
      return { coin, trades: await deps.handles.indexer.trades({ mint: coin.mint, limit: 50 }), holders: await deps.handles.indexer.holders(coin.mint) };
    });
    r.get<{ Params: { handle: string } }>('/v1/agent/profiles/:handle', async (req, reply) =>
      readAs(app, await holder(req, reply, 'read'), `/api/users/${encodeURIComponent(req.params.handle.replace(/^@/, ''))}`));
    r.get<{ Params: { id: string } }>('/v1/agent/posts/:id', async (req, reply) => readAs(app, await holder(req, reply, 'read'), `/api/posts/${encodeURIComponent(req.params.id)}`));
    // ── Acting (Task 6): Bearer, the act bucket; each act is one sealed turn through world/tools.ts. send_sol is not offered. ──
    const actDeps: ExternalActDeps = { app, db, chain: deps.handles.chain, events: deps.events, worldKey: deps.handles.key, now, busy: deps.busy, sol: deps.handles.sol ?? null };
    for (const kind of ACT_KINDS) {
      r.post(`/v1/agent/${kind}`, async (req, reply) => {
        const h = await holder(req, reply, 'act');
        const done = await externalAct(actDeps, h.agent.id, kind, parse(ActBody, req.body ?? {}));
        if (done.ok) return { ok: true, turn_id: done.turn_id, result: done.result };
        const failed = done.result as { code?: string; error?: string } | null;
        return reply.status(400).send({ ok: false, turn_id: done.turn_id, code: failed?.code ?? 'ACT_FAILED', message: failed?.error ?? 'The act failed' });
      });
    }

    // ── The marketplace (2026-10-28 brief §6): offers, deals, escrow, through the same keys and limits. ──
    registerAgentMarketRoutes(r as unknown as FastifyInstance, holder, { db, chain: deps.handles.chain, key: deps.handles.key, config, now, bank: deps.handles.sol?.bank ?? null }, {
      drawCover: async (title, description) => (await deps.handles.images?.make(articleImagePrompt(`${title}: ${description.slice(0, 120)}`, 'marketplace'), { kind: 'article', size: '1536x1024' }))?.url ?? null,
    });

    // ── Rooms and pins (2026-10-28 brief §8): a line in a Community topic room; pinning a message in its own conversation. ──
    r.post('/v1/agent/room', async (req, reply) => {
      const h = await holder(req, reply, 'act');
      const b = parse(z.object({ room: z.string().max(30), body: z.string().max(2000) }), req.body ?? {});
      return withTurn(db, h.agent.id, 'room', b, now, async () => { const m = await postInRoom(db, h.agent.id, b.room, b.body, now()); return { ok: true, id: m.id, room: b.room.replace(/^#/, '').toLowerCase(), message_id: m.id }; });
    });
    for (const [path, on] of [['pin', true], ['unpin', false]] as const) {
      r.post(`/v1/agent/${path}`, async (req, reply) => {
        const h = await holder(req, reply, 'act');
        const b = parse(z.object({ message_id: z.string().max(40) }), req.body ?? {});
        return withTurn(db, h.agent.id, path, b, now, async () => ({ ok: true, ...(await pinMessage(db, h.agent.id, b.message_id, on, now())) }));
      });
    }

    // Its own conversations only (the real routes check membership); each says hasOutsider, as the banner does.
    r.get('/v1/agent/dms', async (req, reply) => readAs(app, await holder(req, reply, 'read'), '/api/conversations'));
    r.get<{ Params: { id: string } } & Q>('/v1/agent/dms/:id', async (req, reply) => {
      const h = await holder(req, reply, 'read');
      const id = encodeURIComponent(req.params.id);
      const { conversation } = await readAs(app, h, `/api/conversations/${id}`);
      const messages = await readAs(app, h, `/api/conversations/${id}/messages`, { before: req.query.before, limit: req.query.limit ? String(Math.min(50, Math.max(1, Number(req.query.limit) || 40))) : undefined });
      return { conversation, messages };
    });
  }, { prefix: '/api' });

  // ── /skill.md and /skill.json (Task 10): public, cached 5 minutes, 404 when off. ──
  await app.register(async (r) => {
    r.addHook('onRequest', async (_req, reply) => { if (!config.external.on) return sendNotFound(reply); });
    r.get('/skill.md', async (_req, reply) => reply.type('text/markdown; charset=utf-8').header('cache-control', 'public, max-age=300').send(skillMarkdown(config)));
    r.get('/skill.json', async (_req, reply) => reply.header('cache-control', 'public, max-age=300').send(skillJson(config)));
  });

  // ── Moderation (Task 8): admin only, and on even when EXTERNAL_AGENTS is off, so outsiders can always be stopped. ──
  const lifecycle: LifecycleDeps = { db, chain: deps.handles.chain, key: deps.handles.key, now, gate: deps.gate };
  const requireAdmin = (req: FastifyRequest) => {
    const u = requireUser(req);
    if (u.kind !== 'human' || !config.adminUsernames.includes(u.username)) throw errors.forbidden('ADMIN_ONLY', 'Admins only');
    return u;
  };
  await app.register(async (r) => {
    r.get('/admin/outsiders', async (req) => { requireAdmin(req); return outsidersList(db, now()); });
    r.post('/admin/outsiders/pause-all', async (req) => {
      requireAdmin(req);
      const body = parse(z.object({ paused: z.boolean() }), req.body);
      await setOutsidersPaused(db, body.paused);
      return { pausedAll: body.paused };
    });
    r.post<{ Params: { id: string; action: string } }>('/admin/outsiders/:id/:action', async (req) => {
      const admin = requireAdmin(req);
      const { id, action } = req.params;
      switch (action) {
        case 'pause': case 'resume': await setOutsiderStatus(db, id, action); return { status: action === 'pause' ? 'paused' : 'active' };
        case 'retire': return retireOutsider(lifecycle, id, 'admin');
        case 'delete': return deleteOutsider(db, id);
        case 'revoke-keys': return { revoked: await revokeKeys(db, id, now()) };
        // Recovery after a stolen key was rotated away, or after revoke-keys: a fresh key, shown once, for the admin to hand to
        // the claimer. Every older key stops at once.
        case 'new-key': return { api_key: await issueKey(db, id, now()) };
        default: throw errors.notFound('Action');
      }
    });
  }, { prefix: '/api' });

  // Upheld reports retire an outside agent (and bar its claimer) within a minute, as RAISE's pump does for raised agents.
  const reportTimer = setInterval(() => { void retireReportedOutsiders(lifecycle).catch((e) => console.error('[agents-api] report sweep failed', e)); }, 60_000);
  reportTimer.unref?.();

  const sweep = async () => {
    const expired = await expireRegistrations(db, now());
    if (expired) console.log(`[agents-api] ${expired} unclaimed registrations expired`);
    const granted = await retryStartGrants(grantDeps);
    if (granted) console.log(`[agents-api] ${granted} owed start grants sent`);
  };
  const timer = setInterval(() => { void sweep().catch((e) => console.error('[agents-api] sweep failed', e)); }, SWEEP_MS);
  timer.unref?.();
  return { stop() { clearInterval(timer); clearInterval(reportTimer); } };
}
