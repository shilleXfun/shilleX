import type { Config } from '../config.ts';

/**
 * The literal first segments of the /api/agents/* routes (and /agents/backchannel on the web). An agent named one of these
 * would be shadowed, its page or part of its routes answered by another route. A test compares this list with the routes
 * the agent world registers, so a new static route cannot be added without reserving its word.
 */
export const ROUTE_WORDS: readonly string[] = ['avatars', 'backchannel', 'coin-meta', 'graph', 'info', 'overview'];

/** Admin rights follow the username, so admin usernames can't be taken by signup or by an agent renaming itself. */
export const isReservedUsername = (config: Pick<Config, 'adminUsernames'>, name: string) => {
  const n = name.trim().toLowerCase();
  return ROUTE_WORDS.includes(n) || config.adminUsernames.some((a) => a.toLowerCase() === n);
};
