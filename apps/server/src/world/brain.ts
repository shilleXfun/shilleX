import Anthropic from '@anthropic-ai/sdk';
import type { TurnUsage } from '@shillex/shared';

export const MODEL = 'claude-opus-5-5';
export type Effort = 'low' | 'medium' | 'high';
export interface BrainRequest { system: Anthropic.TextBlockParam[]; tools: Anthropic.Tool[]; messages: Anthropic.MessageParam[]; effort: Effort }
export interface BrainResponse { content: Anthropic.ContentBlock[]; stopReason: string | null; usage: TurnUsage; model: string }
export interface AgentBrain { decide(req: BrainRequest): Promise<BrainResponse> }

/** USD per million tokens. Cache writes are 1.25× input (5-minute TTL). */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};
export function priceOf(model: string, u: TurnUsage): number {
  const p = PRICES[model] ?? PRICES[MODEL]!;
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1_000_000;
}

export class ClaudeBrain implements AgentBrain {
  private client: Anthropic;
  constructor(apiKey: string, private model = MODEL) { this.client = new Anthropic({ apiKey, maxRetries: 1 }); }

  async decide(req: BrainRequest): Promise<BrainResponse> {
    // Beta endpoint for the server-side refusal fallback; thinking can't be disabled on this model, effort controls depth.
    const params = {
      model: this.model, max_tokens: 16000, system: req.system, tools: req.tools, messages: req.messages,
      tool_choice: { type: 'auto' }, thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: req.effort },
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    };
    const r = await this.client.beta.messages.create(params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);
    return {
      content: r.content as unknown as Anthropic.ContentBlock[], stopReason: r.stop_reason, model: r.model,
      usage: { input: r.usage.input_tokens, output: r.usage.output_tokens, cacheRead: r.usage.cache_read_input_tokens ?? 0, cacheWrite: r.usage.cache_creation_input_tokens ?? 0 },
    };
  }
}

export class FakeBrain implements AgentBrain {
  calls: BrainRequest[] = [];
  constructor(private script: (req: BrainRequest, call: number) => BrainResponse | Promise<BrainResponse>) {}
  async decide(req: BrainRequest) { this.calls.push(structuredClone(req)); return this.script(req, this.calls.length - 1); }
}

let fakeIds = 0;
const usage = { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 };
export const fakeReply = {
  tools: (...uses: { name: string; input: unknown }[]): BrainResponse => ({
    content: uses.map((u) => ({ type: 'tool_use', id: `toolu_fake_${++fakeIds}`, name: u.name, input: u.input }) as unknown as Anthropic.ContentBlock),
    stopReason: 'tool_use', usage, model: MODEL,
  }),
  end: (text = '', thinking = ''): BrainResponse => ({
    content: [
      ...(thinking ? [{ type: 'thinking', thinking, signature: 'fake' } as unknown as Anthropic.ContentBlock] : []),
      { type: 'text', text, citations: null } as unknown as Anthropic.ContentBlock,
    ],
    stopReason: 'end_turn', usage, model: MODEL,
  }),
  refusal: (): BrainResponse => ({ content: [], stopReason: 'refusal', usage: { ...usage, output: 0 }, model: MODEL }),
};
