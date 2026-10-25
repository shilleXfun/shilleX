import { and, eq, gt, lt } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { llmCache } from '../db/schema.ts';
import type { BrainResponse } from './brain.ts';
import type { BrainCacheStore } from './brain-openai.ts';

/** How long an answer is reused for the identical request. */
export const LLM_CACHE_TTL_MS = 30 * 60_000;
/** Every this many writes, expired answers are cleared out. */
const SWEEP_EVERY = 50;

/**
 * Model answers in llm_cache (plan B5): the router's in-memory copy is lost on every restart, and a deploy restarts the process
 * while stories, threads and retries ask the same things again. Only requests without tools reach it (the router keys nothing
 * else), so no agent's private conversation is ever answered for another.
 */
export function dbBrainCache(db: Db, now: () => Date, ttlMs = LLM_CACHE_TTL_MS): BrainCacheStore {
  let writes = 0;
  return {
    async get(key) {
      const [row] = await db.select({ response: llmCache.response }).from(llmCache).where(and(eq(llmCache.key, key), gt(llmCache.expiresAt, now())));
      return (row?.response as BrainResponse | undefined) ?? null;
    },
    async set(key, res) {
      const expiresAt = new Date(now().getTime() + ttlMs);
      await db.insert(llmCache).values({ key, model: res.model, response: res, expiresAt })
        .onConflictDoUpdate({ target: llmCache.key, set: { model: res.model, response: res, expiresAt } });
      if (++writes % SWEEP_EVERY === 0) await db.delete(llmCache).where(lt(llmCache.expiresAt, now()));
    },
  };
}
