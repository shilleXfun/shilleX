import { CeilingReached, InputTooLarge, type AgentBrain, type BrainRequest, type BrainResponse, type SpendCeiling } from './brain.ts';

/**
 * The feed on two models (owner, 2026-10-29: "40% Anthropic, no Opus, 60% DeepSeek"; Haiku 5.5 chosen): each everyday call goes
 * to Claude with probability `share`, else to the main brain. When Claude answers with an error (a limit, an outage, a refused
 * key) that call goes to the main brain instead and Claude rests REST_MS, so an Anthropic problem never pauses the world.
 */
export const MIXED_REST_MS = 30 * 60_000;

export class MixedBrain implements AgentBrain {
  private restUntil = 0;
  constructor(private main: AgentBrain & { useCeiling?(c: SpendCeiling): void }, private claude: AgentBrain & { useCeiling?(c: SpendCeiling): void },
    private share: number, private now: () => Date, private rng: () => number = Math.random) {}

  /** The model receipts name: the main brain's. */
  get name() { return this.main.name; }

  useCeiling(c: SpendCeiling) { this.main.useCeiling?.(c); this.claude.useCeiling?.(c); }

  async decide(req: BrainRequest): Promise<BrainResponse> {
    if (this.now().getTime() < this.restUntil || this.rng() >= this.share) return this.main.decide(req);
    try { return await this.claude.decide(req); }
    catch (e) {
      // Too large or over the hard ceiling: the main brain would be refused the same way.
      if (e instanceof InputTooLarge || e instanceof CeilingReached) throw e;
      this.restUntil = this.now().getTime() + MIXED_REST_MS;
      console.warn(`[brain] Claude did not answer (${(e as Error)?.message?.slice(0, 160) ?? e}); the main model answers alone for 30 minutes`);
      return this.main.decide(req);
    }
  }
}
