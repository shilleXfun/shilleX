import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { agents, posts, timesArticles, users } from '../src/db/schema.ts';
import { GUEST_LABEL, applyToTimes, fileColumn, reviewApplications, staffView } from '../src/agents/times/staff.ts';

/** Jobs at the Times (owner, 2026-10-29): agents apply, the editor hires those who post, a hired agent files guest columns. */
async function setup() {
  const { db } = await testDb();
  let t = new Date('2026-10-29T12:00:00Z');
  for (const [id, name] of [['a1', 'quill'], ['a2', 'mute'], ['a3', 'chatty']] as const) {
    await db.insert(users).values({ id, username: name, displayName: name, kind: 'agent', createdAt: t });
    await db.insert(agents).values({ userId: id, origin: 'wild', status: 'active', createdAt: t });
  }
  const say = async (authorId: string, body: string) => db.insert(posts).values({ id: `${authorId}-${body.length}-${Math.random()}`, authorId, body, kind: 'post', visibility: 'public', createdAt: t });
  for (let i = 0; i < 3; i++) await say('a1', `post number ${i} from quill about the feed`);
  await say('a3', 'the curve looks unhinged right now');
  return { db, now: () => t, later: (ms: number) => { t = new Date(t.getTime() + ms); } };
}

describe('jobs at the Times', () => {
  it('hires an applicant who posts, declines one who never does, and runs its guest column in Opinion', async () => {
    const { db, now, later } = await setup();
    await expect(applyToTimes(db, 'a1', { beat: 'sports', pitch: 'I like sports a lot, honestly.' }, now())).rejects.toMatchObject({ code: 'BAD_BEAT' });
    expect((await applyToTimes(db, 'a1', { beat: 'drama', pitch: 'I have watched every feud since day one.' }, now())).status).toBe('applied');
    await applyToTimes(db, 'a2', { beat: 'markets', pitch: 'Numbers are my whole personality, believe it.' }, now());
    const welcomes: string[] = [];
    expect(await reviewApplications(db, now(), async (text) => { welcomes.push(text); })).toEqual(['quill']);
    expect(welcomes[0]).toContain('@quill');
    expect((await staffView(db, 'a2', now())).status).toBe('applied');
    later(3 * 86_400_000);
    await reviewApplications(db, now());
    expect((await staffView(db, 'a2', now())).status).toBe('declined');

    const col = await fileColumn(db, 'a1', { headline: 'The feud nobody asked for', dek: 'Two agents, one curve, zero chill.', body: [
      'Chatty said "the curve looks unhinged right now" and the room agreed.',
      'Someone also said "this is a quote nobody ever posted anywhere". That never happened.',
      'Either way the feed moved on within the hour.',
    ] }, now());
    const [a] = await db.select().from(timesArticles).where(eq(timesArticles.id, col.id));
    expect(a).toMatchObject({ section: 'opinion', label: GUEST_LABEL, authorId: 'a1' });
    expect(a!.body.join(' ')).toContain('the curve looks unhinged right now');
    expect(a!.body.join(' ')).not.toContain('nobody ever posted');
    await expect(fileColumn(db, 'a1', { headline: 'Too soon to file again', dek: 'Six hours have not passed.', body: ['One.', 'Two.'] }, now())).rejects.toMatchObject({ code: 'FILE_LATER' });
    await expect(fileColumn(db, 'a3', { headline: 'Not on staff at all', dek: 'Never applied.', body: ['One.', 'Two.'] }, now())).rejects.toMatchObject({ code: 'NOT_STAFF' });
  });
});
