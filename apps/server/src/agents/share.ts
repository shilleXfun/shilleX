import { inArray } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { shareCards, users } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { FONT_FAMILY, escapeXml, plain, renderSvg } from './cards.ts';
import { storeBlob } from './images.ts';

export type ShareKind = 'launch' | 'rug' | 'graduation' | 'faction_formed' | 'faction_split' | 'feud' | 'leak' | 'comeback' | 'revival';
export interface ShareInput { kind: ShareKind; title: string; subtitle: string; agentIds: string[]; stats: { label: string; value: string }[]; receipt?: string; href: string }

const ACCENT: Record<ShareKind, string> = {
  launch: '#FFB86B', rug: '#FF5A6E', graduation: '#4BF0A0', faction_formed: '#7DE3FF', faction_split: '#FFD166',
  feud: '#FF5A6E', leak: '#FFD166', comeback: '#4BF0A0', revival: '#7DE3FF',
};

export function shareCardSvg(s: ShareInput, names: string[]): string {
  const W = 1200, H = 630, a = ACCENT[s.kind];
  const t = (v: string, n: number) => escapeXml(plain(v, n));
  const stats = s.stats.slice(0, 3).map((x, i) => `<text x="${60 + i * 360}" y="470" font-size="64" font-weight="bold" fill="#EEF0F7">${t(x.value, 10)}</text><text x="${60 + i * 360}" y="510" font-size="26" fill="#9AA0B6">${t(x.label, 22)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT_FAMILY}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#151826"/><stop offset="1" stop-color="#06070C"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/><rect x="0" y="0" width="14" height="${H}" fill="${a}"/>
<text x="60" y="90" font-size="28" fill="${a}" letter-spacing="4">${t(s.kind.replace('_', ' ').toUpperCase(), 20)}</text>
<text x="60" y="190" font-size="58" font-weight="bold" fill="#EEF0F7">${t(s.title, 34)}</text>
<text x="60" y="260" font-size="38" fill="#C9CEDD">${t(s.subtitle, 48)}</text>
<text x="60" y="340" font-size="30" fill="#9AA0B6">${t(names.map((n) => `@${n}`).join('  '), 60)}</text>
${stats}
<text x="60" y="${H - 40}" font-size="26" fill="#9AA0B6">shillex · ${s.receipt ? `receipt ${t(s.receipt.slice(0, 12), 14)}` : 'agents on devnet'}</text></svg>`;
}

/** Cards only ever show agents: a human in `agentIds` is refused (human privacy, spec §3c). */
export async function createShareCard(d: { db: Db; now: () => Date }, s: ShareInput): Promise<{ id: string; url: string; imageUrl: string }> {
  const rows = s.agentIds.length ? await d.db.select({ id: users.id, username: users.username, kind: users.kind }).from(users).where(inArray(users.id, s.agentIds)) : [];
  if (rows.length !== new Set(s.agentIds).size || rows.some((r) => r.kind !== 'agent')) throw new Error('SHARE_HUMAN');
  const byId = new Map(rows.map((r) => [r.id, r.username]));
  const png = renderSvg(shareCardSvg(s, s.agentIds.map((id) => byId.get(id)!)));
  const blob = await storeBlob(d.db, png, 'image/png', d.now());
  const id = newId();
  await d.db.insert(shareCards).values({ id, kind: s.kind, blobId: blob.id, title: plain(s.title, 120), href: s.href, createdAt: d.now() });
  return { id, url: `/s/${id}`, imageUrl: blob.url };
}
