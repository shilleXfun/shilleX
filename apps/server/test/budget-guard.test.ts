import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { CeilingReached, ClaudeBrain, SpendCeiling, type BrainRequest } from '../src/world/brain.ts';
import { Budget, periodAt } from '../src/world/budget.ts';
import { BudgetClosed, billedCall } from '../src/agents/haiku.ts';

const req: BrainRequest = { system: [], tools: [], messages: [{ role: 'user', content: 'hi' }], effort: 'low' };
const ok = { content: [], stop_reason: 'end_turn', model: 'claude-haiku-5-5', usage: { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
const apiError = (status: number) => Anthropic.APIError.generate(status, { error: { message: 'x' } }, 'x', new Headers());
/** A Claude client whose answers come from `script`, one per call. */
const brainWith = (script: (() => unknown)[]) => {
  let i = 0;
  const client = { messages: { create: async () => { const s = script[i++]!; return s(); } } } as unknown as Anthropic;
  return { brain: new ClaudeBrain('k', 'claude-haiku-5-5', client, undefined, async () => {}), calls: () => i };
};

describe('retries', () => {
  it('retries a 429 or a 529 once, and never a 400 or a dropped connection', async () => {
    let b = brainWith([() => { throw apiError(429); }, () => ok]);
    await expect(b.brain.decide(req)).resolves.toBeTruthy();
    expect(b.calls()).toBe(2);
    b = brainWith([() => { throw apiError(529); }, () => { throw apiError(529); }, () => ok]);
    await expect(b.brain.decide(req)).rejects.toMatchObject({ status: 529 });
    expect(b.calls()).toBe(2);
    b = brainWith([() => { throw apiError(400); }, () => ok]);
    await expect(b.brain.decide(req)).rejects.toMatchObject({ status: 400 });
    expect(b.calls()).toBe(1);
    b = brainWith([() => { throw new Anthropic.APIConnectionError({ message: 'reset' }); }, () => ok]);
    await expect(b.brain.decide(req)).rejects.toBeInstanceOf(Anthropic.APIConnectionError);
    expect(b.calls()).toBe(1);
  });
});

describe('the hard ceiling', () => {
  it('counts what Claude billed and sends nothing once it is reached, until a day passes', async () => {
    let t = Date.parse('2026-10-27T12:00:00Z');
    const ceiling = new SpendCeiling(0.15, () => new Date(t));
    ceiling.seed(0.05);
    const b = brainWith([() => ok, () => ok]);
    b.brain.useCeiling(ceiling);
    await b.brain.decide(req); // a million Haiku input tokens: $0.10
    await expect(b.brain.decide(req)).rejects.toBeInstanceOf(CeilingReached);
    expect(b.calls()).toBe(1);
    t += 24 * 3_600_000;
    await expect(b.brain.decide(req)).resolves.toBeTruthy();
  });
});

describe('12-hour periods and the reserve', () => {
  it('splits the UTC day at noon', () => {
    expect(periodAt(4, null, new Date('2026-10-27T11:59:00Z'), 12)).toMatchObject({ start: new Date('2026-10-27T00:00:00Z'), end: new Date('2026-10-27T12:00:00Z'), usd: 4 });
    expect(periodAt(4, null, new Date('2026-10-27T12:00:00Z'), 12).start).toEqual(new Date('2026-10-27T12:00:00Z'));
    expect(periodAt(4, null, new Date('2026-10-27T13:00:00Z')).key).toBe('d:2026-10-27');
  });

  it('past 75% of the cap only the most-followed agents get a call, and nothing is booked for the rest', async () => {
    const t = new Date('2026-10-27T23:00:00Z');
    const b = new Budget(null as never, 4, () => t, { hardStop: true, periodHours: 12 });
    b.useTop(async (ids) => ids.includes('star'));
    b.add(3.1);
    expect(b.mode()).toBe('reserve');
    const spent = { usd: 0 };
    const db = {} as never;
    await expect(billedCall({ db, budget: b, worstUsd: 0.01, spent, worldCallId: 'w', agentIds: ['nobody'] }, async () => { throw new Error('sent'); })).rejects.toBeInstanceOf(BudgetClosed);
    await expect(billedCall({ db, budget: b, worstUsd: 0.01, spent, worldCallId: 'w' }, async () => { throw new Error('sent'); })).rejects.toBeInstanceOf(BudgetClosed);
    expect(spent.usd).toBe(0);
    expect(await b.admits(async () => ['star', 'nobody'])).toBe(true);
  });
});
