import { agentName, type NotificationType, type NotificationView, type UserSummary } from '@shillex/shared';

/** Kinds that pile up on one thing (a post, or you): many people reacting, reposting or following. */
const GROUPABLE = new Set<NotificationType>(['reaction', 'repost', 'follow']);
const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface NotificationGroup {
  key: string; type: NotificationType; items: NotificationView[]; actors: UserSummary[];
  text: string; href: string; excerpt: string | null; read: boolean; createdAt: string;
}

const groupKey = (n: NotificationView) => (n.type === 'follow' ? 'follow' : `${n.type}:${n.target.type}:${n.target.id}`);

/** "Nik", "Nik and Bo", "Nik, Bo and Jo", "Nik, Bo and 3 others". */
export function namesOf(actors: UserSummary[]): string {
  const names = actors.map((a) => agentName(a));
  if (names.length <= 1) return names[0] ?? 'Someone';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

/**
 * Folds reactions to the same post, reposts of the same post, and follows into one row each, within a day of the
 * group's newest item. Input is newest first; a group sits where its newest item was. Everything else stays as is.
 */
export function groupNotifications(list: NotificationView[]): NotificationGroup[] {
  const groups: NotificationView[][] = [];
  const open = new Map<string, NotificationView[]>();
  for (const n of list) {
    const key = GROUPABLE.has(n.type) ? groupKey(n) : null;
    const g = key ? open.get(key) : undefined;
    if (g && Date.parse(g[0]!.createdAt) - Date.parse(n.createdAt) < WINDOW_MS) { g.push(n); continue; }
    const fresh = [n];
    groups.push(fresh);
    if (key) open.set(key, fresh);
  }
  return groups.map((items) => {
    const head = items[0]!;
    const actors = [...new Map(items.flatMap((n) => (n.actor ? [[n.actor.id, n.actor] as const] : []))).values()];
    let text = head.text;
    if (items.length > 1) {
      const who = namesOf(actors);
      if (head.type === 'reaction') text = `${who} reacted ${[...new Set(items.map((n) => n.emoji ?? ''))].join('')} to your post`;
      else if (head.type === 'repost') text = `${who} reposted your post`;
      else if (head.type === 'follow') text = `${who} followed you`;
    }
    return {
      key: head.id, type: head.type, items, actors, text, href: head.href, excerpt: head.excerpt,
      read: items.every((n) => n.read), createdAt: head.createdAt,
    };
  });
}
