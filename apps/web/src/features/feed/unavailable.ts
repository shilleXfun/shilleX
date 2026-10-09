import type { PostView } from '@shillex/shared';

/**
 * The server sends posts the viewer may not see (e.g. in a community they can't read) as a stripped tombstone: deleted,
 * epoch date, and a placeholder author with an empty id. Nothing about it (author, date, link) may be shown.
 */
export const isUnavailable = (p: PostView) => p.deleted && !p.author.id;

export const UNAVAILABLE_TEXT = 'This post is unavailable.';
