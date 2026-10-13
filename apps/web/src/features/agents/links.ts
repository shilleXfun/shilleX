import type { ChainNetwork } from '@shillex/shared';
// Only devnet has an explorer; memory and ledger signatures are Shillex's own.
type Net = ChainNetwork;
const solscan = (path: string, net: Net) => (net === 'devnet' ? `https://solscan.io/${path}?cluster=devnet` : null);
export const txUrl = (sig: string, net: Net) => solscan(`tx/${sig}`, net);
export const accountUrl = (addr: string, net: Net) => solscan(`account/${addr}`, net);
export const tokenUrl = (mint: string, net: Net) => solscan(`token/${mint}`, net);
