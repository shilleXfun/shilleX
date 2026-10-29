import { fileURLToPath } from 'node:url';
import { loadXConfig, type XConfig } from './x/config.ts';
import type { ProviderConfig } from './world/brain-openai.ts';
import { rpcFromEnv, type SolanaNetwork } from './world/network.ts';
const root = fileURLToPath(new URL('../../../', import.meta.url));

export interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  databaseUrl: string | undefined;
  pgliteDir: string;
  sessionSecret: string;
  publicUrl: string;
  /** SITE_SECRET=on|off (default on): the site's address never leaves it (no link in X posts, nothing on-chain) until launch. */
  siteSecret: boolean;
  /**
   * SOLANA_NETWORK=devnet|mainnet (default devnet; world/network.ts). Mainnet means TRADING_MODE=real, SOL_TRADING on unless set
   * off, no start grant: owners fund their agents. SOLANA_DEVNET_RPC_URL / SOLANA_MAINNET_RPC_URL (older names still read).
   */
  solanaNetwork: SolanaNetwork;
  rpc: { devnet: string; mainnet: string | null };
  /** DEVNET_TREASURY_SECRET: the devnet treasury's secret key (base58 or a JSON byte array); the database's treasury wallet otherwise. */
  devnetTreasurySecret: string | undefined;
  allowedOrigins: string[];
  solanaRpcUrl: string;
  liveTokenLookup: boolean;
  demoSimulator: boolean;
  seedOnEmpty: boolean;
  uploadsDir: string;
  webDistDir: string;
  /** AGENTS=on runs the agent engine. The agent world itself (routes, wallets) exists whenever WORLD_KEY is set. */
  agentsOn: boolean;
  /**
   * WORLD_HALTED=on stops the world and keeps the site: no agent turns, scenes, model calls, funding, outside agents or price
   * reads, and each wallet is read from the RPC once; the pages show the world as it stood. EXTERNAL_AGENTS=on set explicitly
   * keeps outside agents open while the house agents are halted (owner, 2026-10-29: test bringing an agent during the pause).
   */
  worldHalted: boolean;
  /**
   * TRADING_MODE: 'real' (default) means agents trade only real Solana coins on their paper desks and launch nothing; 'world' brings
   * back trading and launching Shillex coins on the world chain; 'hybrid' (2026-10-26) keeps the paper desk for real coins and brings
   * Shillex coins back on devnet, launched by dev agents only and traded under a chain budget.
   */
  tradingMode: 'real' | 'world' | 'hybrid';
  /** CHAIN_TX_PER_HOUR: world-wide cap on the agents' chain transactions, so the public devnet RPC is never run dry again (default 60). */
  chainTxPerHour: number;
  /** LAUNCHES_PER_DAY: Shillex coins the house agents may launch in 24 hours, all devs together (hybrid; default 4). */
  launchesPerDay: number;
  anthropicApiKey: string | undefined;
  /**
   * DeepSeek (2026-10-28): DEEPSEEK_API_KEY through DEEPSEEK_BASE_URL (default its Anthropic-compatible endpoint). DEEPSEEK_MODEL
   * (default deepseek-flash) for everyday calls, DEEPSEEK_MODEL_STRONG (default deepseek-v4-pro) for big work; DEEPSEEK_PRICE_IN /
   * DEEPSEEK_PRICE_OUT in USD per million tokens (defaults 0.5 and 2, on the high side so the budget errs safe). Null without a key.
   */
  deepseek: { apiKey: string; baseUrl: string; model: string; modelStrong: string; priceInPerM: number; priceOutPerM: number } | null;
  /** ANTHROPIC_MODEL_STRONG (e.g. claude-sonnet-5-5): with LLM_PROVIDER=anthropic, the model for big work (websites, threads, long takes, scenes); Haiku when unset. */
  anthropicModelStrong: string | undefined;
  /** AGENT_DAILY_BUDGET_USD: only the raised agents' share and old tests read it now; the world's cap is llmBudgetPer12hUsd. */
  agentDailyBudgetUsd: number;
  /**
   * LLM_BUDGET_USD_PER_12H (default 4): the model cap for each half of the UTC day (00-12, 12-24), spend kept in the database. Launch
   * day is a bigger number here, never a code change. LLM_BUDGET_USD_PER_DAY, when set, wins: each half gets half of it. Whatever
   * either says, a half is clamped to half of LLM_HARD_CEILING_USD_PER_DAY.
   */
  llmBudgetPer12hUsd: number;
  /** BRAIN_KILL_SWITCH=true: no model call at all (no brain, no v0 pages, no paid images); the free engine runs on, capped. */
  brainKillSwitch: boolean;
  /** COMPUTE_USD_PER_DAY (default 3.5, 0 turns the economy off): the agents' daily compute, split by job (agents/compute.ts). */
  computeUsdPerDay: number;
  /** DIRECTOR=on|off (default on): agents decide for themselves when woken (agents/director.ts); DIRECTOR_TICK_MS (default 60000) and DIRECTOR_WAKE (default 2) set how often and how many. */
  /** DIRECTOR_POSTS_PER_HOUR (default 40, owner 2026-10-29: more agents talking in the feed): posts and replies the house agents make in an hour, a plain post half of them. */
  director: { on: boolean; tickMs: number; wake: number; postsPerHour: number };
  /** REMASTERS_PER_DAY (default 3, 0 = off): the most visited sites each day rebuilt with the stronger model, the house paying (sites/remaster.ts). */
  remastersPerDay: number;
  /** S3_BUCKET, S3_ENDPOINT, S3_REGION (default auto), S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY: the Railway bucket generated files live in (world/object-store.ts); null without them (a folder under UPLOADS_DIR stands in). */
  bucket: { bucket: string; endpoint: string; region: string; accessKeyId: string; secretAccessKey: string } | null;
  /** MAINNET_LAUNCH=on|off (default off): whether agents may launch coins at all while real SOL is on (MAINNET is not off). */
  mainnetLaunch: boolean;
  worldKey: string | undefined;
  adminUsernames: string[];
  worldAdminPassword: string | undefined;
  /**
   * Password for the /admindev console (ADMIN_DEV_PASSWORD). Defaults to 12345 only for a local memory-chain world outside
   * production (local dev and e2e); anywhere else an unset password is null and the console is off.
   */
  adminDevPassword: string | null;
  worldChain: 'devnet' | 'memory' | 'ledger';
  /** MAINNET=off|rehearsal|on (mainnet spec §9). Anything but off needs WORLD_CHAIN=ledger; on also needs the launch gate. */
  mainnet: 'off' | 'rehearsal' | 'on';
  /**
   * MAINNET_OWNER_ONLY=on (with MAINNET=on): the owner's own test of real SOL. Only the house stake the owner puts in backs
   * the agents; public deposits are refused, so no one else's money is ever held. The gate then skips what protects other
   * people's deposits (the recorded legal review, the 14-day rehearsal, the risk notice) and keeps every key, RPC, cap and
   * reserves check. Turning it off later puts the full gate back.
   */
  mainnetOwnerOnly: boolean;
  /** MAINNET_KEY: 32 bytes base64 encrypting the hot vault. Never the same as WORLD_KEY. */
  mainnetKey: string | undefined;
  /** MAINNET_RPC_URL: custody's paid RPC (mainnet-beta when on, devnet in rehearsal). */
  mainnetRpcUrl: string | undefined;
  /** MAINNET_COLD_ADDRESS: the owner's cold wallet; Shillex only reads its balance and sends the house's excess to it. */
  coldAddress: string | undefined;
  /** MAINNET_CUSTODY_LOCAL=on: rehearsal custody against a local validator (tests and e2e). Always false in production. */
  custodyLocal: boolean;
  mainnetLimits: { hotMaxSol: number; outflowDailyMaxSol: number; agentCapSol: number; agentDailyCapSol: number; userMonthlyCapSol: number; worldCapSol: number; houseFeeBps: number; maxTradeSol: number };
  /**
   * RPC for the agents' devnet chain; solanaRpcUrl stays mainnet for the token lookup. HELIUS_RPC_URL wins when it is a devnet URL
   * (devnet.helius-rpc.com); a mainnet one is left for later and never used here, since the devnet chain refuses mainnet at boot.
   */
  devnetRpcUrl: string;
  /**
   * SOL_TRADING=on (default off): agents trade real SOL on mainnet, each from its own wallet, under its owner's rules only
   * (world/sol-trade.ts). Off is the global kill switch (the admin switch is the instant one); withdrawals work either way.
   * SOL_TRADING_RPC_URL or HELIUS_MAINNET_RPC_URL (else HELIUS_RPC_URL's key on mainnet). SOL_WALLET_KEY: 32 bytes base64 sealing every wallet (world/sol-vault.ts).
   */
  solTrading: { on: boolean; rpcUrl: string | null; vaultKey: string | undefined };
  openaiApiKey: string | undefined;
  openaiImageModel: string;
  imageDailyBudgetUsd: number;
  /** IMAGE_DAILY_LIMIT (IMAGE_DAILY_MAX still read; default 15): paid images per UTC day, on top of the dollar budget. */
  imageDailyMax: number;
  /** IMAGE_POST_EVERY (default 25, 0 = never): about one in this many posts the agents write carries a drawn image. */
  imagePostEvery: number;
  /** HIDE_DEMO=on hides seeded demo personas and their content from feeds and discovery. */
  hideDemo: boolean;
  /** Engine tick interval range in ms, ENGINE_TICK_MS="min,max". */
  engineTickMs: [number, number];
  /**
   * Raised agents (2026-10-28 brief §3): RAISED_MODEL (default the cheapest, claude-haiku-5-5) thinks for them, every
   * RAISED_THINK_MIN_MS..RAISED_THINK_MAX_MS (default 20-30 minutes); RAISED_PER_OWNER (default 1) free raised agents per owner.
   */
  raised: { model: string; thinkMs: [number, number]; perOwner: number };
  /** USER_AGENTS=on lets any eligible human raise an agent; off (the default) leaves raising to admins (spec 2026-10-13-user-agents §11). */
  userAgentsOn: boolean;
  /** USER_AGENTS_MAX: raised agents alive at once (default 200). */
  userAgentsMax: number;
  /** USER_AGENTS_PER_DAY: agents hatched per UTC day (default 30). */
  userAgentsPerDay: number;
  /** USER_AGENT_GRANTS_DAILY_SOL: devnet SOL the treasury grants raised agents per UTC day (default 3). */
  userAgentGrantsDailySol: number;
  /** USER_AGENT_BUDGET_SHARE: raised agents' share of AGENT_DAILY_BUDGET_USD, 0..1 (default 0.35). */
  userAgentBudgetShare: number;
  /** OWNER_MODEL_REPLIES_PER_DAY: model-written chat replies an owner gets from their agent per UTC day (default 5). */
  ownerModelRepliesPerDay: number;
  /** USER_AGENTS_MIN_AGE_DAYS: how old an account must be to raise an agent (default 3; admins are exempt). */
  userAgentMinAccountDays: number;
  /** Hatch from the fallback phrasebook, with no model call: only a local memory-chain world without ANTHROPIC_API_KEY, outside production (dev, e2e). */
  hatchWithoutModel: boolean;
  /** The X feed and the official highlights account (x-feed spec). */
  x: XConfig;
  /** OPEN AGENTS (plan 2026-10-13-open-agents): outside agents with their own brains, acting through /api/v1. */
  external: ExternalConfig;
  /** Scenes (agents talking to each other in public threads), long takes and stories (agents/scenes, agents/stories). */
  scenes: SceneConfig;
  /** COMMUNITY_PEOPLE_WRITE=on|off (default off since 2026-10-29: Shillex is autonomous, people watch): signed-in people may talk in the Community page's topic rooms (2026-10-28 brief §8); everywhere else only agents write. */
  communityPeopleWrite: boolean;
  /** The Times (2026-10-28 brief §7): TIMES=on|off (default on with AGENTS), TIMES_EVERY_MIN (default 60 since 2026-10-29) between a reporter's pieces, TIMES_RSS_FEEDS ("name|url,…"; free crypto, tech and world feeds by default). */
  times: { on: boolean; everyMin: number; feeds: string | undefined };
  /** SITES_PER_DAY: websites the agents build per UTC day (x-revamp §3; a safety cap on cost, default 48; 0 stops building). */
  sitesPerDay: number;
  /**
   * A one-off boost (owner, 2026-10-29: "3 bucks to spend in the next hour"): BOOST_USD over BOOST_HOURS (default 1) ending at
   * BOOST_UNTIL (an ISO time). Inside it the world's model money is the boost's own (all of it at once, not paced), agents wake
   * four times as often and the house pays their thinking; at BOOST_UNTIL everything is as before. Null when unset or bad.
   */
  boost: { start: Date; end: Date; usd: number } | null;
  /**
   * Websites on Claude (owner, 2026-10-29): SITES_MODEL (default claude-opus-5-5 when ANTHROPIC_API_KEY is set; off: the everyday
   * model) writes every site, the house paying up to SITES_USD_PER_DAY (default 10) over any 24 hours (sites/opus.ts).
   */
  siteModel: { model: string; usdPerDay: number } | null;
  /** V0_API_KEY (and V0_MODEL, default v0-1.5-md; V0_PRICE_IN / V0_PRICE_OUT in USD per million tokens, default 3 and 15): agent websites written by v0. Null without a key: the local builder makes them. */
  v0: { apiKey: string; model: string; priceInPerM: number; priceOutPerM: number; maxTokens: number } | null;
  /** Which model the agents use (2026-10-25 upgrade, Phase B): see loadLlmConfig. */
  llm: LlmConfig;
  /**
   * Posts and replies the model writes in the agents' own words per hour (agents/voice.ts); past it agents stay quiet. POSTS_PER_DAY
   * (default 300, 2026-10-27: "300 good posts a day instead of 1,300 filler") sets it: a bit over half of the day's posts go through
   * the voice, the rest are scenes, threads and long takes. MODEL_VOICE_PER_HOUR can only lower it (0 turns the voice off).
   */
  voicePerHour: number;
  postsPerDay: number;
  /** PHRASEBOOK_POSTS_PER_HOUR (default 10): public posts the whole world may make without the model (agents/quiet.ts); past it agents stay quiet. */
  phrasebookPerHour: number;
}

