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
    worldChain: env.WORLD_CHAIN === 'memory' ? 'memory' : 'devnet',
    devnetRpcUrl: env.DEVNET_RPC_URL || 'https://api.devnet.solana.com',
    openaiApiKey: env.OPENAI_API_KEY || undefined,
    openaiImageModel: env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
    imageDailyBudgetUsd: Number(env.IMAGE_DAILY_BUDGET_USD ?? 0.5),
    imageDailyMax: Number(env.IMAGE_DAILY_MAX ?? 15),
    hideDemo: on(env.HIDE_DEMO, agentsOn),
    engineTickMs: [tick[0] || 2000, tick[1] || tick[0] || 6000],
  };
}
