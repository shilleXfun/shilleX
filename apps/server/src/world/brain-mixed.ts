import type Anthropic from '@anthropic-ai/sdk';
import { CeilingReached, InputTooLarge, type AgentBrain, type BrainRequest, type BrainResponse, type SpendCeiling } from './brain.ts';

/**
 * The feed on two models (owner, 2026-10-29: "40% Anthropic, no Opus, 60% DeepSeek"; Haiku 5.5 chosen): each everyday call goes
 * to Claude with probability `share`, else to the main brain. When Claude answers with an error (a limit, an outage, a refused
 * key) that call goes to the main brain instead and Claude rests REST_MS, so an Anthropic problem never pauses the world.
 * A conversation stays with the model that began it: a retry after a refused choice carries that model's own answer (with its
 * thinking), which the other model would refuse (2026-10-29: "Invalid `signature` in `thinking` block").
 */
export const MIXED_REST_MS = 30 * 60_000;

type Which = 'claude' | 'main';
/** An assistant turn's blocks without its thinking, for a model that did not write them. */
const withoutThinking = (req: BrainRequest): BrainRequest => ({
  ...req,
  messages: req.messages.map((m) => (m.role === 'assistant' && Array.isArray(m.content)
    ? { ...m, content: (m.content as Anthropic.ContentBlockParam[]).filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking') } : m)),
});

export class MixedBrain implements AgentBrain {
  private restUntil = 0;
  /** Which model wrote an answer's content (the array the caller sends back as an assistant turn). */
  private wrote = new WeakMap<object, Which>();
  constructor(private main: AgentBrain & { useCeiling?(c: SpendCeiling): void }, private claude: AgentBrain & { useCeiling?(c: SpendCeiling): void },
    private share: number, private now: () => Date, private rng: () => number = Math.random) {}

  /** The model receipts name: the main brain's. */
  get name() { return this.main.name; }

  useCeiling(c: SpendCeiling) { this.main.useCeiling?.(c); this.claude.useCeiling?.(c); }

  private async ask(which: Which, req: BrainRequest): Promise<BrainResponse> {
    const res = await (which === 'claude' ? this.claude : this.main).decide(req);
    this.wrote.set(res.content, which);
    return res;
  }

  async decide(req: BrainRequest): Promise<BrainResponse> {
    const prior = [...req.messages].reverse().find((m) => m.role === 'assistant');
    const pinned = prior && Array.isArray(prior.content) ? this.wrote.get(prior.content) : undefined;
    const resting = this.now().getTime() < this.restUntil;
    const which: Which = pinned ?? (resting || this.rng() >= this.share ? 'main' : 'claude');
    if (which === 'main') return this.ask('main', pinned === 'main' ? req : withoutThinking(req));
    if (resting) return this.ask('main', withoutThinking(req));
    try { return await this.ask('claude', pinned === 'claude' ? req : withoutThinking(req)); }
    catch (e) {
      // Too large or over the hard ceiling: the main brain would be refused the same way.
      if (e instanceof InputTooLarge || e instanceof CeilingReached) throw e;
      this.restUntil = this.now().getTime() + MIXED_REST_MS;
      console.warn(`[brain] Claude did not answer (${(e as Error)?.message?.slice(0, 160) ?? e}); the main model answers alone for 30 minutes`);
      return this.ask('main', withoutThinking(req));
    }
  }
}
