import { createHash } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentBrain, BrainRequest, BrainResponse } from './brain.ts';

/**
 * Cheap, swappable model providers (2026-10-25 upgrade, Phase B; the owner wants no Claude key now). Any provider that speaks the
 * OpenAI chat-completions API works: Groq first, Gemini's OpenAI endpoint as the fallback, others by configuration. The rest of
 * the code keeps talking to AgentBrain in the shape it always used (system blocks, tool_use and tool_result blocks, a JSON schema
 * for the output); this file translates both ways, so no caller changed. Calls go out with fetch (no SDK), one attempt per
 * provider and no retries inside: billedCall books each call once, and a provider that answers with an error status has not
 * billed it, so trying the next provider is safe. Anything else (a timeout, a dropped connection) is not retried here.
 */

export type ProviderErrorCategory = 'auth' | 'model' | 'credit' | 'rate_limit' | 'bad_request' | 'bad_output' | 'transient';

export interface ProviderConfig {
  /** A short name: groq, gemini, openrouter, or any other configured one. */
  name: string;
  baseUrl: string;
  apiKey: string;
  /** Tier 1: everyday writing. */
  model: string;
  /** Tier 2: big moments, theses, product briefs; the tier-1 model when unset. */
  modelStrong: string;
  /** USD per million tokens. Null means unknown: the provider is not used, so an unknown price can never break the cap. */
  priceInPerM: number | null;
  priceOutPerM: number | null;
  /** Free-tier limits this side keeps to; null means no limit is enforced here (the provider's 429 still is). */
  dailyRequests: number | null;
  rpm: number | null;
  tpm: number | null;
  /** The provider honours response_format json_schema; otherwise json_object plus the schema in the prompt. */
  jsonSchema: boolean;
  /** The provider supports tool calls. */
  tools: boolean;
  /** Send reasoning_effort (gpt-oss and other reasoning models). */
  reasoningEffort: boolean;
  timeoutMs: number;
}

/** An answer the provider gave (status set) or a call that never got one (status undefined), with what a retry can do. */
export class ProviderError extends Error {
  constructor(message: string, readonly category: ProviderErrorCategory, readonly status?: number, readonly provider?: string, readonly retryAfterMs?: number) { super(message); }
}

type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string };

const textOf = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b?.type === 'text' ? b.text : '')).join('') : '');

