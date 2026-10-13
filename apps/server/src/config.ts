import { fileURLToPath } from 'node:url';
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
  worldChain: 'devnet' | 'memory';
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
}

const on = (v: string | undefined, def: boolean) => (v === undefined || v === '' ? def : ['on', 'true', '1', 'yes'].includes(v.toLowerCase()));

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const nodeEnv = (env.NODE_ENV === 'production' || env.NODE_ENV === 'test' ? env.NODE_ENV : 'development') as Config['nodeEnv'];
  const port = Number(env.PORT ?? 3000);
  const publicUrl = env.PUBLIC_URL || `http://localhost:${nodeEnv === 'production' ? port : 5173}`;
  if (nodeEnv === 'production' && (!env.SESSION_SECRET || ['change-me', 'dev-secret'].includes(env.SESSION_SECRET))) {
    throw new Error('SESSION_SECRET must be set in production');
  }
  const agentsOn = on(env.AGENTS, false);
  const tick = (env.ENGINE_TICK_MS ?? '2000,6000').split(',').map((s) => Number(s.trim()));
  const worldChain: Config['worldChain'] = env.WORLD_CHAIN === 'memory' ? 'memory' : 'devnet';
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
  };
}
