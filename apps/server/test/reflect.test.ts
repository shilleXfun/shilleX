import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { agentMemories, agentPersonas, agentReflections, agents, users } from '../src/db/schema.ts';
import { FakeBrain, fakeReply } from '../src/world/brain.ts';
import { Budget } from '../src/world/budget.ts';
import { REFLECT_EVERY_MS, reflectPass } from '../src/agents/reflect.ts';

const voice = { casing: 'lower', length: 'short', emoji: null, slang: [], signatures: [], neverWords: [], postRate: 1, replyBias: 0.4, humor: 'h', temper: 't', images: 'i', habit: 'h' } as never;

describe('sheets and reflections', () => {
  it('writes a sheet once and never again, reflects every six hours, and parks an agent with no record', async () => {
    const h = await testDb();
    const db = h.db;
    let now = new Date('2026-10-27T12:00:00Z');
    for (const id of ['a1', 'a2']) {
      await db.insert(users).values({ id, username: id, displayName: id, kind: 'agent', createdAt: now });
      await db.insert(agents).values({ userId: id, status: 'active', origin: 'wild', createdAt: now });
    }
    await db.insert(agentPersonas).values({ agentId: 'a1', job: 'social', background: 'b', worldview: 'w', humor: 'h', voice, source: 'model', createdAt: now, updatedAt: now });
    await db.insert(agentMemories).values({ id: 'm1', agentId: 'a1', kind: 'got_rugged', text: '@lamp dumped $MOTH on me', weight: 3, sourceId: 's1', at: now });
    const brain = new FakeBrain((req) => fakeReply.end(JSON.stringify(req.system[0]!.text.includes('character sheet')
      ? { beliefs: ['a coin with 20 holders is a wallet'], petPeeves: ['victory laps'], goals: ['outlast @lamp'] }
      : { beliefs: ['devs sell'], grudges: ['@lamp: dumped $MOTH on me'], goals: ['get even'] })));
    const budget = new Budget(db, 4, () => now, { hardStop: true, periodHours: 12 });
    expect(await reflectPass({ db, brain, budget, now: () => now })).toEqual({ sheets: 1, reflections: 1 });
    const [p] = await db.select().from(agentPersonas).where(eq(agentPersonas.agentId, 'a1'));
    expect(p!.sheet).toEqual({ beliefs: ['a coin with 20 holders is a wallet'], petPeeves: ['victory laps'], goals: ['outlast @lamp'] });
    // a2 has no record: parked with an empty reflection, no model call.
    expect((await db.select().from(agentReflections).where(eq(agentReflections.agentId, 'a2')))[0]).toMatchObject({ beliefs: [], grudges: [] });
    const calls = brain.calls.length;
    expect(await reflectPass({ db, brain, budget, now: () => now })).toEqual({ sheets: 0, reflections: 0 });
    expect(brain.calls.length).toBe(calls);
    now = new Date(now.getTime() + REFLECT_EVERY_MS + 60_000);
    expect((await reflectPass({ db, brain, budget, now: () => now })).reflections).toBe(1);
    expect((await db.select().from(agentPersonas).where(eq(agentPersonas.agentId, 'a1')))[0]!.sheet!.goals).toEqual(['outlast @lamp']);
    await h.close();
  });
});
