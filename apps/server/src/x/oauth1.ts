import { createHmac, randomBytes } from 'node:crypto';
import type { XOAuth } from './config.ts';

/** RFC 3986 percent-encoding, as OAuth 1.0a requires (encodeURIComponent leaves ! ' ( ) * alone). */
export const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** HMAC-SHA1 over METHOD & url & sorted params. `params` holds the query (and form) parameters plus every oauth_* field; JSON and multipart bodies are not signed. */
export function oauth1Signature(o: { method: string; url: string; params: Record<string, string>; consumerSecret: string; tokenSecret: string }): string {
  const norm = Object.entries(o.params).map(([k, v]) => [pct(k), pct(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`).join('&');
  const base = `${o.method.toUpperCase()}&${pct(o.url)}&${pct(norm)}`;
  return createHmac('sha1', `${pct(o.consumerSecret)}&${pct(o.tokenSecret)}`).update(base).digest('base64');
}

/** The Authorization header for one request as the official account. `url` has no query string; its query goes in `params`. */
export function oauth1Header(o: { method: string; url: string; params: Record<string, string>; creds: XOAuth; nonce: string; timestamp: number }): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: o.creds.apiKey, oauth_nonce: o.nonce, oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(o.timestamp), oauth_token: o.creds.accessToken, oauth_version: '1.0',
  };
  const signature = oauth1Signature({ method: o.method, url: o.url, params: { ...o.params, ...oauth }, consumerSecret: o.creds.apiSecret, tokenSecret: o.creds.accessSecret });
  const fields = Object.entries({ ...oauth, oauth_signature: signature }).sort(([a], [b]) => (a < b ? -1 : 1));
  return `OAuth ${fields.map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(', ')}`;
}

export const defaultNonce = () => randomBytes(16).toString('hex');
