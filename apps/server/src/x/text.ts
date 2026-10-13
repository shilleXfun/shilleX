/** A bare domain (pump.fun, t.me/x): X turns one into a link on its own, so it counts as a link. "0.5 sol" and "Shillex. Its" don't match. */
const BARE_DOMAIN = /[a-z0-9-]\.[a-z]{2,}/i;

/**
 * True when text is safe to reach X or a topic label: after NFKC (fullwidth ＠ ＃ ＄ ． become @ # $ .) it has no @, #, $ and no
 * bare domain. X reads those as mentions, hashtags, cashtags and links whatever the template around them says (x-feed §4, §6).
 */
export function xSafeText(s: string): boolean {
  const n = s.normalize('NFKC');
  return !/[@#$]/.test(n) && !BARE_DOMAIN.test(n);
}