/** Anthropic-shaped messages → chat-completions messages: tool_use becomes tool_calls, each tool_result its own tool message. */
export function toChatMessages(req: BrainRequest, extraSystem = ''): ChatMessage[] {
  const out: ChatMessage[] = [];
  const system = req.system.map((b) => b.text).join('\n\n') + extraSystem;
  if (system) out.push({ role: 'system', content: system });
  for (const m of req.messages) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content } as ChatMessage); continue; }
    if (m.role === 'assistant') {
      const calls = m.content.filter((b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use')
        .map((b) => ({ id: b.id, type: 'function' as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      const text = m.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    const text = m.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    for (const b of m.content) {
      if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: textOf(b.content) || (b.is_error ? '{"error":"failed"}' : 'null') });
    }
    if (text) out.push({ role: 'user', content: text });
  }
  return out;
}

const STOP: Record<string, string> = { stop: 'end_turn', tool_calls: 'tool_use', function_call: 'tool_use', length: 'max_tokens', content_filter: 'refusal' };

interface ChatResponse {
  model?: string;
  choices?: { finish_reason?: string; message?: { content?: string | null; reasoning?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

/** A chat-completions answer → the Anthropic-shaped response every caller reads (text, tool_use, thinking blocks). */
export function fromChatResponse(r: ChatResponse, fallbackModel: string): BrainResponse {
  const choice = r.choices?.[0];
  const msg = choice?.message ?? {};
  const content: Anthropic.ContentBlock[] = [];
  if (msg.reasoning) content.push({ type: 'thinking', thinking: msg.reasoning, signature: '' } as unknown as Anthropic.ContentBlock);
  if (msg.content) content.push({ type: 'text', text: msg.content, citations: null } as unknown as Anthropic.ContentBlock);
  for (const t of msg.tool_calls ?? []) {
    let input: unknown = {};
    try { input = JSON.parse(t.function.arguments || '{}'); } catch { throw new ProviderError(`tool ${t.function.name} came back with arguments that are not JSON`, 'bad_output'); }
    content.push({ type: 'tool_use', id: t.id, name: t.function.name, input } as unknown as Anthropic.ContentBlock);
  }
  const cached = r.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    content, model: fallbackModel,
    stopReason: STOP[choice?.finish_reason ?? ''] ?? (msg.tool_calls?.length ? 'tool_use' : 'end_turn'),
    usage: { input: Math.max(0, (r.usage?.prompt_tokens ?? 0) - cached), output: r.usage?.completion_tokens ?? 0, cacheRead: cached, cacheWrite: 0 },
  };
}

/** An error answer → its category. 429 and quota answers back off; auth, a missing model and bad requests need a human. */
export function categorize(status: number, body: string): ProviderErrorCategory {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402 || /insufficient[_ ](credit|funds|balance)|credit balance|billing/i.test(body)) return 'credit';
  if (status === 429 || /resource[_ ]exhausted|rate.?limit|quota/i.test(body)) return 'rate_limit';
  if (/json_validate_failed|failed to generate json|tool_use_failed|output_parse_failed/i.test(body)) return 'bad_output';
  if (status === 404 || /model.{0,40}(not found|does not exist|decommissioned|not supported)/i.test(body)) return 'model';
  if (status >= 500) return 'transient';
  return 'bad_request';
}

const retryAfter = (h: Headers): number | undefined => {
  const s = Number(h.get('retry-after'));
  return Number.isFinite(s) && s > 0 ? s * 1000 : undefined;
};

/** The request body for one provider, with the capability fallbacks: json_object when json_schema is not offered. */
export function chatBody(p: ProviderConfig, model: string, req: BrainRequest) {
  const schema = req.outputFormat?.schema;
  const extra = schema && !p.jsonSchema ? `\n\nAnswer with one JSON object, and nothing else, that matches this JSON schema:\n${JSON.stringify(schema)}` : '';
  return {
    model,
    messages: toChatMessages(req, extra),
    max_tokens: req.maxTokens ?? 4000,
    ...(req.tools.length && p.tools ? {
      tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.input_schema } })),
      tool_choice: 'auto',
    } : {}),
    ...(schema ? { response_format: p.jsonSchema ? { type: 'json_schema', json_schema: { name: 'answer', schema, strict: false } } : { type: 'json_object' } } : {}),
    ...(p.reasoningEffort ? { reasoning_effort: req.effort === 'high' ? 'medium' : 'low' } : {}),
  };
}

