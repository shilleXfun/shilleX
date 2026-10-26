import Anthropic from '@anthropic-ai/sdk';
import type { TurnUsage } from '@shillex/shared';
import { anthropicClient } from '../lib/anthropic.ts';

export const MODEL = 'claude-opus-5-5';
export type Effort = 'low' | 'medium' | 'high';
export interface BrainRequest {
  system: Anthropic.TextBlockParam[]; tools: Anthropic.Tool[]; messages: Anthropic.MessageParam[]; effort: Effort;
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> }; maxTokens?: number;
  /** 1 (default): everyday writing; 2: big moments, theses, product briefs — a provider brain uses its stronger model. */
  tier?: 1 | 2;
  /** A provider brain tries this provider first (LLM_BUILD_PROVIDER for site builds), then the usual order. */
  prefer?: string | null;
  /** A longer wait than the provider's default, for calls that write a lot (a whole page). */
  timeoutMs?: number;
}
export interface BrainResponse { content: Anthropic.ContentBlock[]; stopReason: string | null; usage: TurnUsage; model: string }
export interface AgentBrain {
  decide(req: BrainRequest): Promise<BrainResponse>;
  /** The model a receipt names (the provider brain's tier-1 model); Claude Haiku when absent. */
  readonly name?: string;
}

/** USD per million tokens. Cache writes are 1.25× input (5-minute TTL). */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};
const providerModels = new Set<string>();
/** Prices of the configured provider models (boot registers them; 0 for a free tier). */
export function registerPrice(model: string, inPerM: number, outPerM: number) {
  PRICES[model] = { input: inPerM, output: outPerM, cacheRead: inPerM / 10, cacheWrite: inPerM };
  providerModels.add(model);
}
/** A model one of the configured providers serves: a call it answered is priced as that model. */
export const isProviderModel = (model: string) => providerModels.has(model);
export const PRICE_OF_HAIKU = () => PRICES['claude-haiku-5-5']!;
/** A model's price per million tokens, or null when it is not known. */
export const knownPrice = (model: string) => PRICES[model] ?? null;
export function priceOf(model: string, u: TurnUsage): number {
  const p = PRICES[model] ?? PRICES[MODEL]!;
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1_000_000;
}

/** Models that take the server-side refusal fallback (`fallbacks: 'default'`); Haiku has none. */
const FALLBACK_MODELS = new Set([MODEL, 'claude-sonnet-5-5']);

export class ClaudeBrain implements AgentBrain {
  private client: Anthropic;
  /** `strong`: the model tier-2 requests (websites, threads, long takes, scenes) go to; the everyday model when unset. */
  constructor(apiKey: string, private model = MODEL, client?: Anthropic, private strong?: string) { this.client = client ?? anthropicClient(apiKey, 1); }

  async decide(req: BrainRequest): Promise<BrainResponse> {
    const model = req.tier === 2 && this.strong ? this.strong : this.model;
    // Thinking can't be disabled on current models; effort controls depth. Forced tool_choice is a 400, so always auto.
    const base = {
      model, max_tokens: req.maxTokens ?? 16000, system: req.system, messages: req.messages,
      ...(req.tools.length ? { tools: req.tools, tool_choice: { type: 'auto' } } : {}),
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: req.effort, ...(req.outputFormat ? { format: req.outputFormat } : {}) },
    };
    // Opus and Sonnet get the server-side refusal fallback (beta endpoint); Haiku has no fallback and uses the regular endpoint.
    // A long answer (a product page asks for 24k tokens) must stream: the SDK refuses a non-streaming call that may pass 10 minutes.
    const long = base.max_tokens > 16000;
    const withFallback = { ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming;
    const r = FALLBACK_MODELS.has(model)
      ? long ? await this.client.beta.messages.stream(withFallback).finalMessage() : await this.client.beta.messages.create(withFallback)
      : long
        ? await this.client.messages.stream(base as unknown as Anthropic.MessageCreateParamsNonStreaming).finalMessage()
        : await this.client.messages.create(base as unknown as Anthropic.MessageCreateParamsNonStreaming);
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
