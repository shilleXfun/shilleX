const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);

export const isMobile = (agent = ua()) => /Android|iPhone|iPad|iPod/i.test(agent);
/** Android Chrome itself (not an in-app webview): the only place Mobile Wallet Adapter works. */
export const isAndroidChrome = (agent = ua()) => /Android/i.test(agent) && /Chrome\/\d/.test(agent) && !/\bwv\b/.test(agent);

/** Opens `url` inside Phantom's in-app browser, where the wallet is injected and detected as usual. */
export const phantomBrowse = (url: string, origin: string) => `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(origin)}`;
/** Solflare's Browse deeplink, in the format docs.solflare.com gives. */
export const solflareBrowse = (url: string, origin: string) => `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(origin)}`;

let mwa: Promise<void> | null = null;
/** On Android Chrome, registers Mobile Wallet Adapter once, so the phone's installed wallets appear in the picker. */
export function registerMobileWalletAdapter(): Promise<void> | null {
  if (mwa || !isAndroidChrome()) return mwa;
  mwa = import('@solana-mobile/wallet-standard-mobile').then((m) => m.registerMwa({
    appIdentity: { name: 'Shillex', uri: window.location.origin, icon: '/favicon.svg' },
    authorizationCache: m.createDefaultAuthorizationCache(),
    chains: ['solana:mainnet'],
    chainSelector: m.createDefaultChainSelector(),
    onWalletNotFound: m.createDefaultWalletNotFoundHandler(),
  })).catch((e: unknown) => { console.warn('[wallet] Mobile Wallet Adapter unavailable', e); });
  return mwa;
}
