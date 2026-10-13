import { and, desc, eq, gt } from 'drizzle-orm';
import { RISK_POINTS, type MainnetNoticeView } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { mainnetConsents, mainnetExclusions } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { getSetting, setSetting } from '../world/launchpad.ts';
import { CustodyError } from './errors.ts';

export const NOTICE_KEY = 'mainnet_notice';
const DAY = 86_400_000;
export interface PublishedNotice { version: string; legalPosition: string; publishedAt: string }

/** The risk notice in force (its fixed points are RISK_POINTS); null until an admin publishes one with the legal position. */
export async function currentNotice(db: Db): Promise<PublishedNotice | null> {
  const raw = await getSetting(db, NOTICE_KEY);
  return raw ? (JSON.parse(raw) as PublishedNotice) : null;
}

/** A new version (n1, n2, …): everyone accepts it again before their next deposit. Called by the admin route (Task 12). */
export async function publishNotice(db: Db, legalPosition: string, now: Date): Promise<PublishedNotice> {
  const prev = await currentNotice(db);
  const next = { version: `n${prev ? Number(prev.version.slice(1)) + 1 : 1}`, legalPosition: legalPosition.trim(), publishedAt: now.toISOString() };
  await setSetting(db, NOTICE_KEY, JSON.stringify(next));
  return next;
}

export async function acceptNotice(db: Db, userId: string, version: string, adult: boolean, now: Date): Promise<void> {
  if (!adult) throw new CustodyError('ADULTS_ONLY', 'Real SOL is for people 18 or over');
  const n = await currentNotice(db);
  if (!n) throw new CustodyError('NO_NOTICE', 'There is no risk notice yet');
  if (version !== n.version) throw new CustodyError('NOTICE_OUTDATED', 'The risk notice changed; read the new one');
  await db.insert(mainnetConsents).values({ userId, noticeVersion: version, adult: true, acceptedAt: now })
    .onConflictDoUpdate({ target: mainnetConsents.userId, set: { noticeVersion: version, adult: true, acceptedAt: now } });
}

export async function exclusionUntil(db: Db, userId: string, now: Date): Promise<Date | null> {
  const [x] = await db.select({ until: mainnetExclusions.until }).from(mainnetExclusions)
    .where(and(eq(mainnetExclusions.userId, userId), gt(mainnetExclusions.until, now))).orderBy(desc(mainnetExclusions.until)).limit(1);
  return x?.until ?? null;
}

/** Locks the user's deposits for 7 or 30 days. A lock never gets shorter: the later end wins (spec §6). */
export async function excludeSelf(db: Db, userId: string, days: 7 | 30, now: Date): Promise<Date> {
  if (days !== 7 && days !== 30) throw new CustodyError('BAD_DAYS', 'Choose 7 or 30 days');
  const want = new Date(now.getTime() + days * DAY), have = await exclusionUntil(db, userId, now);
  if (have && have >= want) return have;
  await db.insert(mainnetExclusions).values({ id: newId(), userId, until: want, createdAt: now });
  return want;
}

export async function assertCanDeposit(db: Db, userId: string, now: Date): Promise<void> {
  const until = await exclusionUntil(db, userId, now);
  if (until) throw new CustodyError('EXCLUDED', `You locked deposits until ${until.toISOString()}`);
  const n = await currentNotice(db);
  const [c] = await db.select().from(mainnetConsents).where(eq(mainnetConsents.userId, userId));
  if (!n || !c || !c.adult || c.noticeVersion !== n.version) throw new CustodyError('NOTICE_REQUIRED', 'Read and accept the risk notice first');
}

export async function noticeView(db: Db, userId: string | null, now: Date): Promise<MainnetNoticeView> {
  const n = await currentNotice(db);
  const [c] = userId ? await db.select().from(mainnetConsents).where(eq(mainnetConsents.userId, userId)) : [];
  const until = userId ? await exclusionUntil(db, userId, now) : null;
  return { version: n?.version ?? null, points: RISK_POINTS, legalPosition: n?.legalPosition ?? null, accepted: Boolean(n && c?.adult && c.noticeVersion === n.version), excludedUntil: until?.toISOString() ?? null };
}
