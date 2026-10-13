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
}

export interface SitesPage { items: SiteView[]; nextCursor: string | null }
