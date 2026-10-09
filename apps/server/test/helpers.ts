import type { FastifyInstance } from 'fastify';
import type { TokenView } from '@shillex/shared';
import { createDb } from '../src/db/client.ts';
import { loadConfig } from '../src/config.ts';
import { buildApp } from '../src/app.ts';
import { RecordingBus } from '../src/realtime/bus.ts';
import { InMemoryPresence } from '../src/services/presence.ts';
import { users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { createSession, SESSION_COOKIE } from '../src/lib/auth.ts';
import type { AppDeps, TokenResolverPort } from '../src/deps.ts';

export const pendingView = (mint: string): TokenView => ({
  mint, status: 'pending', source: null, name: null, symbol: null, imageUrl: null, decimals: null,
  liquidityUsd: null, marketCapUsd: null, fdvUsd: null, pairAddress: null, dexId: null,
  pairCreatedAt: null, promoted: false, fetchedAt: null, error: null,
});

export class FakeTokens implements TokenResolverPort {
  enqueued: string[] = [];
  views = new Map<string, TokenView>();
  enqueue(mints: string[]) { this.enqueued.push(...mints); }
  async resolve(mint: string) { return this.views.get(mint) ?? pendingView(mint); }
  async getViews(mints: string[]) { return Object.fromEntries(mints.map((m) => [m, this.views.get(m) ?? pendingView(m)])); }
}

export interface Res { status: number; body: any }
export interface TestUser { id: string; username: string; cookie: string }

export async function makeTestApp(over: Partial<AppDeps> = {}) {
  const handle = await createDb({});
  let current = new Date('2026-10-09T12:00:00Z');
  const clock = { now: () => current, set: (d: Date) => { current = d; }, advance: (ms: number) => { current = new Date(current.getTime() + ms); } };
  const bus = new RecordingBus();
  const tokens = (over.tokens as FakeTokens | undefined) ?? new FakeTokens();
  const presence = new InMemoryPresence();
  const config = loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 'test-secret' });
  const deps: AppDeps = { db: handle.db, dbKind: handle.kind, config, bus, tokens, presence, now: clock.now, ...over };
  const app: FastifyInstance = await buildApp(deps);

  async function createUser(username: string, opts: { createdAt?: Date; isDemo?: boolean } = {}): Promise<TestUser> {
    const id = newId();
    await handle.db.insert(users).values({
      id, username, displayName: username, createdAt: opts.createdAt ?? new Date('2026-01-01T00:00:00Z'), isDemo: opts.isDemo ?? false,
    });
    const token = await createSession(handle.db, id, clock.now());
    return { id, username, cookie: `${SESSION_COOKIE}=${token}` };
  }

  function as(user: TestUser | null) {
    const call = async (method: string, url: string, payload?: unknown): Promise<Res> => {
      const r = await app.inject({ method: method as any, url, payload: payload as any, headers: user ? { cookie: user.cookie } : {} });
      return { status: r.statusCode, body: r.body ? safeJson(r.body) : null };
    };
    return {
      get: (u: string) => call('GET', u),
      post: (u: string, b: unknown = {}) => call('POST', u, b),
      put: (u: string, b: unknown = {}) => call('PUT', u, b),
      patch: (u: string, b: unknown = {}) => call('PATCH', u, b),
      del: (u: string) => call('DELETE', u),
    };
  }

  return { app, db: handle.db, bus, tokens, presence, clock, deps, createUser, as, close: async () => { await app.close(); await handle.close(); } };
}

function safeJson(s: string) { try { return JSON.parse(s); } catch { return s; } }
export type TestCtx = Awaited<ReturnType<typeof makeTestApp>>;
