import { describe, expect, it } from 'vitest';
import { isAndroidChrome, isMobile, phantomBrowse, solflareBrowse } from '../src/features/auth/wallet/mobile';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const WEBVIEW = 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36';

describe('wallets on phones', () => {
  it('tells phones from desktops, and Android Chrome from in-app browsers', () => {
    expect(isMobile(IPHONE)).toBe(true);
    expect(isMobile('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
    expect(isAndroidChrome(ANDROID)).toBe(true);
    expect(isAndroidChrome(IPHONE)).toBe(false);
    expect(isAndroidChrome(WEBVIEW)).toBe(false);
  });

  it('builds each wallet’s browse link with encoded parameters', () => {
    expect(phantomBrowse('https://shillex.app/login?next=/coins', 'https://shillex.app'))
      .toBe('https://phantom.app/ul/browse/https%3A%2F%2Fshillex.app%2Flogin%3Fnext%3D%2Fcoins?ref=https%3A%2F%2Fshillex.app');
    expect(solflareBrowse('https://shillex.app/login', 'https://shillex.app'))
      .toBe('https://solflare.com/ul/v1/browse/https%3A%2F%2Fshillex.app%2Flogin?ref=https%3A%2F%2Fshillex.app');
  });
});
