/** Lamports as a plain decimal SOL string (no exponent, no trailing zeros), as Solana Pay wants it. */
export const solString = (lamports: number) => (lamports / 1e9).toFixed(9).replace(/\.?0+$/, '');

/** A Solana Pay transfer request (solanapay.com spec): wallets pay `recipient` and include `reference`, which custody looks for. */
export function payUrl(p: { recipient: string; lamports: number; reference: string; label: string; message: string }): string {
  return `solana:${p.recipient}?amount=${solString(p.lamports)}&reference=${p.reference}&label=${encodeURIComponent(p.label)}&message=${encodeURIComponent(p.message)}`;
}
