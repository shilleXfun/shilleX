import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { normalizeLine, lineageId, recordLineage, adoptFromReactions, withBorrowed, lineageModule } from '../src/agents/depth/lineage.ts';
import { adjustAffinity, loadState, saveState } from '../src/agents/state.ts';
import { emptyDepth } from '../src/agents/depth/registry.ts';
import { FALLBACK_LINES } from '../src/agents/phrasebook.ts';
import { runTool } from '../src/world/tools.ts';
import { lineage } from '../src/db/schema.ts';
import type { Phrasebook } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>>;
afterEach(async () => { await ctx?.t.close(); ctx = undefined as never; });

describe('lineage', () => {
  it('identifies a line by its normalized template', () => {
    expect(normalizeLine('  Ngmi   {user}!! ')).toBe('ngmi {user}!!');
    expect(lineageId('line', 'Ngmi {user}')).toBe(lineageId('line', 'ngmi   {user}'));
    expect(lineageId('caption', 'x')).not.toBe(lineageId('line', 'x'));
  });
  it('credits the inventor and counts uses', async () => {
    ctx = await depthTestCtx();
    const a = ctx.agents[0]!;
    const id = await recordLineage(ctx.t.db, { kind: 'line', text: 'ngmi {user}', situation: 'roast', inventorId: a.id }, ctx.t.clock.now());
    await recordLineage(ctx.t.db, { kind: 'line', text: 'NGMI {user}', situation: 'roast', inventorId: ctx.agents[1]!.id }, ctx.t.clock.now());
    const [row] = await ctx.t.db.select().from(lineage).where(eq(lineage.id, id));
    expect(row).toMatchObject({ inventorId: a.id, uses: 2, situation: 'roast' });
  });
  it('spreads a line to friends who reacted, keeping the inventor', async () => {
    ctx = await depthTestCtx();
    const author = ctx.agents[0]!, fans = ctx.agents.slice(1, 4);
    const posted = await runTool(await ctx.ctxFor(author), 'post', { body: 'ngmi agent_09' });
    const postId = (posted.result as { post_id: string }).post_id;
    const id = await recordLineage(ctx.t.db, { kind: 'line', text: 'ngmi {user}', situation: 'roast', inventorId: author.id }, ctx.t.clock.now());
    for (const f of fans) {
      await adjustAffinity(ctx.t.db, f.id, author.id, 0.6, ctx.t.clock.now());
      const s = await loadState(ctx.t.db, f.id, ctx.t.clock.now());
      await saveState(ctx.t.db, f.id, { ...s, traits: { ...s.traits, curiosity: 1 } }, ctx.t.clock.now());
      await runTool(await ctx.ctxFor(f), 'react', { target_type: 'post', target_id: postId, emoji: '🔥' });
    }
    const adopted = await adoptFromReactions({ ...ctx.d, rng: () => 0.1 }, postId, id, author.id);
    expect(adopted.sort()).toEqual(fans.map((f) => f.id).sort());
    const [row] = await ctx.t.db.select().from(lineage).where(eq(lineage.id, id));
    expect(row!.inventorId).toBe(author.id);
    expect(await adoptFromReactions({ ...ctx.d, rng: () => 0.1 }, postId, id, author.id)).toEqual([]);
  });
  it('merges borrowed lines into the phrasebook for their situation', () => {
    const pb: Phrasebook = { voice: '', traits: {} as never, lines: { roast: ['mine'] }, openers: [], closers: [], memeCaptions: [], interests: [] };
    const out = withBorrowed(pb, [{ lineageId: 'L', text: 'ngmi {user}', situation: 'roast', inventorId: 'x' }]);
    expect(out.lines.roast).toEqual(['mine', 'ngmi {user}']);
    expect(pb.lines.roast).toEqual(['mine']);
  });
  it('records the template an action used', async () => {
    ctx = await depthTestCtx();
    const a = ctx.agents[0]!;
    const v = { agent: { id: a.id }, depth: emptyDepth() } as never;
    await lineageModule.afterAct!(ctx.d, v, { kind: 'post', score: 1, reason: 'r', situation: 'gm' }, { ok: true, turnId: 't', postId: 'p1', text: 'gm from my own corner', line: { key: 'gm:0', template: 'gm from my own corner', situation: 'gm' } });
    const [row] = await ctx.t.db.select().from(lineage).where(eq(lineage.id, lineageId('line', 'gm from my own corner')));
    expect(row).toMatchObject({ inventorId: a.id, uses: 1, situation: 'gm' });
  });
  it('does not credit an inventor for stock fallback templates', async () => {
    ctx = await depthTestCtx();
    const a = ctx.agents[0]!;
    const v = { agent: { id: a.id }, depth: emptyDepth() } as never;
    const stock = FALLBACK_LINES.gm[0]!.toUpperCase();
    await lineageModule.afterAct!(ctx.d, v, { kind: 'post', score: 1, reason: 'r', situation: 'gm' }, { ok: true, turnId: 't', postId: 'p2', text: stock, line: { key: 'gm:0', template: stock, situation: 'gm' } });
    const rows = await ctx.t.db.select().from(lineage).where(eq(lineage.id, lineageId('line', stock)));
    expect(rows).toEqual([]);
  });
});