/** The model cap per 12 hours when LLM_BUDGET_USD_PER_12H is unset, and the most it can ever be set to (a typo or a retry bug can't pass it). */
export const LLM_BUDGET_DEFAULT_USD_PER_12H = 4, LLM_HARD_CEILING_USD_PER_DAY = 50;
/** The share of POSTS_PER_DAY written by the voice; scenes, threads and long takes write the rest. */
export const VOICE_SHARE = 0.55;

export interface LlmConfig {
  /** 'deepseek': DEEPSEEK_API_KEY through DeepSeek's Anthropic-compatible endpoint (wins when set); 'openai': the providers below, in order (OpenAI-compatible APIs); 'anthropic': ANTHROPIC_API_KEY; 'none': the free engine only. */
  mode: 'deepseek' | 'openai' | 'anthropic' | 'none';
  providers: ProviderConfig[];
  /** LLM_BUILD_PROVIDER: the provider site builds ask first (one listed in LLM_PROVIDERS), or null for the usual order. */
  buildProvider: string | null;
}

/** Known OpenAI-compatible providers: where they live, sensible models, what they support. Any field can be overridden by env. */
export const LLM_PRESETS: Record<string, Omit<ProviderConfig, 'name' | 'apiKey' | 'priceInPerM' | 'priceOutPerM' | 'dailyRequests' | 'rpm' | 'tpm' | 'timeoutMs'>> = {
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-20b', modelStrong: 'openai/gpt-oss-120b', jsonSchema: true, tools: true, reasoningEffort: true },
  // Gemini's further models answered on 2026-10-25 while the first two were out (2.5 ones are gone, flash-latest timed out).
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-flash-lite-latest', modelStrong: 'gemini-3.5-flash', jsonSchema: true, tools: true, reasoningEffort: true,
    fallbacks: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'], fallbacksStrong: ['gemini-3-flash-preview', 'gemini-3.8-flash', 'gemini-3.6-flash'] },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: '', modelStrong: '', jsonSchema: false, tools: false, reasoningEffort: false },
};

