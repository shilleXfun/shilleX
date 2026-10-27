import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';

/**
 * Where generated files live for good (2026-10-27, Phase 4: coin logos). A Railway bucket in production: S3-compatible and private,
 * so the server reads a file back and serves it itself (presigned URLs expire, and a coin's picture must not). Without bucket
 * settings (local runs, tests) a folder under the uploads directory stands in.
 */
export interface ObjectStore {
  readonly kind: 's3' | 'local';
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  /** The file, or null when there is none under `key`. */
  get(key: string): Promise<{ bytes: Buffer; mime: string } | null>;
}

export interface S3Settings { bucket: string; endpoint: string; region: string; accessKeyId: string; secretAccessKey: string }

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const hmac = (key: Buffer | string, s: string) => createHmac('sha256', key).update(s).digest();
/** A key as an S3 path: each segment percent-encoded the way SigV4 expects (RFC 3986 unreserved characters kept). */
const s3Path = (key: string) => `/${key.split('/').map((p) => encodeURIComponent(p).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/')}`;

/** The headers that sign one S3 request (AWS Signature Version 4, virtual-hosted style, the payload's hash included). */
export function signS3(s: S3Settings, method: 'GET' | 'PUT', key: string, body: Buffer, now: Date, extra: Record<string, string> = {}) {
  const host = `${s.bucket}.${new URL(s.endpoint).host}`;
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const payload = sha256(body);
  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payload, 'x-amz-date': amzDate, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k.toLowerCase(), v])) };
  const names = Object.keys(headers).sort();
  const canonical = [method, s3Path(key), '', ...names.map((n) => `${n}:${headers[n]!.trim()}`), '', names.join(';'), payload].join('\n');
  const scope = `${day}/${s.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${s.secretAccessKey}`, day), s.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  return { url: `https://${host}${s3Path(key)}`, headers: { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${s.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` } };
}

export function s3Store(s: S3Settings, fetchImpl: typeof fetch = fetch, now: () => Date = () => new Date()): ObjectStore {
  return {
    kind: 's3',
    async put(key, bytes, mime) {
      const r = signS3(s, 'PUT', key, bytes, now(), { 'content-type': mime });
      const res = await fetchImpl(r.url, { method: 'PUT', headers: r.headers, body: new Uint8Array(bytes), signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`bucket put ${key}: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
    },
    async get(key) {
      const r = signS3(s, 'GET', key, Buffer.alloc(0), now());
      const res = await fetchImpl(r.url, { headers: r.headers, signal: AbortSignal.timeout(30_000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`bucket get ${key}: ${res.status}`);
      return { bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') ?? 'application/octet-stream' };
    },
  };
}

/** A folder standing in for the bucket; keys never leave it. */
export function localStore(root: string): ObjectStore {
  const at = (key: string) => {
    const p = normalize(join(root, key));
    if (!p.startsWith(normalize(root) + sep)) throw new Error(`bad key ${key}`);
    return p;
  };
  return {
    kind: 'local',
    async put(key, bytes) { await mkdir(dirname(at(key)), { recursive: true }); await writeFile(at(key), bytes); },
    async get(key) {
      try { return { bytes: await readFile(at(key)), mime: key.endsWith('.png') ? 'image/png' : 'application/octet-stream' }; }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
    },
  };
}
