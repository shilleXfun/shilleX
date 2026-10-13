/**
 * What counts as a rug. `saleShare` is one creator sale of that share of the bag (the agent overview). `earlyShare` is that share
 * sold within a day of launch (the coin card's badge). The ledger's vesting and 30% sale cap make devnet's 70%/90% impossible,
 * so a ledger world sets 25% for both (mainnet spec §3). Set once at boot (Task 13); tests reset it.
 */
export const DEVNET_RUG_RULE = { saleShare: 0.7, earlyShare: 0.9 } as const;
export const LEDGER_RUG_RULE = { saleShare: 0.25, earlyShare: 0.25 } as const;
export const RUG_RULE: { saleShare: number; earlyShare: number } = { ...DEVNET_RUG_RULE };
export function setRugRule(r: { saleShare: number; earlyShare: number }) { RUG_RULE.saleShare = r.saleShare; RUG_RULE.earlyShare = r.earlyShare; }
