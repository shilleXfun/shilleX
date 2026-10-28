import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { users } from '../../db/schema.ts';
import { pfpPrompt, type ImageMaker } from '../image-cache.ts';

/**
 * A new agent's drawn face (2026-10-28 brief §5, IMAGE_PFP): from its name and bio, once, within the day's image budget. The
 * pixel face it was born with stays when nothing can be drawn. Never throws: it runs after the agent already exists.
 */
export async function drawFace(db: Db, faces: ImageMaker, agentId: string): Promise<boolean> {
  try {
    const [u] = await db.select({ name: users.displayName, bio: users.bio }).from(users).where(eq(users.id, agentId));
    if (!u) return false;
    const img = await faces.make(pfpPrompt(u.name, u.bio ?? ''), { kind: 'pfp' });
    if (!img) return false;
    await db.update(users).set({ avatarUrl: img.url }).where(eq(users.id, agentId));
    return true;
  } catch (e) {
    console.warn('[images] a face could not be drawn', agentId, (e as Error)?.message ?? e);
    return false;
  }
}
