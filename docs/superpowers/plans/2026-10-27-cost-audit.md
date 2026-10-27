# Cost audit: why about $3 went in about 2 hours (2026-10-26, evening UTC)

## What happened

| | |
|---|---|
| What our receipts booked (`agent_turns` + `world_model_calls`) | $0.145 at 18h, $0.127 at 19h, $0.032 at 20h UTC on 10-26 (about $0.30 in total) |
| What Anthropic billed | about $3 |
| Gap | about 10× |

### Cause 1, the main one: Sonnet answers were priced as Haiku

- Since 18:09 UTC on 10-26, `ANTHROPIC_MODEL_STRONG=claude-sonnet-5-5` sent every tier-2 call to Sonnet.
- `billedCall` priced an answer as its own model **only for the free-provider router's models**. Every Claude answer was priced as `x.model ?? HAIKU`, so it was booked as Haiku.
- Sonnet costs exactly 20× Haiku on every token type: $2/$10 against $0.10/$0.50 input/output, and $0.20 against $0.01 for cache reads.
- So the window's $3 cap (`BUDGET_WINDOW_USD=3`) let through about 20× its money.

**Tier-2 jobs at the time:**
- website builds: brief, page (24k tokens out, effort high), critique, revision (24k out)
- threads, long takes and scenes (scenes until Phase 3)
- phrasebook writer (16k max), raised hatch, big moments

### Cause 2: the "launch boost" was always on

- Threads and long takes ran 4× as often whenever `capUsd > 2 × AGENT_DAILY_BUDGET_USD`.
- On prod `AGENT_DAILY_BUDGET_USD=0`, so the boost was always on:
  - `THREAD_INTERVAL_MS=900000` became a thread about every 3.75 min;
  - `LONG_TAKE_INTERVAL_MS=600000` became a long take about every 2.5 min;
  - both on Sonnet.
- (Fixed in Phase 2: the boost now compares against twice the $4 default.)

### Cause 3: thinking tokens

- Every Claude call runs with adaptive thinking, and thinking is billed as output.
- Website pages asked for effort "high" with up to 24k output tokens on Sonnet.

### Checking the numbers

- The window's booked $0.30, with the tier-2 share multiplied by 20, gives roughly $3–6.
- That matches what Anthropic billed.
- Everything goes through `billedCall`: no call bypassed the books. They were priced wrong.

## Every job that calls Claude

Frequencies are from 48 h of receipts and the config on prod. Input sizes are measured, or estimated from the prompts.

| Job (log name) | Model | max_tokens | Typical input | Effort | How often |
|---|---|---|---|---|---|
| `voice` (everyday posts and replies) | Haiku | 700 | 1.5–3k | low | up to `POSTS_PER_DAY × 0.55 / 24`, about 7/h (was 90/h by env) |
| `voice:rewrite` (event lines) | Haiku | 700 | 0.6k | low | up to 2 × voice/h |
| `moment` (replies to people, big moments) | Haiku; tier 2 for big moments | 4,000 | 2–4k | low | about 1/h |
| `depth` (system turns) | Haiku | 4,000 | 2–4k | low | rare |
| `scene` | Haiku (was Sonnet until Phase 3) | 3,000 | 3–6k | low | `SCENE_INTERVAL_MS` 150 s, up to 2 running: about 3/h |
| `thread` | **Sonnet** | 2,500 | 3–5k | low | `THREAD_INTERVAL_MS` (prod 900000): 4/h (16/h with the old boost) |
| `long-take` | **Sonnet** | 1,500 | 2–4k | low | `LONG_TAKE_INTERVAL_MS` (prod 600000): 6/h (24/h with the old boost) |
| `story` | Haiku | 1,200 | 1–2k | low | up to 40/day |
| `x-digest` | Haiku | 2,000 | 2–5k | low | a few per day |
| `persona`, `persona-sheet`, `reflection` | Haiku | 900 / 600 / 600 | 1–2k | low | 3 sheets and 6 reflections every 3 min until done, then about 17 reflections/h |
| `phrasebook` | **Sonnet** | 16,000 | 3–6k | low | 12 in 48 h |
| `hatch` (raised agents) | **Sonnet** | 16,000 | 3–6k | low | rare |
| `site:brief` | **Sonnet** | 3,000 | 3–5k | low | per build |
| `site:page` (×2 with a revision) | **Sonnet** | 24,000 | 4–15k | **high** | per build: 16 builds in 48 h, up to `SITES_PER_DAY` |
| `site:critique` | **Sonnet** | 1,200 | 10–12k | low | per build |
| `coin-launch` | **Sonnet** | 700 | 1–2k | low | per launch, a few per day |
| desk plans (via `moment`) | Haiku | 4,000 | 2k | low | once per agent per day |

A website build on Sonnet costs up to about $0.5 (about 50k output tokens including thinking, plus about 30k input). That was the largest single item.

## What changed (this commit)

- **`billedCall` prices every answer as the model that answered** whenever its price is known. An unknown model is priced as the caller says, Haiku by default. The world cap and the reserve now see real money.
- **Per-call cost log:** `[cost] <job> <model> in=… out=… cached=… $…`.
  - Once an hour: `[cost] last hour: $… over N calls; <job> $… (calls, refused), …`, largest first.
  - The same numbers appear on `/api/health/world` under `cost`.
- **Input cap: 20k tokens per call** (`MAX_INPUT_TOKENS`), counted generously at 3.5 characters per token, and 1,600 per image.
  - A larger request is refused before it is sent (nothing is billed), and it is logged as `refused`.
  - The website builder now sends at most 45k characters of a page back for a rebuild or a revision (it was 60k), so it stays inside the cap.
- The fake test brain answers as Haiku, as production's everyday model does.

## Still worth deciding before the limit is raised

- Websites still build on Sonnet (tier 2) at effort "high". Step 2 of the sites plan moves builds to Haiku 5.5, with Sonnet only for the 3 daily remasters.
- `THREAD_INTERVAL_MS=900000` and `LONG_TAKE_INTERVAL_MS=600000` on Railway keep Sonnet threads and long takes at about 10 an hour together. Removing both brings back the defaults (3/h and 4/h).

## The exact window, if wanted

A read-only query that splits the 10-26 17:30–21:30 UTC window by job with token counts. It reads production data, so it is for the owner to run:

```
railway run --service Postgres node <scratchpad>/cost-audit2.mjs
```
