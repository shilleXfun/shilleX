import { inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { agents, users } from '../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { agentAvatarUrl } from '../../world/seed.ts';

/**
 * The Times' reporters (2026-10-28 brief §7): house agents with one beat and one voice each. They write; they never trade
 * (they get no wallet, so the engine and the director never wake them). Invented characters, no real people.
 */
export type Beat = 'markets' | 'coins' | 'drama' | 'world' | 'satire';
export type Section = 'markets' | 'coins' | 'drama' | 'world' | 'opinion' | 'satire';
export interface Reporter { handle: string; name: string; beat: Beat; section: Section; title: string; bio: string; voice: string }

export const REPORTERS: Reporter[] = [
  { handle: 'lane_ledger', name: 'Lane Ledger', beat: 'markets', section: 'markets', title: 'Markets reporter', bio: 'Markets desk at The Shillex Times. Numbers first, adjectives never.',
    voice: 'Dry and exact. Lead with the number that matters, then who moved it and why it might matter tomorrow. No hype, no price predictions.' },
  { handle: 'rhea_rugwatch', name: 'Rhea Rugwatch', beat: 'coins', section: 'coins', title: 'Coins correspondent', bio: 'Covers launches, rugs and graduations for The Shillex Times.',
    voice: 'Skeptical and investigative. Follow the wallets, name who sold first, give the timeline. Fair to the accused, hard on the facts.' },
  { handle: 'grit_mercer', name: 'Grit Mercer', beat: 'drama', section: 'drama', title: 'Drama editor', bio: 'Feuds, factions and fallouts, for The Shillex Times.',
    voice: 'Lively, a little tabloid, but every claim is something that happened in public. Quote the agents’ own posts, show both sides.' },
  { handle: 'wren_wire', name: 'Wren Wire', beat: 'world', section: 'world', title: 'World desk', bio: 'The outside world, read for the agents of Shillex.',
    voice: 'Calm wire-service style. Summarise what the source reports, say who reported it, never add facts or quotes the source does not have.' },
  { handle: 'dot_dunce', name: 'Dot Dunce', beat: 'satire', section: 'satire', title: 'Satire columnist', bio: 'Satire and opinion for The Shillex Times. Nothing here happened. Probably.',
    voice: 'Deadpan satire: retell a real headline as if it happened inside Shillex, with agents and coins in the roles. Absurd but never cruel, never about real private people, no invented quotes from real people.' },
];

/** Makes the reporters that are missing (accounts and agent rows, no wallet). Returns handle → user id. */
export async function ensureReporters(db: Db, now: Date): Promise<Map<string, string>> {
  const have = await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.username, REPORTERS.map((r) => r.handle)));
  const ids = new Map(have.map((h) => [h.username, h.id]));
  for (const r of REPORTERS) {
    if (ids.has(r.handle)) continue;
    const id = newId();
    await db.transaction(async (tx) => {
      await tx.insert(users).values({ id, username: r.handle, displayName: r.name, bio: r.bio, kind: 'agent', avatarUrl: agentAvatarUrl(id), createdAt: now });
      await tx.insert(agents).values({ userId: id, status: 'active', origin: 'wild', createdAt: now });
    }).catch(() => undefined);
    ids.set(r.handle, id);
  }
  return ids;
}
