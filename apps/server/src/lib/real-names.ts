/**
 * Real people, brands and coins an agent must never be named after (CAST). An agent here is a character, so a name that reads
 * as a well-known crypto figure, a celebrity, a company or a real coin would pass it off as someone it is not.
 *
 * Matching (realName): every word of a name is checked against the list, and the name squeezed to letters is checked for any
 * entry of six letters or more (or of more than one word) inside it, so "Vitalik B" and "elonmuskfan" are both caught while a
 * short entry such as "sol" or "ether" only matches a whole word (Solenne and Heather stay fine names).
 */
const PEOPLE = [
  // Crypto figures
  'satoshi', 'nakamoto', 'vitalik', 'buterin', 'changpeng', 'cz', 'saylor', 'sbf', 'bankman', 'fried', 'toly', 'yakovenko', 'raj', 'gokal',
  'armstrong', 'garlinghouse', 'hayes', 'kwon', 'dokwon', 'zhu', 'kyle davies', 'ansem', 'cobie', 'hsaka', 'gcr', 'pentoshi', 'zachxbt',
  'mert', 'mumtaz', 'jesse pollak', 'gavin wood', 'hoskinson', 'charles hoskinson', 'justin sun', 'sun yuchen', 'brian armstrong',
  'michael saylor', 'roger ver', 'novogratz', 'winklevoss', 'tyler winklevoss', 'cameron winklevoss', 'andre cronje', 'cronje',
  'hayden adams', 'stani kulechov', 'kulechov', 'balaji', 'srinivasan', 'naval', 'ravikant', 'szabo', 'hal finney', 'finney', 'wassie',
  'murad', 'mahmudov', 'ogle', 'beeple', 'pranksy', 'punk6529', 'tetranode', 'loomdart', 'darkfarms', 'ice frog', 'icebergy',
  // Celebrities and public figures
  'elon', 'musk', 'elonmusk', 'trump', 'donald', 'melania', 'biden', 'obama', 'kamala', 'harris', 'putin', 'zelensky', 'xi jinping',
  'bezos', 'zuckerberg', 'zuck', 'gates', 'jobs', 'altman', 'sam altman', 'nadella', 'pichai', 'cook', 'tim cook', 'buffett', 'dimon',
  'taylor swift', 'swift', 'beyonce', 'rihanna', 'drake', 'kanye', 'ye', 'kardashian', 'kim kardashian', 'snoop', 'snoop dogg',
  'eminem', 'madonna', 'shakira', 'adele', 'bieber', 'justin bieber', 'ariana', 'grande', 'billie eilish', 'eilish', 'lizzo', 'cardi',
  'nicki minaj', 'minaj', 'travis scott', 'weeknd', 'oprah', 'mrbeast', 'pewdiepie', 'logan paul', 'jake paul', 'andrew tate', 'tate',
  'messi', 'ronaldo', 'neymar', 'mbappe', 'lebron', 'jordan', 'kobe', 'brady', 'tom brady', 'serena', 'federer', 'nadal', 'djokovic',
  'tyson', 'mike tyson', 'paris hilton', 'hilton', 'mark cuban', 'cuban', 'gary vee', 'vaynerchuk', 'joe rogan', 'rogan', 'tucker',
  'dicaprio', 'keanu', 'reeves', 'pitt', 'jolie', 'depp', 'cruise', 'hanks', 'spielberg', 'nolan', 'einstein', 'tesla nikola',
  'jesus', 'christ', 'muhammad', 'buddha', 'pope', 'hitler', 'stalin', 'mao', 'napoleon', 'lincoln',
];
const BRANDS = [
  'apple', 'google', 'alphabet', 'microsoft', 'amazon', 'meta', 'facebook', 'instagram', 'whatsapp', 'twitter', 'tiktok', 'youtube',
  'netflix', 'spotify', 'tesla', 'spacex', 'nvidia', 'intel', 'samsung', 'sony', 'nintendo', 'disney', 'marvel', 'pixar', 'nike',
  'adidas', 'gucci', 'prada', 'chanel', 'rolex', 'ferrari', 'lamborghini', 'lambo', 'porsche', 'cocacola', 'pepsi', 'mcdonalds',
  'starbucks', 'walmart', 'visa', 'mastercard', 'paypal', 'venmo', 'stripe', 'robinhood', 'openai', 'chatgpt', 'anthropic', 'claude',
  'gemini', 'grok', 'xai', 'reddit', 'discord', 'telegram', 'signal', 'uber', 'airbnb', 'pokemon', 'pikachu', 'mario', 'barbie',
  'lego', 'shrek', 'batman', 'superman', 'spiderman', 'yoda', 'vader', 'gandalf',
  // Crypto companies, exchanges, wallets and protocols
  'coinbase', 'binance', 'kraken', 'bitfinex', 'bybit', 'okx', 'kucoin', 'gemini', 'ftx', 'alameda', 'blackrock', 'grayscale', 'tether',
  'circle', 'ripple', 'phantom', 'metamask', 'ledger', 'trezor', 'backpack', 'solflare', 'jupiter', 'raydium', 'orca', 'meteora',
  'pumpfun', 'pump fun', 'moonshot', 'magic eden', 'magiceden', 'opensea', 'blur', 'uniswap', 'sushiswap', 'pancakeswap', 'aave',
  'compound', 'makerdao', 'lido', 'chainlink', 'helius', 'jito', 'marinade', 'tensor', 'dexscreener', 'birdeye', 'photon', 'bonkbot',
  'axiom', 'gmgn', 'hyperliquid', 'polymarket', 'kalshi', 'arkham', 'nansen', 'etherscan', 'solscan', 'shillex',
];
/** Real coins and chains, by ticker and by name. */
const COINS = [
  'btc', 'bitcoin', 'eth', 'ether', 'ethereum', 'sol', 'solana', 'usdc', 'usdt', 'dai', 'bnb', 'xrp', 'ada', 'cardano', 'doge', 'dogecoin',
  'shib', 'shiba', 'pepe', 'bonk', 'wif', 'dogwifhat', 'popcat', 'mew', 'bome', 'slerf', 'myro', 'wen', 'jup', 'ray', 'pyth', 'jto',
  'trx', 'tron', 'ton', 'dot', 'polkadot', 'avax', 'avalanche', 'matic', 'polygon', 'pol', 'arb', 'arbitrum', 'op', 'optimism', 'base',
  'link', 'ltc', 'litecoin', 'bch', 'xlm', 'stellar', 'atom', 'cosmos', 'near', 'apt', 'aptos', 'sui', 'sei', 'tia', 'celestia', 'inj',
  'injective', 'fet', 'render', 'rndr', 'hbar', 'hedera', 'icp', 'fil', 'filecoin', 'etc', 'xmr', 'monero', 'zec', 'zcash', 'kas',
  'kaspa', 'floki', 'brett', 'mog', 'turbo', 'fartcoin', 'goat', 'pnut', 'moodeng', 'chillguy', 'giga', 'spx', 'ai16z', 'virtual',
  'virtuals', 'melania', 'hype', 'ena', 'ethena', 'ondo', 'pengu', 'trump', 'shillex', 'sex',
];

const norm = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const WORDS = new Set<string>();
const SQUEEZED: string[] = [];
for (const entry of [...PEOPLE, ...BRANDS, ...COINS]) {
  const e = norm(entry);
  if (!e.includes(' ')) WORDS.add(e);
  const squeezed = e.replace(/[^a-z0-9]/g, '');
  if (squeezed.length >= 6 || e.includes(' ')) SQUEEZED.push(squeezed);
}

/** True when the name reads as a real person, brand or coin: a listed word on its own, or a longer entry anywhere inside it. */
export function realName(name: string): boolean {
  const n = norm(name);
  for (const w of n.split(/[^a-z0-9]+/).filter(Boolean)) if (WORDS.has(w)) return true;
  const squeezed = n.replace(/[^a-z0-9]/g, '');
  return SQUEEZED.some((e) => squeezed.includes(e));
}
