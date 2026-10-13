import type { Db } from '../db/client.ts';
import { xSources } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import type { XApi } from './api.ts';
import type { XConfig } from './config.ts';
import { bookX, canSpendX } from './spend.ts';

export const MAX_ACCOUNTS = 15, MAX_QUERIES = 3;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
export type XSourceRow = typeof xSources.$inferSelect;

/** A refused source; `code` is what the admin route answers with. */
export class SourceError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = 'SourceError'; } }

/** Adds an account (looked up on X once, $0.01) or a search query, within the spec's limits (x-feed §2). */
export async function addSource(d: { db: Db; api: XApi; config: XConfig; now: Date }, kind: 'account' | 'query', raw: string): Promise<XSourceRow> {
  let value = kind === 'account' ? raw.trim().replace(/^@/, '') : raw.trim().replace(/\s+/g, ' ');
  if (kind === 'account' && !HANDLE.test(value)) throw new SourceError('BAD_HANDLE', 'An X handle is 1 to 15 letters, digits or underscores');
  if (kind === 'query' && (value.length < 2 || value.length > 200)) throw new SourceError('BAD_QUERY', 'A search is 2 to 200 characters');
  const existing = await d.db.select({ kind: xSources.kind, value: xSources.value }).from(xSources);
  if (existing.some((s) => s.kind === kind && s.value.toLowerCase() === value.toLowerCase())) throw new SourceError('SOURCE_EXISTS', 'That source is already on the list');
  if (existing.filter((s) => s.kind === kind).length >= (kind === 'account' ? MAX_ACCOUNTS : MAX_QUERIES)) {
    throw new SourceError('TOO_MANY_SOURCES', kind === 'account' ? `Up to ${MAX_ACCOUNTS} accounts` : `Up to ${MAX_QUERIES} searches`);
  }
  let xUserId: string | null = null;
  if (kind === 'account') {
    if (!d.api.readsConfigured) throw new SourceError('X_NOT_CONFIGURED', 'Set X_BEARER_TOKEN first: an account is looked up on X when it is added');
    if (!(await canSpendX(d.db, d.now, d.config, d.config.prices.userRead))) throw new SourceError('X_BUDGET', 'Today’s X budget is spent; try again tomorrow');
    const u = await d.api.userByHandle(value);
    if (!u) throw new SourceError('NO_SUCH_ACCOUNT', `X has no account @${value}`);
    await bookX(d.db, d.now, { userReads: 1, usd: d.config.prices.userRead });
    xUserId = u.id;
    value = u.username;
  }
  const row: XSourceRow = { id: newId(), kind, value, xUserId, enabled: true, sinceId: null, lastPolledAt: null, backoffUntil: null, createdAt: d.now };
  await d.db.insert(xSources).values(row);
  return row;
}