/**
 * LLM_PROVIDERS=groq,gemini (the order is the fallback order; none unless listed: a key alone no longer turns a free provider on,
 * since their quotas ran dry on 2026-10-27). Per provider NAME: NAME_API_KEY, NAME_BASE_URL, NAME_MODEL, NAME_MODEL_STRONG,
 * NAME_MODEL_FALLBACKS and NAME_MODEL_STRONG_FALLBACKS (comma lists of more models on the same key), NAME_PRICE_IN and NAME_PRICE_OUT (USD per million tokens; unset means unknown and the provider is not used, 0 for a free tier;
 * an OpenRouter ':free' model is 0), NAME_DAILY_REQUESTS, NAME_RPM, NAME_TPM, NAME_JSON_SCHEMA, NAME_TOOLS. LLM_TIMEOUT_MS (default
 * 60 s). LLM_PROVIDER=openai|anthropic|none picks the mode; by default Claude when ANTHROPIC_API_KEY is set, else the providers
 * when any is listed, else none.
 */
export function loadLlmConfig(env: Record<string, string | undefined>): LlmConfig {
  const val = (k: string) => (env[k] === undefined || env[k] === '' ? undefined : env[k]!.trim());
  const num = (k: string): number | null => { const v = val(k); if (v === undefined) return null; const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : null; };
  const flag = (k: string, def: boolean) => { const v = val(k)?.toLowerCase(); return v === undefined ? def : ['on', 'true', '1', 'yes'].includes(v); };
  const timeoutMs = num('LLM_TIMEOUT_MS') ?? 60_000;
  const names = (val('LLM_PROVIDERS')?.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) ?? [];
  const providers: ProviderConfig[] = [];
  for (const name of names) {
    const N = name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const apiKey = val(`${N}_API_KEY`);
    const preset = LLM_PRESETS[name];
    const baseUrl = val(`${N}_BASE_URL`) ?? preset?.baseUrl;
    if (!apiKey || !baseUrl) continue;
    const model = val(`${N}_MODEL`) ?? preset?.model ?? '';
    const free = name === 'openrouter' && model.endsWith(':free') ? 0 : null;
    const list = (k: string) => val(k)?.split(',').map((x) => x.trim()).filter(Boolean);
    providers.push({
      name, baseUrl, apiKey, model, modelStrong: val(`${N}_MODEL_STRONG`) ?? (val(`${N}_MODEL`) ? model : preset?.modelStrong ?? model),
      fallbacks: list(`${N}_MODEL_FALLBACKS`) ?? preset?.fallbacks ?? [], fallbacksStrong: list(`${N}_MODEL_STRONG_FALLBACKS`) ?? preset?.fallbacksStrong ?? [],
      priceInPerM: num(`${N}_PRICE_IN`) ?? free, priceOutPerM: num(`${N}_PRICE_OUT`) ?? free,
      dailyRequests: num(`${N}_DAILY_REQUESTS`), rpm: num(`${N}_RPM`), tpm: num(`${N}_TPM`),
      jsonSchema: flag(`${N}_JSON_SCHEMA`, preset?.jsonSchema ?? false), tools: flag(`${N}_TOOLS`, preset?.tools ?? false),
      reasoningEffort: flag(`${N}_REASONING_EFFORT`, preset?.reasoningEffort ?? false), timeoutMs,
    });
  }
  const asked = val('LLM_PROVIDER')?.toLowerCase();
  const mode: LlmConfig['mode'] = asked === 'deepseek' || asked === 'openai' || asked === 'anthropic' || asked === 'none' ? asked
    : val('DEEPSEEK_API_KEY') ? 'deepseek' : val('ANTHROPIC_API_KEY') ? 'anthropic' : providers.length ? 'openai' : 'none';
  // Site builds go to Gemini by default when it is configured: its pages were far better in the 2026-10-25 comparison.
  const build = val('LLM_BUILD_PROVIDER')?.toLowerCase() ?? (providers.some((p) => p.name === 'gemini') ? 'gemini' : null);
  return { mode, providers, buildProvider: build && providers.some((p) => p.name === build) ? build : null };
}

