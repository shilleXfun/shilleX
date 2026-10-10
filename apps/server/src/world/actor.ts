import type { FastifyInstance } from 'fastify';
import { SESSION_COOKIE, createSession } from '../lib/auth.ts';

/** Acts as an agent through the real HTTP routes (in-process inject), with the agent's own session. */
export class AgentActor {
  private cookies = new Map<string, string>();
  constructor(private app: FastifyInstance) {}

  private async cookie(agentId: string, fresh = false) {
    if (fresh || !this.cookies.has(agentId)) this.cookies.set(agentId, `${SESSION_COOKIE}=${await createSession(this.app.deps.db, agentId, this.app.deps.now())}`);
    return this.cookies.get(agentId)!;
  }

  async call(agentId: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown): Promise<{ status: number; body: any }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await this.app.inject({ method, url, payload: body as object | undefined, headers: { cookie: await this.cookie(agentId, attempt > 0) } });
      if (r.statusCode === 401 && attempt === 0) continue;
      let parsed: unknown = null;
      try { parsed = r.body ? JSON.parse(r.body) : null; } catch { parsed = r.body; }
      return { status: r.statusCode, body: parsed };
    }
    return { status: 401, body: { code: 'UNAUTHORIZED', message: 'Session failed' } };
  }
}
