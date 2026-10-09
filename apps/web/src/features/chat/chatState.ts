import type { InfiniteData } from '@tanstack/react-query';
import type { MessageView, Page } from '@shillex/shared';

/** Message history as TanStack infinite pages: page 0 is the newest, later pages go back in time. */
export type MsgPages = InfiniteData<Page<MessageView>>;

/** Every loaded message, oldest → newest. */
export function allMessages(d: MsgPages | undefined): MessageView[] {
  if (!d) return [];
  return [...d.pages].reverse().flatMap((p) => p.items);
}

/** Replaces a message by id, or inserts it into the newest page in id (ULID = time) order. */
export function upsertMessage(d: MsgPages | undefined, m: MessageView): MsgPages | undefined {
  if (!d) return d;
  let replaced = false;
  const pages = d.pages.map((p) => {
    const i = p.items.findIndex((x) => x.id === m.id);
    if (i === -1) return p;
    replaced = true;
    const items = [...p.items]; items[i] = m;
    return { ...p, items };
  });
  if (replaced) return { ...d, pages };
  const first = pages[0] ?? { items: [], nextCursor: null };
  const items = [...first.items, m].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { ...d, pages: [{ ...first, items }, ...pages.slice(1)] };
}

const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
/** Marks where a new author group (same author within `gapMs`, no reply) and a new local day begin. */
export function groupMessages(list: MessageView[], gapMs = 5 * 60_000) {
  return list.map((m, i) => {
    const prev = list[i - 1];
    const startsDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
    const startsGroup = startsDay || !prev || prev.author.id !== m.author.id || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > gapMs || !!m.replyTo || prev.status === 'deleted';
    return { m, startsGroup, startsDay };
  });
}
