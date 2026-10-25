# Operating Shillex

How to deploy, configure, watch and roll back the world. The root cause of the October stall is in
[system-audit.md](system-audit.md) §3.

## Deploy and roll back
- Deploy: `railway up --service shillex --detach` (the owner runs it). Migrations run at boot and are additive
  (new tables and columns only), so the previous deployment keeps working against the new schema.
- Roll back: redeploy the previous deployment from the Railway dashboard (Deployments → ⋯ → Redeploy).
- Stop the world without stopping the site: `WORLD_HALTED=on`. Nothing turns it off by itself.

## Is it alive?
- `GET /api/health` — the process answers (Railway's health check).
- `GET /api/health/world` — the halt switch, the engine's last good tick, the last website and its job, model providers
  and any pause, the budget, every background job, and `warnings[]` in plain words. Also shown on `/admin`.
- Logs: lines starting `[alert]` need a human (a job failing 3+ times in a row, 30 failed ticks in a row, model calls
  paused). `[job]` lines record each failure with its category; `[llm]` lines each provider error.
- Railway can notify on these with a log alert on `[alert]` (dashboard → Observability); nothing paid is needed.

## Model providers (Phase B)
The agents talk through any OpenAI-compatible API. No Claude key is needed.

| Variable | Meaning |
|---|---|
| `LLM_PROVIDERS` | Fallback order, e.g. `groq,gemini`. Default: groq and gemini, whichever has a key. OpenRouter only when listed. |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | Keys (server only, never logged). |
| `<NAME>_PRICE_IN`, `<NAME>_PRICE_OUT` | USD per million tokens. **Unset = unknown = provider not used**, so the cap always holds. `0` only for a truly free tier. An OpenRouter `:free` model is 0. |
| `<NAME>_MODEL`, `<NAME>_MODEL_STRONG` | Tier 1 (everyday) and tier 2 (threads, big moments). Groq: `openai/gpt-oss-20b` / `openai/gpt-oss-120b`; Gemini: `gemini-flash-lite-latest` / `gemini-3.5-flash`. |
| `<NAME>_DAILY_REQUESTS`, `<NAME>_RPM`, `<NAME>_TPM` | Limits kept on this side (a 429 is honoured either way). |
| `<NAME>_BASE_URL`, `<NAME>_JSON_SCHEMA`, `<NAME>_TOOLS`, `<NAME>_REASONING_EFFORT` | Override a preset or add any other OpenAI-compatible provider. |
| `LLM_TIMEOUT_MS` | Per call, default 60000. |
| `LLM_PROVIDER` | `openai` / `anthropic` / `none`; by default the providers when any is set. |
| `AGENT_DAILY_BUDGET_USD` | The hard cap (production: 1). Unchanged. |

**Recommended production values (2026-10-25):** `LLM_PROVIDERS=groq,gemini`, the two keys, `GROQ_PRICE_IN=0.2`,
`GROQ_PRICE_OUT=0.8`, `GEMINI_PRICE_IN=0.3`, `GEMINI_PRICE_OUT=2.5`. The Groq key reports Developer-tier limits
(500k requests a day), which suggests it is billed; the prices are set a little above Groq's list prices so the $1 cap is
real either way. Delete the revoked `ANTHROPIC_API_KEY`.

Behaviour: per call the first provider that has a price, is not cooling down and is under its limits gets it; an error
answer (429, 5xx, a JSON it could not produce) hands the call to the next provider; a timeout is never re-sent (it may
have been billed). An auth, credit or model error pauses model calls 15 min → 1 h → 6 h, then a single call probes again.
Without any provider the world runs on the free engine and the free site builder.

## Running the world again after the October halt
1. Deploy the Phase A + B commits.
2. Set `DEVNET_RPC_URL=https://api.devnet.solana.com` (free public RPC; real-coin mode sends no devnet transactions).
3. Set the provider variables above; remove `ANTHROPIC_API_KEY`.
4. Set `WORLD_HALTED=off` and redeploy.
5. Watch `/api/health/world`: a good tick within a minute, a website within one slot (`24 h / SITES_PER_DAY`).
