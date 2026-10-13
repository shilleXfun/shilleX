import { fileURLToPath } from 'node:url';
import { loadXConfig, type XConfig } from './x/config.ts';
const root = fileURLToPath(new URL('../../../', import.meta.url));

export interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  databaseUrl: string | undefined;
  pgliteDir: string;
  sessionSecret: string;
  publicUrl: string;
  allowedOrigins: string[];
  solanaRpcUrl: string;
  liveTokenLookup: boolean;
  demoSimulator: boolean;
  seedOnEmpty: boolean;
  uploadsDir: string;
  webDistDir: string;
  /** AGENTS=on runs the agent engine. The agent world itself (routes, wallets) exists whenever WORLD_KEY is set. */
  agentsOn: boolean;
  anthropicApiKey: string | undefined;
  agentDailyBudgetUsd: number;
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
  /** MAINNET_KEY: 32 bytes base64 encrypting the hot vault. Never the same as WORLD_KEY. */
  mainnetKey: string | undefined;
  /** MAINNET_RPC_URL: custody's paid RPC (mainnet-beta when on, devnet in rehearsal). */
  mainnetRpcUrl: string | undefined;
  /** MAINNET_COLD_ADDRESS: the owner's cold wallet; Shillex only reads its balance and sends the house's excess to it. */
  coldAddress: string | undefined;
  /** MAINNET_CUSTODY_LOCAL=on: rehearsal custody against a local validator (tests and e2e). Always false in production. */
  custodyLocal: boolean;
  mainnetLimits: { hotMaxSol: number; outflowDailyMaxSol: number; agentCapSol: number; agentDailyCapSol: number; userMonthlyCapSol: number; worldCapSol: number; houseFeeBps: number; maxTradeSol: number };
  /** RPC for the agents' devnet chain; solanaRpcUrl stays mainnet for the token lookup. */
  devnetRpcUrl: string;
  openaiApiKey: string | undefined;
  openaiImageModel: string;
  imageDailyBudgetUsd: number;
  imageDailyMax: number;
  /** HIDE_DEMO=on hides seeded demo personas and their content from feeds and discovery. */
  hideDemo: boolean;
  /** Engine tick interval range in ms, ENGINE_TICK_MS="min,max". */
  engineTickMs: [number, number];
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
  /** SITES_PER_DAY: websites the agents build per UTC day (x-revamp §3; default 12, 0 stops building). */
  sitesPerDay: number;
}

export interface ExternalConfig {
  /** EXTERNAL_AGENTS=on|off (default off): off answers 404 on every /api/v1 route and /skill.md. */
  on: boolean;
  /** EXTERNAL_AGENTS_MAX: claimed outside agents alive at once (default 50). */
  max: number;
  /** EXTERNAL_WALLET_CLAIMS: 'approve' (default) holds a wallet claim for an admin; 'open' activates it at once. */
  walletClaims: 'approve' | 'open';
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
    storyMs: num(env.STORY_INTERVAL_MS, 300_000, 1000),
    narrationsPerDay: Math.floor(num(env.STORY_NARRATIONS_PER_DAY, 40)),
  };
}

const on = (v: string | undefined, def: boolean) => (v === undefined || v === '' ? def : ['on', 'true', '1', 'yes'].includes(v.toLowerCase()));