export interface ExternalConfig {
  /** EXTERNAL_AGENTS=on|off (default on): off answers 404 on every /api/v1 route and /skill.md. */
  on: boolean;
  /** MAX_OUTSIDE_AGENTS (EXTERNAL_AGENTS_MAX still read): linked outside agents alive at once (default 3000). */
  max: number;
  /** EXTERNAL_WALLET_CLAIMS: 'approve' (default) holds a wallet claim for an admin; 'open' activates it at once. */
  walletClaims: 'approve' | 'open';
  /** OWNER_AGENTS_MAX: outside agents one owner may link (default 3). */
  ownerMax: number;
  /** EXTERNAL_START_LAMPORTS: the devnet start grant from the treasury (default 0.05 SOL). */
  startLamports: number;
  /** EXTERNAL_REGISTRATIONS_PER_IP_DAY (default 5). */
  regPerIpDay: number;
  /** EXTERNAL_KEY_READS_PER_MIN / EXTERNAL_KEY_ACTS_PER_MIN: per-key limits (default 60 and 10). */
  readsPerMin: number;
  actsPerMin: number;
  /** X_OEMBED_URL: X's public oEmbed endpoint, overridable for tests (default https://publish.twitter.com/oembed). */
  oembedUrl: string;
}

export interface SceneConfig {
  /** SCENES=off stops scenes, long takes and stories (default on whenever AGENTS=on, off under NODE_ENV=test). */
  on: boolean;
  /** SCENE_INTERVAL_MS: how often the director looks for a new scene, jittered ±30% (default 150000). */
  intervalMs: number;
  /** SCENE_GAP_MS="min,max": the pause between two lines of a scene (default 15000,75000). */
  gapMs: [number, number];
  /** SCENE_BUDGET_SHARE: scenes' and long takes' share of AGENT_DAILY_BUDGET_USD, 0..1 (default 0.45). */
  budgetShare: number;
  /** LONG_TAKE_INTERVAL_MS: how often an agent writes a long opinion post, jittered ±30% (default 900000: about 4 an hour). */
  longTakeMs: number;
  /** THREAD_INTERVAL_MS: how often an agent writes a thread (a thesis, an investigation or a market read), jittered ±30% (default 1200000: about 3 an hour). */
  threadMs: number;
  /** STORY_INTERVAL_MS: how often the story detector runs (default 300000). */
  storyMs: number;
  /** STORY_NARRATIONS_PER_DAY: model-written story headlines per UTC day (default 40). */
  narrationsPerDay: number;
}

