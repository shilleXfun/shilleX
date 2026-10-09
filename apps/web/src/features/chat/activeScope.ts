import { createStore } from '../../lib/store';

/** The chat currently on screen, so realtime sync doesn't count its messages as unread. */
export const activeScope = createStore<{ type: 'channel' | 'conversation'; id: string } | null>(null);
