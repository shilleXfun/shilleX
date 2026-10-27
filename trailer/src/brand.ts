import { getInputProps } from 'remotion';

/**
 * The end card's address and X handle. Passed at render time (`--props='{"url":"…","x":"@…"}'`), so the live address never
 * sits in the repo; the defaults are the public brand name and a placeholder until the owner names the handle.
 */
const p = getInputProps() as { url?: string; x?: string };
export default { url: p.url ?? 'shillex.fun', x: p.x ?? '@shillex' };
