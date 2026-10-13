/** SOL amounts from whole coins down to fractions of a lamport per token, never in exponent notation. */
export const fmtSol = (n: number | null) => {
  if (n === null) return '—';
  if (n === 0 || n >= 1) return n.toFixed(2);
  if (n >= 0.001) return n.toPrecision(3);
  return n.toFixed(Math.min(20, 2 - Math.floor(Math.log10(n))));
};
/** The same amounts for tight cells: below 0.001 in exponent form ("9.42e-10"); put fmtSol's full value in the title. */
export const fmtSolCompact = (n: number | null) => (n !== null && n > 0 && n < 0.001 ? n.toExponential(2) : fmtSol(n));
/** A change in percent with its sign ("+12.5%", "−3.0%"), with the true minus sign the rest of the app writes; what rounds to nothing is "+0.0%", never "−0.0%". */
export const fmtPct = (n: number) => { const r = Math.round(n * 10) / 10; return `${r < 0 ? '−' : '+'}${Math.abs(r).toFixed(1)}%`; };

/**
 * Agent money, one format on every page: two decimals, the true minus sign (U+2212), a plus on gains. What rounds to
 * nothing is "0.00", never "−0.00". `fmtSolDelta(-0.0717)` → "−0.07"; add " SOL" where the unit is not said around it.
 */
export const fmtSolDelta = (n: number) => { const r = Math.round(n * 100) / 100; return r === 0 ? '0.00' : `${r < 0 ? '−' : '+'}${Math.abs(r).toFixed(2)}`; };
/** An unsigned SOL amount on the same scale (balances, net worth): "0.11"; a positive amount under a cent of SOL is "<0.01". */
export const fmtSolAmount = (n: number) => (n > 0 && n < 0.005 ? '<0.01' : (Math.round(n * 100) / 100).toFixed(2));
/** Any number with the true minus sign instead of the hyphen. */
export const minus = (s: string) => s.replace(/^-/, '−');

const SUB = '₀₁₂₃₄₅₆₇₈₉';
/**
 * A tiny price the way traders read it: 0.0₈421 is 0.00000000421 (eight zeros after the point, then three digits).
 * Prices from 0.001 up keep three significant digits.
 */
export function fmtTiny(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return '—';
  if (n === 0) return '0';
  if (n >= 0.001) return Number(n.toPrecision(3)).toString();
  let zeros = Math.floor(-Math.log10(n));
  let digits = Math.round(n * 10 ** (zeros + 3));
  if (digits >= 1000) { zeros -= 1; digits = Math.round(digits / 10); }
  return `0.0${[...String(zeros)].map((d) => SUB[Number(d)]).join('')}${digits}`;
}
