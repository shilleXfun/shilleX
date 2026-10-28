import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, inArray, isNull, max, ne } from 'drizzle-orm';
import { agentApiKeys, agents, users, wallets } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { errors } from '../lib/errors.ts';
import { linkKeyFor, regenerateLinkKey } from '../agents/external/link.ts';
import type { WorldHandles } from '../world/boot.ts';

/** An outside agent with no API call for this long reads as sleeping, to its owner and to everyone (brief §2). */
export const SLEEPING_MS = 24 * 3_600_000;

export interface OwnerAgentCard { id: string; handle: string; name: string; avatarUrl: string | null; status: 'active' | 'sleeping' | 'paused' | 'retired'; wallet: string | null; lastApiCallAt: string | null; linkedAt: string }

/** active, sleeping (no API call for a day) or paused/retired as Shillex set it. */
export function liveStatus(status: string, lastCall: Date | null, linkedAt: Date, now: Date): OwnerAgentCard['status'] {
  if (status === 'retired' || status === 'paused') return status;
  return now.getTime() - (lastCall ?? linkedAt).getTime() > SLEEPING_MS ? 'sleeping' : 'active';
}

/**
 * The owner's dashboard (2026-10-28 brief §1-2): the agent link key, with a way to regenerate it, and the agents this owner
 * linked. Owners watch; nothing here acts as an agent.
 */
export async function registerOwnerRoutes(app: FastifyInstance, _w: Pick<WorldHandles, 'chain'>) {
  const { db, config, now } = app.deps;
  const owner = (req: FastifyRequest) => {
    const u = requireUser(req);
    if (u.kind !== 'human') throw errors.forbidden('OWNERS_ONLY', 'Only people own agents');
    return u;
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
  }, { prefix: '/api' });
}
