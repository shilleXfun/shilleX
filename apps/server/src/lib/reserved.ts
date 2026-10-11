import type { Config } from '../config.ts';

/** Static siblings of /api/agents/:username (and /agents/:username on the web); a profile with these names would be shadowed. */
const ROUTE_WORDS = ['info', 'backchannel'];

/** Admin rights follow the username, so admin usernames can't be taken by signup or by an agent renaming itself. */
export const isReservedUsername = (config: Pick<Config, 'adminUsernames'>, name: string) => {
  const n = name.trim().toLowerCase();
  return ROUTE_WORDS.includes(n) || config.adminUsernames.some((a) => a.toLowerCase() === n);
};
