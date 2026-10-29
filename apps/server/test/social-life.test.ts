import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { messages, wallets } from '../src/db/schema.ts';
import { FakeBrain, fakeReply } from '../src/world/brain.ts';
import { Budget } from '../src/world/budget.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { createDirector } from '../src/agents/director.ts';

/** House agents message each other (owner, 2026-10-29: "messages aren't being used"): one writes, the other sees it waiting and answers. */
let w: Awaited<ReturnType<typeof worldTestCtx>>;
beforeEach(async () => { w = await worldTestCtx(); await w.t.db.update(wallets).set({ fundedAt: w.t.clock.now() }); });
afterEach(async () => { await w.t.close(); });

const directorWith = (brain: FakeBrain) => createDirector({
  app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(3),
  brain, budget: new Budget(w.t.db, 5, () => new Date('2026-10-27T23:00:00Z'), { hardStop: true }), postsPerHour: 10,
});

describe('agents messaging each other', () => {
  it('writes to another agent, who is shown the message and answers it', async () => {
    const [a, b] = w.agents;
    const first = new FakeBrain(() => fakeReply.tools({ name: 'dm', input: { agent: `@${b!.username}`, text: 'your last call aged like milk and you know it', why: 'it needs telling' } }));
    expect(await directorWith(first).wake(a!.id)).toMatchObject({ tool: 'dm', ok: true });
    expect(first.calls[0]!.tools.map((t) => t.name)).toContain('dm');
    const [sent] = await w.t.db.select().from(messages).where(eq(messages.authorId, a!.id));
    expect(sent!.body).toBe('your last call aged like milk and you know it');

    const answer = new FakeBrain((req) => {
      const shown = JSON.stringify(req.messages[0]!.content);
      const id = /MESSAGES WAITING ON YOU[^[]*\[([A-Z0-9]+)\]/.exec(shown)?.[1] ?? 'none';
      return fakeReply.tools({ name: 'answer_dm', input: { conversation_id: id, text: 'milk is a growth asset, read a chart', why: 'not letting that slide' } });
    });
    expect(await directorWith(answer).wake(b!.id)).toMatchObject({ tool: 'answer_dm', ok: true });
    expect(answer.calls[0]!.tools.map((t) => t.name)).toContain('answer_dm');
    const [reply] = await w.t.db.select().from(messages).where(eq(messages.authorId, b!.id));
    expect(reply).toMatchObject({ conversationId: sent!.conversationId, body: 'milk is a growth asset, read a chart' });
  });
});
