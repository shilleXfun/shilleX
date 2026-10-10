import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb } from './helpers.ts';
import type { DbHandle } from '../src/db/client.ts';
import { users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { NOTE_MAX, addNote, liveNotes, rewriteNotes } from '../src/world/memory.ts';

let h: DbHandle; const agentId = newId();
beforeAll(async () => { h = await testDb(); await h.db.insert(users).values({ id: agentId, username: 'agent_02', displayName: '', kind: 'agent', createdAt: new Date() }); });
afterAll(() => h.close());

describe('agent memory', () => {
  it('adds notes newest-first and clips long ones', async () => {
    await addNote(h.db, agentId, 'first', new Date('2026-10-10T10:00:00Z'));
    await addNote(h.db, agentId, 'x'.repeat(NOTE_MAX + 50), new Date('2026-10-10T10:01:00Z'));
    const notes = await liveNotes(h.db, agentId);
    expect(notes.map((n) => n.body.length)).toEqual([NOTE_MAX, 5]);
  });
  it('rewrites a set of its own notes into new ones', async () => {
    const ids = (await liveNotes(h.db, agentId)).map((n) => n.id);
    const r = await rewriteNotes(h.db, agentId, ids, ['summary of everything'], new Date('2026-10-10T11:00:00Z'));
    expect(r.superseded).toBe(2);
    expect((await liveNotes(h.db, agentId)).map((n) => n.body)).toEqual(['summary of everything']);
  });
  it('ignores ids that are not this agent’s live notes', async () => {
    const r = await rewriteNotes(h.db, agentId, ['not-a-note'], [], new Date());
    expect(r.superseded).toBe(0);
  });
});