function loadSceneConfig(env: Record<string, string | undefined>, nodeEnv: Config['nodeEnv']): SceneConfig {
  const on = (v: string | undefined, def: boolean) => (v === undefined || v === '' ? def : ['on', 'true', '1', 'yes'].includes(v.toLowerCase()));
  const num = (v: string | undefined, def: number, min = 0) => { const x = Number(v); return v === undefined || v === '' || !Number.isFinite(x) ? def : Math.max(min, x); };
  const gap = (env.SCENE_GAP_MS ?? '15000,75000').split(',').map((s) => Number(s.trim()));
  const lo = Number.isFinite(gap[0]) && gap[0]! >= 0 ? gap[0]! : 15000;
  const hi = Number.isFinite(gap[1]) && gap[1]! >= lo ? gap[1]! : Math.max(lo, 75000);
  return {
    on: on(env.SCENES, nodeEnv !== 'test'),
    intervalMs: num(env.SCENE_INTERVAL_MS, 150_000, 1000),
    gapMs: [lo, hi],
    budgetShare: Math.min(1, Math.max(0, num(env.SCENE_BUDGET_SHARE, 0.45))),
    longTakeMs: num(env.LONG_TAKE_INTERVAL_MS, 900_000, 1000),
    threadMs: num(env.THREAD_INTERVAL_MS, 1_200_000, 1000),
    storyMs: num(env.STORY_INTERVAL_MS, 300_000, 1000),
    narrationsPerDay: Math.floor(num(env.STORY_NARRATIONS_PER_DAY, 40)),
  };
}

const on = (v: string | undefined, def: boolean) => (v === undefined || v === '' ? def : ['on', 'true', '1', 'yes'].includes(v.toLowerCase()));

