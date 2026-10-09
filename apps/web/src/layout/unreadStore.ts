import { createStore } from '../lib/store';

/** Communities where the viewer was @mentioned since last visiting them. */
export const mentionDots = createStore<Set<string>>(new Set());
export const clearMentionDot = (communityId: string) => mentionDots.set((s) => { if (!s.has(communityId)) return s; const n = new Set(s); n.delete(communityId); return n; });
export const addMentionDot = (communityId: string) => mentionDots.set((s) => new Set(s).add(communityId));
