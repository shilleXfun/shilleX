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
