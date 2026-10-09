import { demoMint } from './rng.ts';

export interface CommunityDef { slug: string; name: string; description: string; visibility: 'public' | 'private' | 'invite'; rules: string; channels: { name: string; topic: string; slowModeSeconds?: number }[]; tokenFocus: string[] }
export const COMMUNITIES: CommunityDef[] = [
  { slug: 'trenches', name: 'The Trenches', description: 'The main room. New launches, live takes, constant noise.', visibility: 'public', rules: '1. No DM-me-for-alpha. 2. Post the contract address, not just a ticker. 3. Be decent.',
    channels: [{ name: 'general', topic: 'Say gm, share what you’re watching' }, { name: 'new-launches', topic: 'Fresh mints only — CA required', slowModeSeconds: 15 }, { name: 'memes', topic: 'Images welcome' }], tokenFocus: ['BLINK', 'GRUB', 'ZAPPY'] },
  { slug: 'due-diligence', name: 'Due Diligence Desk', description: 'Slow, careful threads about holders, liquidity and dev behavior.', visibility: 'public', rules: 'Sources or it didn’t happen.',
    channels: [{ name: 'general', topic: 'Questions welcome' }, { name: 'red-flags', topic: 'Post what looks wrong and why' }], tokenFocus: ['GRUB', 'MOTH'] },
  { slug: 'mascot-club', name: 'Mascot Club', description: 'Artists, memers and lore writers building characters.', visibility: 'public', rules: 'Credit artists. No AI-art passing as hand-drawn.',
    channels: [{ name: 'general', topic: 'Show your drawings' }, { name: 'lore', topic: 'Write the story' }], tokenFocus: ['PUPPO', 'MOTH'] },
  { slug: 'builders-den', name: 'Builders Den', description: 'Bots, dashboards and tools for holders.', visibility: 'public', rules: 'Ship > shill.',
    channels: [{ name: 'general', topic: 'What are you building?' }, { name: 'feedback', topic: 'Roast my tool' }], tokenFocus: ['FORGE'] },
  { slug: 'night-owls', name: 'Night Owls', description: 'Asia-hours crew. Quiet chat, long threads.', visibility: 'public', rules: 'Keep it chill.',
    channels: [{ name: 'general', topic: '3am thoughts' }], tokenFocus: ['OWLY', 'ZAPPY'] },
  { slug: 'inner-circle', name: 'Inner Circle', description: 'Small private group for long-form research.', visibility: 'private', rules: 'What’s said here stays here.',
    channels: [{ name: 'general', topic: 'Members only' }, { name: 'research', topic: 'Drafts and sources' }], tokenFocus: ['VAULTY'] },
  { slug: 'art-collective', name: 'Art Collective', description: 'Private studio for the mascot artists.', visibility: 'private', rules: 'Work-in-progress stays private.',
    channels: [{ name: 'general', topic: 'Sketches' }], tokenFocus: ['PUPPO'] },
  { slug: 'beta-testers', name: 'Beta Testers', description: 'Invite-only room testing Quiet Builder’s holder tools.', visibility: 'invite', rules: 'Report bugs, not prices.',
    channels: [{ name: 'general', topic: 'Bug reports' }], tokenFocus: ['FORGE', 'SECRT'] },
];

export interface TokenDef { symbol: string; name: string; mint: string; liquidityUsd: number | null; marketCapUsd: number | null; ageHours: number; promoted?: boolean; status: 'resolved' | 'unindexed' }
const t = (symbol: string, name: string, liquidityUsd: number | null, marketCapUsd: number | null, ageHours: number, extra: Partial<TokenDef> = {}): TokenDef =>
  ({ symbol, name, mint: demoMint(symbol), liquidityUsd, marketCapUsd, ageHours, status: 'resolved', ...extra });
export const DEMO_TOKENS: TokenDef[] = [
  t('BLINK', 'Blinkfish', 48_200, 310_000, 5), t('GRUB', 'Grubworm', 122_000, 1_450_000, 30), t('ZAPPY', 'Zappy Eel', 9_800, 64_000, 2),
  t('MOTH', 'Lamp Moth', 230_000, 3_900_000, 140), t('PUPPO', 'Puppo', 61_000, 720_000, 70), t('FORGE', 'Holder Forge', 15_500, 98_000, 18),
  t('OWLY', 'Owly', 33_000, 260_000, 46), t('VAULTY', 'Vaulty', 7_100, 41_000, 9), t('SECRT', 'Secret Sauce', null, null, 3, { status: 'unindexed' }),
  t('CRUMB', 'Crumb', 4_400, 22_000, 1), t('SNAIL', 'Snail Mail', 88_000, 940_000, 200), t('FIZZ', 'Fizzwick', 19_000, 150_000, 12),
  t('MOSS', 'Moss Golem', 51_000, 480_000, 96), t('PEBL', 'Pebble', 2_900, 15_000, 0.5), t('KITE', 'Kite Season', 27_000, 230_000, 22),
  t('DRIP', 'Drip Frog', 140_000, 2_100_000, 300), t('LOOP', 'Loopy', 11_000, 70_000, 7), t('GLOW', 'Glowcap', 36_000, 410_000, 55, { promoted: true }),
  t('YAWN', 'Yawncat', 6_600, 38_000, 4, { promoted: true }), t('BRICK', 'Brick by Brick', null, null, 1, { status: 'unindexed' }),
];
export const tokenBySymbol = (s: string) => DEMO_TOKENS.find((x) => x.symbol === s)!;

/** Tokens the seed only ever mentions inside private/invite communities and DMs — never publicly. */
export const PRIVATE_ONLY_SYMBOLS: readonly string[] = ['SECRT', 'VAULTY'];
