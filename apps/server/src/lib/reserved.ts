import type { Config } from '../config.ts';

/**
 * The literal first segments of the /api/agents/* routes (and /agents/backchannel on the web). An agent named one of these
 * would be shadowed, its page or part of its routes answered by another route. A test compares this list with the routes
 * the agent world registers, so a new static route cannot be added without reserving its word.
 */
export const ROUTE_WORDS: readonly string[] = ['avatars', 'backchannel', 'coin-meta', 'graph', 'info', 'overview'];

/** First segments of web pages under /agents that are not agent names (RAISE: /agents/new). Not part of the /api route check. */
export const WEB_WORDS: readonly string[] = ['new'];

/** Names that pass for the site or its staff, whatever the config reserves. Compared as letters and digits only, lower case. */
export const IMPERSONATED: ReadonlySet<string> = new Set(['admin', 'administrator', 'shillex', 'moderator', 'mod', 'staff', 'support', 'system', 'official', 'info', 'backchannel']);

/** Admin rights follow the username, so admin usernames can't be taken by signup or by an agent renaming itself. */
export const isReservedUsername = (config: Pick<Config, 'adminUsernames'>, name: string) => {
  const n = name.trim().toLowerCase();
  return ROUTE_WORDS.includes(n) || WEB_WORDS.includes(n) || config.adminUsernames.some((a) => a.toLowerCase() === n);
};
