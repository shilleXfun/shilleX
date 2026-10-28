import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, inArray, isNotNull, isNull, max, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { OwnerAgentCard } from '@shillex/shared';
import { agentApiKeys, agentRules, agents, userWallets, users, wallets, type UserRow } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { errors } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { WalletProofBody, verifyProof } from '../services/wallet-auth.ts';
import { linkKeyFor, regenerateLinkKey } from '../agents/external/link.ts';
import { NAME_MAX, cleanField } from '../agents/external/register.ts';
import { savedRules } from '../agents/external/limits-hard.ts';
import { mindView, setMind } from '../agents/external/mind.ts';
import { ownerAgentView, ownerLimits } from '../agents/external/owner-view.ts';
import { liveStatus } from '../agents/external/sleeping.ts';
import { TRAITS } from '../agents/state.ts';
import type { Trait } from '../agents/types.ts';
import type { WorldHandles } from '../world/boot.ts';
import { normalizeRules } from '../world/sol-rules.ts';

const Slider = z.number().int().min(1).max(10);
const Settings = z.object({
  /** The agent's name, set by its owner (2026-10-28): up to NAME_MAX characters, plain text. */
  name: z.string().max(200).optional(),
  mind: z.partialRecord(z.enum(TRAITS as [Trait, ...Trait[]]), Slider).optional(),
  limits: z.object({
    tradingOn: z.boolean().optional(), launchingOn: z.boolean().optional(),
    maxSolPerTrade: z.number().min(0.001).max(1000).nullable().optional(), dailyLossBreakPct: z.number().min(0.01).max(0.99).nullable().optional(),
  }).optional(),
  /** On mainnet, changing the limits takes a fresh signature from a wallet linked to the owner's account, as withdrawals do. */
  wallet: WalletProofBody.optional(),
});

/**
 * The owner's dashboard (2026-10-28 brief §1-2): the agent link key, with a way to regenerate it, the agents this owner linked,
 * the deep view of each, and the one thing an owner may change: the mind sliders and the hard limits. Owners watch; nothing here
 * posts or acts as an agent.
 */
export async function registerOwnerRoutes(app: FastifyInstance, w: Pick<WorldHandles, 'chain'>) {
  const { db, config, now } = app.deps;
  const owner = (req: FastifyRequest) => {
    const u = requireUser(req);
    if (u.kind !== 'human') throw errors.forbidden('OWNERS_ONLY', 'Only people own agents');
    return u;
  };
  /** The owner's agent by handle; anyone else gets 403 (404 when there is no such agent). */
  const ownedAgent = async (u: UserRow, handle: string) => {
    const [a] = await db.select({ id: users.id, origin: agents.origin, ownerId: agents.ownerId, status: agents.status }).from(users).innerJoin(agents, eq(agents.userId, users.id))
      .where(eq(users.username, handle.replace(/^@/, '').toLowerCase()));
    if (!a) throw errors.notFound('Agent');
    if (a.ownerId !== u.id || a.status === 'retired') throw errors.forbidden('NOT_OWNER', 'Only this agent’s owner can see that');
    return a;
  };

  const cards = async (ownerId: string): Promise<OwnerAgentCard[]> => {
    const rows = await db.select({ id: users.id, handle: users.username, name: users.displayName, avatarUrl: users.avatarUrl, status: agents.status, linkedAt: agents.createdAt, wallet: wallets.publicKey })
      .from(agents).innerJoin(users, eq(users.id, agents.userId)).leftJoin(wallets, eq(wallets.ownerId, agents.userId))
      .where(and(eq(agents.ownerId, ownerId), eq(agents.origin, 'external'), ne(agents.status, 'retired'))).orderBy(desc(agents.createdAt));
    const ids = rows.map((r) => r.id);
    const calls = ids.length ? await db.select({ id: agentApiKeys.agentId, at: max(agentApiKeys.lastUsedAt) }).from(agentApiKeys)
      .where(and(inArray(agentApiKeys.agentId, ids), isNull(agentApiKeys.revokedAt))).groupBy(agentApiKeys.agentId) : [];
    const last = new Map(calls.map((c) => [c.id, c.at ? new Date(c.at) : null]));
    return rows.map((r) => ({
      id: r.id, handle: r.handle, name: r.name, avatarUrl: r.avatarUrl, wallet: r.wallet, linkedAt: r.linkedAt.toISOString(),
      lastApiCallAt: last.get(r.id)?.toISOString() ?? null, status: liveStatus(r.status, last.get(r.id) ?? null, r.linkedAt, now()),
    }));
  };
  const keyView = (k: { key: string; createdAt: Date }) => ({ key: k.key, createdAt: k.createdAt.toISOString() });

  await app.register(async (r) => {
    r.get('/owner', async (req) => {
      const u = owner(req);
      return { linkKey: keyView(await linkKeyFor(db, config.sessionSecret, u.id, now())), agents: await cards(u.id), cap: config.external.ownerMax };
    });
    r.post('/owner/link-key/regenerate', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
      const u = owner(req);
      return { linkKey: keyView(await regenerateLinkKey(db, config.sessionSecret, u.id, now())) };
    });

    r.get<{ Params: { handle: string } }>('/owner/agents/:handle', async (req) => {
      const a = await ownedAgent(owner(req), req.params.handle);
      return ownerAgentView({ db, chain: w.chain, config, now: now() }, a.id);
    });

    r.put<{ Params: { handle: string } }>('/owner/agents/:handle/settings', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
      const u = owner(req);
      const a = await ownedAgent(u, req.params.handle);
      const body = parse(Settings, req.body);
      const at = now();
      let signedBy = `session:${u.id}`;
      if (body.limits && config.solanaNetwork === 'mainnet') {
        if (!body.wallet) throw errors.forbidden('WALLET_PROOF_REQUIRED', 'On mainnet, sign with a wallet linked to your account to change the limits');
        const { address } = await verifyProof(app.deps, body.wallet, 'confirm', u.id);
        const [linked] = await db.select({ a: userWallets.address }).from(userWallets).where(and(eq(userWallets.address, address), eq(userWallets.userId, u.id), isNotNull(userWallets.verifiedAt)));
        if (!linked) throw errors.forbidden('WALLET_NOT_LINKED', 'Sign with a wallet linked to your account (Settings → Wallets)');
        signedBy = address;
      }
      if (body.name !== undefined) await db.update(users).set({ displayName: cleanField('NAME_INVALID', body.name, NAME_MAX, true) }).where(eq(users.id, a.id));
      if (body.mind) await setMind(db, a.id, body.mind, at);
      if (body.limits) {
        const merged: Record<string, unknown> = { ...((await savedRules(db, a.id)).rules ?? {}) };
        for (const [k, v] of Object.entries(body.limits)) { if (v === null) delete merged[k]; else if (v !== undefined) merged[k] = v; }
        const rules = normalizeRules(merged);
        // Saving the limits also ends a loss break: the owner has looked and decided.
        await db.insert(agentRules).values({ agentId: a.id, rules, signedBy, updatedAt: at })
          .onConflictDoUpdate({ target: agentRules.agentId, set: { rules, signedBy, updatedAt: at, pausedUntil: null, pausedReason: null } });
      }
      return { mind: await mindView(db, a.id), limits: await ownerLimits(db, config, a, at) };
    });
  }, { prefix: '/api' });
}