/** The open-agents settings, refused at boot when one is malformed: a typo must not silently open or close the gate. */
function externalConfig(env: Record<string, string | undefined>): ExternalConfig {
  const set = (name: string) => env[name] !== undefined && env[name] !== '';
  const bad = (name: string, why: string): never => { throw new Error(`${name} ${why} (got ${JSON.stringify(env[name])})`); };
  const flag = (name: string) => {
    if (!set(name)) return false;
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
    on: flag('EXTERNAL_AGENTS'),
    max: count('EXTERNAL_AGENTS_MAX', 50, 0),
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
  const tick = (env.ENGINE_TICK_MS ?? '2000,6000').split(',').map((s) => Number(s.trim()));
  const worldChain: Config['worldChain'] = env.WORLD_CHAIN === 'memory' ? 'memory' : env.WORLD_CHAIN === 'ledger' ? 'ledger' : 'devnet';
  if (env.MAINNET && !['off', 'rehearsal', 'on'].includes(env.MAINNET)) throw new Error('MAINNET must be off, rehearsal or on');
  const mainnet = (env.MAINNET || 'off') as Config['mainnet'];
  if (mainnet !== 'off' && worldChain !== 'ledger') throw new Error('MAINNET=rehearsal or on needs WORLD_CHAIN=ledger (mainnet spec §2)');
  const n = (v: string | undefined, def: number) => (v === undefined || v === '' ? def : Number(v));
  return {
    nodeEnv,
    port,
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDir: env.PGLITE_DIR || `${root}data/pglite`,
    sessionSecret: env.SESSION_SECRET || 'dev-secret',
    publicUrl,
    allowedOrigins: [publicUrl, `http://localhost:${port}`, 'http://localhost:5173', 'http://127.0.0.1:5173'],
    solanaRpcUrl: env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    liveTokenLookup: on(env.LIVE_TOKEN_LOOKUP, nodeEnv !== 'test'),
    demoSimulator: !agentsOn && on(env.DEMO_SIMULATOR, nodeEnv === 'development'),
    seedOnEmpty: !agentsOn && on(env.SEED_ON_EMPTY, nodeEnv !== 'test'),
    uploadsDir: env.UPLOADS_DIR || `${root}data/uploads`,
    webDistDir: `${root}apps/web/dist`,
    agentsOn,
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    agentDailyBudgetUsd: Number(env.AGENT_DAILY_BUDGET_USD ?? 1),
    worldKey: env.WORLD_KEY || undefined,
    adminUsernames: (env.ADMIN_USERNAMES ?? 'admin').split(',').map((s) => s.trim()).filter(Boolean),
    worldAdminPassword: env.WORLD_ADMIN_PASSWORD || undefined,
    adminDevPassword: env.ADMIN_DEV_PASSWORD || (nodeEnv !== 'production' && worldChain === 'memory' ? '12345' : null),
    worldChain,
    mainnet,
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
    devnetRpcUrl: env.DEVNET_RPC_URL || 'https://api.devnet.solana.com',
    openaiApiKey: env.OPENAI_API_KEY || undefined,
    openaiImageModel: env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
    imageDailyBudgetUsd: Number(env.IMAGE_DAILY_BUDGET_USD ?? 0.5),
    imageDailyMax: Number(env.IMAGE_DAILY_MAX ?? 15),
    hideDemo: on(env.HIDE_DEMO, agentsOn),
    engineTickMs: [tick[0] || 2000, tick[1] || tick[0] || 6000],
    userAgentsOn: on(env.USER_AGENTS, false),
    userAgentsMax: Number(env.USER_AGENTS_MAX ?? 200),
    userAgentsPerDay: Number(env.USER_AGENTS_PER_DAY ?? 30),
    userAgentGrantsDailySol: Number(env.USER_AGENT_GRANTS_DAILY_SOL ?? 3),
    userAgentBudgetShare: Math.min(1, Math.max(0, Number(env.USER_AGENT_BUDGET_SHARE ?? 0.35))),
    ownerModelRepliesPerDay: Number(env.OWNER_MODEL_REPLIES_PER_DAY ?? 5),
    userAgentMinAccountDays: Number(env.USER_AGENTS_MIN_AGE_DAYS ?? 3),
    hatchWithoutModel: nodeEnv !== 'production' && worldChain === 'memory' && !env.ANTHROPIC_API_KEY,
    x: loadXConfig(env),
    external: externalConfig(env),
    scenes: loadSceneConfig(env, nodeEnv),
    sitesPerDay: Math.max(0, Math.floor(n(env.SITES_PER_DAY, 12)) || 0),
  };
}
