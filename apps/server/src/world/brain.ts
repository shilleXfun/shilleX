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
  /** A Claude model to use instead of the tier's (raised agents think on RAISED_MODEL); provider brains keep their own. */
  model?: string;
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

/** The hard ceiling refused the request: nothing was sent (`status` 0, so billedCall releases its reservation). */
export class CeilingReached extends Error { readonly category = 'budget'; readonly status = 0 }

/** No request carries more than this many input tokens (2026-10-27 cost audit); a larger one is refused before it is sent. */
export const MAX_INPUT_TOKENS = 20_000;
/** The request was larger than MAX_INPUT_TOKENS: nothing was sent. */
export class InputTooLarge extends Error { readonly category = 'budget'; readonly status = 0 }
/**
 * A request's input tokens, counted generously: 3.5 characters per token over the system, the messages and the tool schemas (HTML
 * and JSON run denser than prose), and 1,600 tokens per image (a screenshot at Claude's largest size).
 */
export function inputTokens(req: Pick<BrainRequest, 'system' | 'messages' | 'tools'>): number {
  let chars = req.system.reduce((n, b) => n + b.text.length, 0) + JSON.stringify(req.tools).length, images = 0;
  for (const m of req.messages) {
    if (typeof m.content === 'string') { chars += m.content.length; continue; }
    for (const b of m.content) { if (b.type === 'image') images++; else chars += JSON.stringify(b).length; }
  }
  return Math.ceil(chars / 3.5) + images * 1600;
}

/**
 * The last line under every cap (2026-10-27): what Claude actually billed in the last 24 hours (the owner's "$50/day"), every answer counted, retries
 * included, seeded from the receipts at boot. Past `limitUsd` no request is sent, whatever a budget, a config or a retry loop
 * says, so a bug elsewhere cannot drain the account.
 */
export const CEILING_WINDOW_MS = 24 * 3_600_000;
export class SpendCeiling {
  private log: { at: number; usd: number }[] = [];
  constructor(readonly limitUsd: number, private now: () => Date = () => new Date()) {}
  /** What was spent in the window before this process started, as one entry. */
  seed(usd: number) { if (usd > 0) this.log.push({ at: this.now().getTime(), usd }); }
  spent(): number { const t = this.now().getTime(); this.log = this.log.filter((x) => t - x.at < CEILING_WINDOW_MS); return this.log.reduce((n, x) => n + x.usd, 0); }
  allows(): boolean { return this.spent() < this.limitUsd; }
  record(usd: number) { if (usd > 0) this.log.push({ at: this.now().getTime(), usd }); }
}

/** One retry, only for an answer that was not billed and may pass: a 429 or a server error (5xx, 529). Never another 4xx, never a dropped connection. */
const retryable = (e: unknown) => e instanceof Anthropic.APIError && typeof e.status === 'number' && (e.status === 429 || e.status >= 500);
const retryWaitMs = (e: unknown) => {
  const s = Number((e as { headers?: { get?(k: string): string | null } }).headers?.get?.('retry-after'));
  return Math.min(20_000, Math.max(1000, Number.isFinite(s) && s > 0 ? s * 1000 : 2000));
};

export class ClaudeBrain implements AgentBrain {
  private client: Anthropic;
  private ceiling: SpendCeiling | null = null;
  /** `strong`: the model tier-2 requests (websites, threads, long takes, scenes) go to; the everyday model when unset. */
  constructor(apiKey: string, private model = MODEL, client?: Anthropic, private strong?: string, private sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))) { this.client = client ?? anthropicClient(apiKey, 1); }
  useCeiling(c: SpendCeiling) { this.ceiling = c; }

  async decide(req: BrainRequest): Promise<BrainResponse> {
    const check = () => { if (this.ceiling && !this.ceiling.allows()) throw new CeilingReached(`the hard ceiling of $${this.ceiling.limitUsd} per day is reached; no model call goes out`); };
    check();
    const tokens = inputTokens(req);
    if (tokens > MAX_INPUT_TOKENS) throw new InputTooLarge(`the request carries about ${tokens} input tokens, over the ${MAX_INPUT_TOKENS} cap`);
    let res: BrainResponse;
    try { res = await this.send(req); }
    catch (e) {
      if (!retryable(e)) throw e;
      await this.sleep(retryWaitMs(e));
      check();
      res = await this.send(req);
    }
    this.ceiling?.record(priceOf(res.model, res.usage));
    return res;
  }

  private async send(req: BrainRequest): Promise<BrainResponse> {
    const model = req.model?.startsWith('claude-') ? req.model : req.tier === 2 && this.strong ? this.strong : this.model;
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
/** The fake brain answers as the everyday model, so a test's prices are Haiku's, as in production. */
const FAKE_MODEL = 'claude-haiku-5-5';
const usage = { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 };
export const fakeReply = {
  tools: (...uses: { name: string; input: unknown }[]): BrainResponse => ({
    content: uses.map((u) => ({ type: 'tool_use', id: `toolu_fake_${++fakeIds}`, name: u.name, input: u.input }) as unknown as Anthropic.ContentBlock),
    stopReason: 'tool_use', usage, model: FAKE_MODEL,
  }),
  end: (text = '', thinking = ''): BrainResponse => ({
    content: [
      ...(thinking ? [{ type: 'thinking', thinking, signature: 'fake' } as unknown as Anthropic.ContentBlock] : []),
      { type: 'text', text, citations: null } as unknown as Anthropic.ContentBlock,
    ],
    stopReason: 'end_turn', usage, model: FAKE_MODEL,
  }),
  refusal: (): BrainResponse => ({ content: [], stopReason: 'refusal', usage: { ...usage, output: 0 }, model: FAKE_MODEL }),
};
