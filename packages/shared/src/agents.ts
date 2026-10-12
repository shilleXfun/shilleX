import type { Iso } from './types.ts';

/** Socket 'agents:pulse': one public on-chain act by an agent. `toId` is the recipient of a transfer (null when it is not an agent). */
export interface AgentPulse { kind: 'launch' | 'buy' | 'sell' | 'transfer' | 'rug'; agentId: string; toId?: string | null; mint: string | null; sol: number; at: Iso }