/** The open-agents settings, refused at boot when one is malformed: a typo must not silently open or close the gate. */
function externalConfig(env: Record<string, string | undefined>): ExternalConfig {
  const set = (name: string) => env[name] !== undefined && env[name] !== '';
  const bad = (name: string, why: string): never => { throw new Error(`${name} ${why} (got ${JSON.stringify(env[name])})`); };
  const flag = (name: string, def: boolean) => {
    if (!set(name)) return def;
    const v = env[name]!.toLowerCase();
    if (['on', 'true', '1', 'yes'].includes(v)) return true;
    if (['off', 'false', '0', 'no'].includes(v)) return false;
    return bad(name, 'must be on or off');
  };
  const count = (name: string, def: number, min: number) => {
    if (!set(name)) return def;
    const n = Number(env[name]);
    return Number.isSafeInteger(n) && n >= min ? n : bad(name, `must be a whole number of at least ${min}`);
  };
  const walletClaims = set('EXTERNAL_WALLET_CLAIMS') ? env.EXTERNAL_WALLET_CLAIMS!.toLowerCase() : 'approve';
  if (walletClaims !== 'approve' && walletClaims !== 'open') bad('EXTERNAL_WALLET_CLAIMS', 'must be approve or open');
  const oembedUrl = set('X_OEMBED_URL') ? env.X_OEMBED_URL! : 'https://publish.twitter.com/oembed';
  let proto = '';
  try { proto = new URL(oembedUrl).protocol; } catch { bad('X_OEMBED_URL', 'must be a URL'); }
  if (proto !== 'https:' && proto !== 'http:') bad('X_OEMBED_URL', 'must be an http(s) URL');
  return {
    on: flag('EXTERNAL_AGENTS', true),
    max: set('MAX_OUTSIDE_AGENTS') ? count('MAX_OUTSIDE_AGENTS', 3000, 0) : count('EXTERNAL_AGENTS_MAX', 3000, 0),
    ownerMax: count('OWNER_AGENTS_MAX', 3, 1),
    walletClaims: walletClaims as ExternalConfig['walletClaims'],
    startLamports: count('EXTERNAL_START_LAMPORTS', 50_000_000, 0),
    regPerIpDay: count('EXTERNAL_REGISTRATIONS_PER_IP_DAY', 5, 1),
    readsPerMin: count('EXTERNAL_KEY_READS_PER_MIN', 60, 1),
    actsPerMin: count('EXTERNAL_KEY_ACTS_PER_MIN', 10, 1),
    oembedUrl,
  };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const nodeEnv = (env.NODE_ENV === 'production' || env.NODE_ENV === 'test' ? env.NODE_ENV : 'development') as Config['nodeEnv'];
  const port = Number(env.PORT ?? 3000);
  const publicUrl = env.PUBLIC_URL || `http://localhost:${nodeEnv === 'production' ? port : 5173}`;
  if (nodeEnv === 'production' && (!env.SESSION_SECRET || ['change-me', 'dev-secret'].includes(env.SESSION_SECRET))) {
    throw new Error('SESSION_SECRET must be set in production');
  }
  const agentsOn = on(env.AGENTS, false);
  const worldHalted = on(env.WORLD_HALTED, false);
  const tick = (env.ENGINE_TICK_MS ?? '2000,6000').split(',').map((s) => Number(s.trim()));
  const worldChain: Config['worldChain'] = env.WORLD_CHAIN === 'memory' ? 'memory' : env.WORLD_CHAIN === 'ledger' ? 'ledger' : 'devnet';
  if (env.MAINNET && !['off', 'rehearsal', 'on'].includes(env.MAINNET)) throw new Error('MAINNET must be off, rehearsal or on');
  const mainnet = (env.MAINNET || 'off') as Config['mainnet'];
  if (mainnet !== 'off' && worldChain !== 'ledger') throw new Error('MAINNET=rehearsal or on needs WORLD_CHAIN=ledger (mainnet spec §2)');
  const n = (v: string | undefined, def: number) => (v === undefined || v === '' ? def : Number(v));
  const net = (env.SOLANA_NETWORK?.trim().toLowerCase() || 'devnet') as SolanaNetwork;
  if (net !== 'devnet' && net !== 'mainnet') throw new Error(`SOLANA_NETWORK must be devnet or mainnet (got ${JSON.stringify(env.SOLANA_NETWORK)})`);
  const rpc = rpcFromEnv(env);
  const mainnetNet = net === 'mainnet';
  // BRAIN_KILL_SWITCH: every paid model is off, so no key below is handed on.
  const killed = ['on', 'true', '1', 'yes'].includes((env.BRAIN_KILL_SWITCH ?? '').trim().toLowerCase());
  return {
    nodeEnv,
    port,
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDir: env.PGLITE_DIR || `${root}data/pglite`,
    sessionSecret: env.SESSION_SECRET || 'dev-secret',
    publicUrl,
    siteSecret: on(env.SITE_SECRET, true),
    solanaNetwork: net,
    rpc,
    devnetTreasurySecret: env.DEVNET_TREASURY_SECRET?.trim() || undefined,
    allowedOrigins: [publicUrl, `http://localhost:${port}`, 'http://localhost:5173', 'http://127.0.0.1:5173'],
    solanaRpcUrl: env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    liveTokenLookup: on(env.LIVE_TOKEN_LOOKUP, nodeEnv !== 'test'),
    demoSimulator: !agentsOn && on(env.DEMO_SIMULATOR, nodeEnv === 'development'),
    seedOnEmpty: !agentsOn && on(env.SEED_ON_EMPTY, nodeEnv !== 'test'),
    uploadsDir: env.UPLOADS_DIR || `${root}data/uploads`,
    webDistDir: `${root}apps/web/dist`,
    agentsOn,
    worldHalted,
    tradingMode: mainnetNet ? 'real' : env.TRADING_MODE === 'world' ? 'world' : env.TRADING_MODE === 'hybrid' ? 'hybrid' : 'real',
    chainTxPerHour: Math.max(0, Number(env.CHAIN_TX_PER_HOUR ?? 60) || 0),
    launchesPerDay: Math.max(0, Number(env.LAUNCHES_PER_DAY ?? 4) || 0),
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    deepseek: killed || !env.DEEPSEEK_API_KEY?.trim() ? null : {
      apiKey: env.DEEPSEEK_API_KEY.trim(), baseUrl: env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com/anthropic',
      model: env.DEEPSEEK_MODEL?.trim() || 'deepseek-flash', modelStrong: env.DEEPSEEK_MODEL_STRONG?.trim() || 'deepseek-v4-pro',
      priceInPerM: Math.max(0, n(env.DEEPSEEK_PRICE_IN, 0.5) || 0), priceOutPerM: Math.max(0, n(env.DEEPSEEK_PRICE_OUT, 2) || 0),
    },
    anthropicModelStrong: env.ANTHROPIC_MODEL_STRONG?.trim() || undefined,
    agentDailyBudgetUsd: Number(env.AGENT_DAILY_BUDGET_USD ?? 1),
    llmBudgetPer12hUsd: Math.min(LLM_HARD_CEILING_USD_PER_DAY / 2, Math.max(0, (env.LLM_BUDGET_USD_PER_DAY ? n(env.LLM_BUDGET_USD_PER_DAY, 0) / 2 : n(env.LLM_BUDGET_USD_PER_12H, LLM_BUDGET_DEFAULT_USD_PER_12H)) || 0)),
    brainKillSwitch: killed,
    computeUsdPerDay: Math.max(0, n(env.COMPUTE_USD_PER_DAY, 3.5) || 0),
    remastersPerDay: Math.max(0, Math.min(10, Math.floor(n(env.REMASTERS_PER_DAY, 3)) || 0)),
    director: { on: on(env.DIRECTOR, true), tickMs: Math.max(10_000, n(env.DIRECTOR_TICK_MS, 60_000) || 60_000), wake: Math.max(1, Math.min(10, Math.floor(n(env.DIRECTOR_WAKE, 2)) || 2)), postsPerHour: Math.max(1, Math.floor(n(env.DIRECTOR_POSTS_PER_HOUR, 40)) || 40) },
    bucket: env.S3_BUCKET && env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
      ? { bucket: env.S3_BUCKET, endpoint: env.S3_ENDPOINT, region: env.S3_REGION || 'auto', accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } : null,
    mainnetLaunch: on(env.MAINNET_LAUNCH, false),
    worldKey: env.WORLD_KEY || undefined,
    // The account WORLD_ADMIN_PASSWORD signs in is always an admin, whatever ADMIN_USERNAMES lists.
    adminUsernames: [...new Set([...(env.ADMIN_USERNAMES ?? 'admin').split(','), ...(env.WORLD_ADMIN_PASSWORD ? ['admin'] : [])].map((s) => s.trim()).filter(Boolean))],
    worldAdminPassword: env.WORLD_ADMIN_PASSWORD || undefined,
    adminDevPassword: env.ADMIN_DEV_PASSWORD || (nodeEnv !== 'production' && worldChain === 'memory' ? '12345' : null),
    worldChain,
    mainnet,
    mainnetOwnerOnly: mainnet === 'on' && on(env.MAINNET_OWNER_ONLY, false),
    mainnetKey: env.MAINNET_KEY || undefined,
    mainnetRpcUrl: env.MAINNET_RPC_URL || undefined,
    coldAddress: env.MAINNET_COLD_ADDRESS || undefined,
    custodyLocal: nodeEnv !== 'production' && on(env.MAINNET_CUSTODY_LOCAL, false),
    mainnetLimits: {
      hotMaxSol: n(env.HOT_MAX_SOL, 3), outflowDailyMaxSol: n(env.OUTFLOW_DAILY_MAX_SOL, 5),
      agentCapSol: n(env.MAINNET_AGENT_CAP_SOL, 0.5), agentDailyCapSol: n(env.MAINNET_AGENT_DAILY_CAP_SOL, 0.1),
      userMonthlyCapSol: n(env.MAINNET_USER_MONTHLY_CAP_SOL, 1), worldCapSol: n(env.MAINNET_WORLD_CAP_SOL, 25),
      houseFeeBps: n(env.MAINNET_HOUSE_FEE_BPS, 50), maxTradeSol: n(env.MAINNET_MAX_TRADE_SOL, 0.05),
    },
    solTrading: {
      on: on(env.SOL_TRADING, mainnetNet),
      rpcUrl: rpc.mainnet,
      vaultKey: env.SOL_WALLET_KEY || undefined,
    },
    devnetRpcUrl: rpc.devnet,
    openaiApiKey: killed ? undefined : env.OPENAI_API_KEY || undefined,
    openaiImageModel: env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
    imageDailyBudgetUsd: n(env.IMAGE_BUDGET_USD_PER_DAY ?? env.IMAGE_DAILY_BUDGET_USD, 2),
    imageDailyMax: Number(env.IMAGE_DAILY_LIMIT ?? env.IMAGE_DAILY_MAX ?? 15),
    imagePostEvery: Math.max(0, Math.floor(n(env.IMAGE_POST_EVERY, 25)) || 0),
    hideDemo: on(env.HIDE_DEMO, agentsOn),
    engineTickMs: [tick[0] || 2000, tick[1] || tick[0] || 6000],
    raised: (() => {
      const lo = Math.max(60_000, Math.floor(n(env.RAISED_THINK_MIN_MS, 1_200_000)) || 1_200_000);
      return { model: env.RAISED_MODEL?.trim() || 'claude-haiku-5-5', thinkMs: [lo, Math.max(lo, Math.floor(n(env.RAISED_THINK_MAX_MS, 1_800_000)) || 1_800_000)] as [number, number], perOwner: Math.max(1, Math.floor(n(env.RAISED_PER_OWNER, 1)) || 1) };
    })(),
    userAgentsOn: on(env.USER_AGENTS, false),
    userAgentsMax: Number(env.USER_AGENTS_MAX ?? 200),
    userAgentsPerDay: Number(env.USER_AGENTS_PER_DAY ?? 30),
    userAgentGrantsDailySol: Number(env.USER_AGENT_GRANTS_DAILY_SOL ?? 3),
    userAgentBudgetShare: Math.min(1, Math.max(0, Number(env.USER_AGENT_BUDGET_SHARE ?? 0.35))),
    ownerModelRepliesPerDay: Number(env.OWNER_MODEL_REPLIES_PER_DAY ?? 5),
    userAgentMinAccountDays: Number(env.USER_AGENTS_MIN_AGE_DAYS ?? 3),
    hatchWithoutModel: nodeEnv !== 'production' && worldChain === 'memory' && !env.ANTHROPIC_API_KEY,
    x: loadXConfig(env),
    // Mainnet: no free starting SOL, the owner funds the agent's wallet.
    external: (() => { const x = externalConfig(env); const y = mainnetNet ? { ...x, startLamports: 0 } : x; return worldHalted && !on(env.EXTERNAL_AGENTS, false) ? { ...y, on: false } : y; })(),
    scenes: loadSceneConfig(env, nodeEnv),
    communityPeopleWrite: on(env.COMMUNITY_PEOPLE_WRITE, false),
    times: { on: on(env.TIMES, true), everyMin: Math.max(10, Math.floor(n(env.TIMES_EVERY_MIN, 60)) || 60), feeds: env.TIMES_RSS_FEEDS?.trim() || undefined },
    sitesPerDay: Math.max(0, Math.floor(n(env.SITES_PER_DAY, 48)) || 0),
    boost: (() => {
      const end = Date.parse(env.BOOST_UNTIL ?? ''), usd = n(env.BOOST_USD, 0), hours = Math.min(24, Math.max(0.25, n(env.BOOST_HOURS, 1) || 1));
      return Number.isFinite(end) && usd > 0 ? { start: new Date(end - hours * 3_600_000), end: new Date(end), usd: Math.min(usd, 25) } : null;
    })(),
    siteModel: !env.ANTHROPIC_API_KEY?.trim() || env.SITES_MODEL?.trim().toLowerCase() === 'off' ? null
      : { model: env.SITES_MODEL?.trim() || 'claude-opus-5-5', usdPerDay: Math.max(0, n(env.SITES_USD_PER_DAY, 10) || 0) },
    llm: loadLlmConfig(env),
    postsPerDay: Math.max(0, Math.floor(n(env.POSTS_PER_DAY, 300)) || 0),
    voicePerHour: Math.min(Math.round((Math.max(0, Math.floor(n(env.POSTS_PER_DAY, 300)) || 0) * VOICE_SHARE) / 24), Math.max(0, Math.floor(n(env.MODEL_VOICE_PER_HOUR, Infinity)) || 0)),
    phrasebookPerHour: Math.max(0, Math.floor(n(env.PHRASEBOOK_POSTS_PER_HOUR, 10)) || 0),
    v0: env.V0_API_KEY && !killed ? { apiKey: env.V0_API_KEY, model: env.V0_MODEL || 'v0-1.5-md', priceInPerM: n(env.V0_PRICE_IN, 3), priceOutPerM: n(env.V0_PRICE_OUT, 15), maxTokens: 16_000 } : null,
  };
}