/** One call to one provider. Throws ProviderError; never retries. */
export async function callProvider(p: ProviderConfig, model: string, req: BrainRequest, fetchImpl: typeof fetch = fetch): Promise<BrainResponse> {
  const ctl = new AbortController();
  const wait = Math.max(p.timeoutMs, req.timeoutMs ?? 0);
  const timer = setTimeout(() => ctl.abort(), wait);
  let res: Response;
  try {
    res = await fetchImpl(`${p.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify(chatBody(p, model, req)),
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = (e as Error)?.name === 'AbortError';
    throw new ProviderError(aborted ? `${p.name} did not answer within ${wait} ms` : `${p.name} could not be reached: ${(e as Error)?.message}`, 'transient', undefined, p.name);
  }
  const text = await res.text().finally(() => clearTimeout(timer));
  if (!res.ok) {
    const category = categorize(res.status, text);
    const detail = (/"message"\s*:\s*"([^"]{1,300})"/.exec(text)?.[1] ?? text.slice(0, 300)).replace(/\s+/g, ' ');
    throw new ProviderError(`${p.name} ${res.status} ${category}: ${detail}`, category, res.status, p.name, retryAfter(res.headers));
  }
  let body: ChatResponse;
  try { body = JSON.parse(text) as ChatResponse; } catch { throw new ProviderError(`${p.name} answered with something that is not JSON`, 'bad_output', 200, p.name); }
  const out = fromChatResponse(body, model);
  // A JSON answer must parse: a caller that asked for a schema reads the text as JSON.
  if (req.outputFormat) {
    const t = out.content.find((b) => b.type === 'text') as { text?: string } | undefined;
    const json = (t?.text ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    try { JSON.parse(json); } catch { throw new ProviderError(`${p.name} returned an answer that is not the JSON asked for`, 'bad_output', 200, p.name); }
    if (t && json !== t.text) t.text = json;
  }
  return out;
}

interface ProviderState { calls: number; ok: number; failed: number; day: string; today: number; minute: number[]; tokens: { at: number; n: number }[]; coolUntil: number; modelCool: Record<string, number>; lastError: string | null; lastOkAt: number | null }
export interface ProviderStatus { name: string; model: string; modelStrong: string; usable: boolean; why: string | null; calls: number; ok: number; failed: number; today: number; dailyRequests: number | null; coolingUntil: string | null; lastError: string | null; lastOkAt: string | null }

/** How long a provider sits out after an answer of each kind (a 429 uses its retry-after when it gives one). */
const COOL_MS: Partial<Record<ProviderErrorCategory, number>> = { auth: 3_600_000, model: 3_600_000, credit: 3_600_000, rate_limit: 60_000, transient: 30_000 };
const CACHE_TTL_MS = 10 * 60_000, CACHE_MAX = 200;
/** Requests this tier asks for: 1 everyday, 2 the big ones. */
export type Tier = 1 | 2;

/**
 * The brain the world uses when providers are configured: per call, the first provider that has a known price, is not cooling
 * down after an error and is under its own limits gets it; if it answers with an error status, the next one is tried (an error
 * answer was not billed). A timeout or a dropped connection is thrown at once (it may have been billed). Identical requests
 * within ten minutes are answered from memory (a retry after a failed post, an unchanged story), never across tiers or models.
 */
export class RoutedBrain implements AgentBrain {
  private states = new Map<string, ProviderState>();
  private cache = new Map<string, { at: number; res: BrainResponse }>();
  readonly name: string;
  constructor(readonly providers: ProviderConfig[], private now: () => Date = () => new Date(), private fetchImpl: typeof fetch = fetch) {
    for (const p of providers) this.states.set(p.name, { calls: 0, ok: 0, failed: 0, day: '', today: 0, minute: [], tokens: [], coolUntil: 0, modelCool: {}, lastError: null, lastOkAt: null });
    this.name = providers.find((p) => this.why(p) === null)?.model ?? providers[0]?.model ?? 'none';
  }

  /** Why a provider cannot take calls at all (not about cooling down), or null. */
  private why(p: ProviderConfig): string | null {
    if (p.priceInPerM === null || p.priceOutPerM === null) return `price unknown: set ${p.name.toUpperCase()}_PRICE_IN and ${p.name.toUpperCase()}_PRICE_OUT (0 for a free tier)`;
    if (!p.model) return `no model: set ${p.name.toUpperCase()}_MODEL`;
    return null;
  }

  private state(p: ProviderConfig): ProviderState {
    const s = this.states.get(p.name)!;
    const day = this.now().toISOString().slice(0, 10);
    if (s.day !== day) { s.day = day; s.today = 0; }
    const t = this.now().getTime();
    s.minute = s.minute.filter((x) => t - x < 60_000);
    s.tokens = s.tokens.filter((x) => t - x.at < 60_000);
    return s;
  }

  /** Under this provider's own limits for one more call of about `tokens` tokens to `model`. */
  private room(p: ProviderConfig, tokens: number, model: string): string | null {
    const s = this.state(p);
    if (s.coolUntil > this.now().getTime()) return 'cooling down';
    if ((s.modelCool[model] ?? 0) > this.now().getTime()) return `${model} cooling down`;
    if (p.dailyRequests !== null && s.today >= p.dailyRequests) return 'daily requests used';
    if (p.rpm !== null && s.minute.length >= p.rpm) return 'requests per minute used';
    if (p.tpm !== null && s.tokens.reduce((n, x) => n + x.n, 0) + tokens > p.tpm) return 'tokens per minute used';
    return null;
  }

  /** The model each provider uses for this request. */
  modelFor(p: ProviderConfig, tier: Tier): string { return tier === 2 ? p.modelStrong || p.model : p.model; }

  async decide(req: BrainRequest & { tier?: Tier }): Promise<BrainResponse> {
    const tier: Tier = req.tier ?? 1;
    const est = Math.ceil(JSON.stringify(req.messages).length / 4 + req.system.reduce((n, b) => n + b.text.length, 0) / 4) + (req.maxTokens ?? 4000);
    const usable = this.providers.filter((p) => this.why(p) === null && (!req.tools.length || p.tools))
      .sort((a, b) => Number(b.name === req.prefer) - Number(a.name === req.prefer));
    if (!usable.length) throw new ProviderError('No model provider is usable: check the LLM_* settings on /api/health/world', 'auth', 401);
    const key = req.tools.length ? null : createHash('sha256').update(JSON.stringify([tier, req.system, req.messages, req.outputFormat ?? null, req.maxTokens ?? null])).digest('hex');
    const t = this.now().getTime();
    for (const [k, v] of this.cache) if (t - v.at > CACHE_TTL_MS) this.cache.delete(k);
    const hit = key ? this.cache.get(key) : undefined;
    if (hit) return { ...hit.res, usage: { input: 0, output: 0, cacheRead: hit.res.usage.input, cacheWrite: 0 } };
    const errors: ProviderError[] = [];
    for (const p of usable) {
      const model = this.modelFor(p, tier);
      const full = this.room(p, est, model);
      if (full) { errors.push(new ProviderError(`${p.name}: ${full}`, 'rate_limit', 429, p.name)); continue; }
      const s = this.state(p);
      s.calls++; s.today++; s.minute.push(this.now().getTime()); s.tokens.push({ at: this.now().getTime(), n: est });
      try {
        const res = await callProvider(p, model, req, this.fetchImpl);
        s.ok++; s.lastOkAt = this.now().getTime();
        if (key) {
          this.cache.set(key, { at: this.now().getTime(), res });
          if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
        }
        return res;
      } catch (e) {
        const err = e instanceof ProviderError ? e : new ProviderError((e as Error)?.message ?? String(e), 'transient', undefined, p.name);
        s.failed++; s.lastError = err.message;
        const cool = err.retryAfterMs ?? COOL_MS[err.category];
        // A key or billing problem benches the whole provider; a limit, a missing model or a hiccup only that model (Groq and
        // Gemini limit each model on its own, so a spent strong model must not bench the everyday one).
        if (cool && (err.category === 'auth' || err.category === 'credit')) s.coolUntil = this.now().getTime() + cool;
        else if (cool) s.modelCool[model] = this.now().getTime() + cool;
        console.error(`[llm] ${err.message}`);
        // No answer means the call may have been billed: never sent again to someone else.
        if (err.status === undefined) throw err;
        errors.push(err);
      }
    }
    // Every provider said no. The most serious reason wins, so the moment queue's pause sees an auth problem as one.
    const order: ProviderErrorCategory[] = ['auth', 'credit', 'model', 'bad_request', 'rate_limit', 'bad_output', 'transient'];
    errors.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
    const worst = errors[0]!;
    throw new ProviderError(errors.map((x) => x.message).join('; '), worst.category, worst.status, worst.provider, worst.retryAfterMs);
  }

  status(): ProviderStatus[] {
    return this.providers.map((p) => {
      const s = this.state(p);
      const why = this.why(p);
      const t = this.now().getTime();
      // Cooling: the whole provider, or every model it has; the latest end of any cool-down is shown.
      const models = [...new Set([p.model, p.modelStrong || p.model])];
      const cooling = s.coolUntil > t || models.every((m) => (s.modelCool[m] ?? 0) > t);
      const until = Math.max(s.coolUntil, ...models.map((m) => s.modelCool[m] ?? 0));
      return {
        name: p.name, model: p.model, modelStrong: p.modelStrong || p.model, usable: why === null && !cooling, why, calls: s.calls, ok: s.ok, failed: s.failed,
        today: s.today, dailyRequests: p.dailyRequests, coolingUntil: until > t ? new Date(until).toISOString() : null, lastError: s.lastError,
        lastOkAt: s.lastOkAt ? new Date(s.lastOkAt).toISOString() : null,
      };
    });
  }
}
