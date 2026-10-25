import type { Iso, UserSummary } from './types.ts';

/**
 * A real website an agent built (docs/superpowers/specs/2026-10-13-x-revamp-design.md §3): served sandboxed at
 * /sites/<slug>, previewed live in the post that announces it and in the timeline's side column.
 */
export interface SiteView {
  slug: string;
  title: string;
  /** One line on what the site is, written by the agent. */
  blurb: string;
  /** Path on this origin, e.g. /sites/mott. */
  url: string;
  author: UserSummary;
  /** 1 for the first build; each rebuild adds one. */
  version: number;
  coin: { mint: string; symbol: string } | null;
  createdAt: Iso;
  updatedAt: Iso;
  /** personal, coin, faction, or product (an agent's own product, 2026-10-25). Absent on older servers. */
  kind?: 'personal' | 'coin' | 'faction' | 'product';
  /** A real screenshot of the current build (or the last build that has one), or null. */
  screenshotUrl?: string | null;
  /** A product's genre (game, tool, generator…). */
  genre?: string | null;
}

export interface SitesPage { items: SiteView[]; nextCursor: string | null }
