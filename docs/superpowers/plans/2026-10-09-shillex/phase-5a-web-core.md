# Phase 5a — Web app core (Tasks 16–19)

Read the plan index `../2026-10-09-shillex.md` first. **Before Task 16, invoke the `frontend-design:frontend-design` skill** and apply it within the fixed identity below (palette, fonts, density are decided — the skill informs execution quality: spacing rhythm, hierarchy, states, micro-interactions).

Web conventions:
- CSS Modules (`*.module.css`) per component; global tokens in `src/styles/tokens.css`. Never hard-code colors in modules — use `var(--…)`.
- Server state in TanStack Query. Query keys (fixed, used across tasks): `['me']`, `['feed', tab]`, `['thread', id]`, `['userPosts', username, tab]`, `['bookmarks']`, `['token', mint]`, `['tokenDetail', mint]`, `['tokenPosts', mint]`, `['tokenChat', mint]`, `['communities', filter]`, `['community', slug]`, `['communityThreads', slug]`, `['members', slug]`, `['pins', slug]`, `['messages', scopeType, scopeId]`, `['conversations']`, `['notifications', filter]`, `['profile', username]`, `['settings']`, `['discover']`, `['sidebar']`.
- Every list has loading skeleton, empty state and error state with retry.
- Icons from `lucide-react`; icon-only buttons always have `aria-label`.
- Relative imports without extensions (Vite `Bundler` resolution).

---

### Task 16: Web scaffold, design system, app shell, auth

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `public/favicon.svg`
- Create: `apps/web/src/main.tsx`, `src/App.tsx`, `src/routes.tsx`
- Create: `apps/web/src/styles/tokens.css`, `src/styles/base.css`
- Create: `apps/web/src/lib/{api,queryClient,socket,useMe,store,cx,format}.ts`
- Create: `apps/web/src/components/brand/{Wordmark.tsx,Wordmark.module.css}`
- Create: `apps/web/src/components/ui/{Button,Avatar,Tabs,Skeleton,EmptyState,ErrorState,Spinner,Menu,Dialog,Popover,Toaster,Badge}.tsx`, `src/components/ui/ui.module.css`
- Create: `apps/web/src/layout/{AppShell,LeftNav,MobileTabBar,MobileHeader,ReconnectBanner,DemoWorldNote}.tsx` + `layout.module.css`
- Create: `apps/web/src/features/auth/{LoginPage,SignupPage,RequireAuth}.tsx` + `auth.module.css`
- Test: `apps/web/test/setup.ts`, `apps/web/test/api.test.ts`, `apps/web/test/LeftNav.test.tsx`, `apps/web/test/utils.tsx`

**Interfaces:**
- Consumes: all server routes; shared types and events.
- Produces:
  - `class ApiError extends Error { status: number; code: string; details?: unknown }`
  - `api<T>(path, { method?, body?, signal? }): Promise<T>`, `get`, `post`, `put`, `patch`, `del`, `uploadImage(file: File): Promise<UploadView>`, `onUnauthorized(cb): () => void`
  - `queryClient`
  - `socket` (typed), `joinRoom(scope, id): () => void`, `useRoom(scope, id | null)`, `useSocketEvent(event, handler)`, `useConnectionState(): 'connected' | 'connecting' | 'offline'`
  - `useMe(): UseQueryResult<MeView | null>`, `useRequiredMe(): MeView`
  - `createStore<T>(initial)`, `useStore(store)`
  - `cx(...classes)`
  - UI: `Button` (`variant: 'primary' | 'secondary' | 'ghost' | 'danger'`, `size: 'sm' | 'md'`, `loading`), `IconButton` (`label` required), `Avatar` (`src, size, online?`), `Tabs` (`tabs: { id; label; count? }[]; value; onChange; label`), `Skeleton`, `EmptyState` (`icon, title, body?, action?`), `ErrorState` (`error: unknown; onRetry?`), `Spinner`, `Menu` (`trigger(props) ; items: { label; onSelect; danger?; icon? }[]`), `Dialog` (`open, onClose, title, children, footer?`), `Popover` (`anchor: HTMLElement | null; open; onClose; children; id`), `toast(message, { tone?: 'info' | 'error' | 'success' })`, `<Toaster/>`, `Badge` (`tone: 'demo' | 'promoted' | 'accent' | 'muted'`)
  - Layout: `<AppShell/>` (renders `<Outlet/>` in `main#main`), `<LeftNav/>`, `<MobileTabBar/>`
  - Routes (all inside `RequireAuth` + `AppShell` except auth): `/`, `/discover`, `/communities`, `/c/:slug`, `/c/:slug/:channelId`, `/messages`, `/messages/:id`, `/notifications`, `/u/:username`, `/p/:id`, `/bookmarks`, `/settings`, `/invite/:code`; `/login`, `/signup`

- [ ] **Step 1: Package and tooling**

`apps/web/package.json`:
```json
{
  "name": "@shillex/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@fontsource/inter": "5.3.0",
    "@fontsource/jetbrains-mono": "5.3.0",
    "@fontsource/space-grotesk": "5.3.0",
    "@shillex/shared": "*",
    "@tanstack/react-query": "5.104.1",
    "lucide-react": "1.54.0",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "react-router": "8.4.0",
    "socket.io-client": "4.8.4"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "6.10.0",
    "@testing-library/react": "16.3.3",
    "@testing-library/user-event": "14.6.7",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.2",
    "jsdom": "30.1.2",
    "typescript": "7.0.2",
    "vite": "8.3.4",
    "vitest": "5.0.3"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext", "moduleResolution": "Bundler", "jsx": "react-jsx",
    "allowImportingTsExtensions": true, "types": ["vite/client", "@testing-library/jest-dom"]
  },
  "include": ["src", "test", "vite.config.ts", "vitest.config.ts"]
}
```

`apps/web/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const api = 'http://localhost:3000';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173, strictPort: true,
    proxy: { '/api': api, '/media': api, '/uploads': api, '/socket.io': { target: api, ws: true } },
  },
  build: { outDir: 'dist', sourcemap: true },
});
```

`apps/web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], test: { environment: 'jsdom', setupFiles: ['test/setup.ts'], include: ['test/**/*.test.{ts,tsx}'], css: { modules: { classNameStrategy: 'non-scoped' } } } });
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0E1219" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <title>Shillex</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/public/favicon.svg` (the x mark on a charcoal tile — same geometry as `XMark` below):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0E1219"/><path d="M19 18 L45 46" stroke="#E6E9EF" stroke-width="8" stroke-linecap="round"/><path d="M45 18 L33 31 M28.5 36 L19 46" stroke="#C8F135" stroke-width="8" stroke-linecap="round"/></svg>
```

Run: `npm install` at root.

- [ ] **Step 2: Tokens and base styles**

`apps/web/src/styles/tokens.css`:
```css
:root {
  color-scheme: dark;
  --bg: #0E1219;
  --panel: #141924;
  --raised: #1A2030;
  --hover: #1F2638;
  --line: #232B3D;
  --line-strong: #2E3850;
  --text: #E6E9EF;
  --muted: #8B94A8;
  --accent: #C8F135;
  --accent-ink: #0E1219;
  --accent-soft: rgba(200, 241, 53, 0.12);
  --token: #3DD6F5;
  --token-soft: rgba(61, 214, 245, 0.1);
  --token-line: rgba(61, 214, 245, 0.35);
  --up: #3DDC84;
  --down: #F2546B;
  --warn: #F5B53D;
  --warn-soft: rgba(245, 181, 61, 0.12);

  --font-ui: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --font-brand: 'Space Grotesk', 'Inter', system-ui, sans-serif;

  --fs-xs: 11px; --fs-sm: 12px; --fs-md: 13.5px; --fs-lg: 15px; --fs-xl: 18px;
  --lh: 1.45;
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 20px; --sp-6: 24px;
  --radius: 8px; --radius-sm: 6px; --radius-pill: 999px;
  --shadow-pop: 0 10px 28px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--line-strong);
  --highlight: inset 0 1px 0 rgba(255, 255, 255, 0.03);

  --left-w: 240px; --right-w: 320px; --panel-w: 420px; --tabbar-h: 56px; --mobile-header-h: 48px;
}
```

`apps/web/src/styles/base.css`:
```css
@import '@fontsource/inter/400.css';
@import '@fontsource/inter/500.css';
@import '@fontsource/inter/600.css';
@import '@fontsource/jetbrains-mono/400.css';
@import '@fontsource/jetbrains-mono/500.css';
@import '@fontsource/space-grotesk/700.css';

*, *::before, *::after { box-sizing: border-box; }
html, body, #root { height: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 400 var(--fs-md) / var(--lh) var(--font-ui);
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
}
a { color: inherit; text-decoration: none; }
button, input, textarea, select { font: inherit; color: inherit; }
button { cursor: pointer; }
img { display: block; max-width: 100%; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
::selection { background: var(--accent-soft); }
.sr-only { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.mono { font-family: var(--font-mono); font-feature-settings: 'zero' 1; }
* { scrollbar-width: thin; scrollbar-color: var(--line-strong) transparent; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important; }
}
```

- [ ] **Step 3: Core libs**

`apps/web/src/lib/cx.ts`:
```ts
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
```

`apps/web/src/lib/api.ts`:
```ts
import type { ApiErrorBody, UploadView } from '@shillex/shared';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
const unauthorized = new Set<() => void>();
export const onUnauthorized = (cb: () => void) => { unauthorized.add(cb); return () => { unauthorized.delete(cb); }; };

async function handle<T>(res: Response, path: string): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const b = (data ?? {}) as Partial<ApiErrorBody>;
    if (res.status === 401 && !path.startsWith('/auth/')) unauthorized.forEach((cb) => cb());
    throw new ApiError(res.status, b.code ?? 'HTTP_ERROR', b.message ?? `Request failed (${res.status})`, b.details);
  }
  return data as T;
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const hasBody = opts.body !== undefined;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (hasBody ? 'POST' : 'GET'), credentials: 'include',
      headers: hasBody ? { 'content-type': 'application/json' } : undefined,
      body: hasBody ? JSON.stringify(opts.body) : undefined, signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Can’t reach Shillex. Check your connection.');
  }
  return handle<T>(res, path);
}
export const get = <T,>(p: string, signal?: AbortSignal) => api<T>(p, { signal });
export const post = <T,>(p: string, body: unknown = {}) => api<T>(p, { method: 'POST', body });
export const put = <T,>(p: string, body: unknown = {}) => api<T>(p, { method: 'PUT', body });
export const patch = <T,>(p: string, body: unknown = {}) => api<T>(p, { method: 'PATCH', body });
export const del = <T,>(p: string) => api<T>(p, { method: 'DELETE' });

export async function uploadImage(file: File): Promise<UploadView> {
  const fd = new FormData();
  fd.append('file', file);
  let res: Response;
  try { res = await fetch('/api/uploads', { method: 'POST', body: fd, credentials: 'include' }); }
  catch { throw new ApiError(0, 'NETWORK', 'Upload failed — check your connection.'); }
  return (await handle<{ upload: UploadView }>(res, '/uploads')).upload;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return 'Something went wrong';
}
export function retryAfterSec(e: unknown): number | null {
  const d = e instanceof ApiError ? (e.details as { retryAfterSec?: number } | undefined) : undefined;
  return typeof d?.retryAfterSec === 'number' ? d.retryAfterSec : null;
}
```

`apps/web/src/lib/queryClient.ts`:
```ts
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, refetchOnWindowFocus: false,
      retry: (n, e) => e instanceof ApiError && (e.status === 0 || e.status >= 500) && n < 2,
    },
  },
});
```

`apps/web/src/lib/store.ts`:
```ts
import { useSyncExternalStore } from 'react';
export interface Store<T> { get(): T; set(v: T | ((p: T) => T)): void; subscribe(l: () => void): () => void }
export function createStore<T>(initial: T): Store<T> {
  let v = initial; const ls = new Set<() => void>();
  return {
    get: () => v,
    set: (n) => { v = typeof n === 'function' ? (n as (p: T) => T)(v) : n; ls.forEach((l) => l()); },
    subscribe: (l) => { ls.add(l); return () => { ls.delete(l); }; },
  };
}
export const useStore = <T,>(s: Store<T>) => useSyncExternalStore(s.subscribe, s.get, s.get);
```

`apps/web/src/lib/socket.ts`:
```ts
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, RoomScope, ServerToClientEvents } from '@shillex/shared';

export type ShillexSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export const socket: ShillexSocket = io({ path: '/socket.io', withCredentials: true, autoConnect: false, transports: ['websocket', 'polling'] });

const rooms = new Map<string, number>();
const subscribe = (scope: RoomScope, id: string) => socket.emit('subscribe', { scope, id }, () => undefined);
socket.on('connect', () => {
  for (const key of rooms.keys()) {
    const i = key.indexOf(':');
    subscribe(key.slice(0, i) as RoomScope, key.slice(i + 1));
  }
});

export function joinRoom(scope: RoomScope, id: string): () => void {
  const key = `${scope}:${id}`;
  const n = rooms.get(key) ?? 0;
  rooms.set(key, n + 1);
  if (n === 0 && socket.connected) subscribe(scope, id);
  return () => {
    const left = (rooms.get(key) ?? 1) - 1;
    if (left <= 0) { rooms.delete(key); if (socket.connected) socket.emit('unsubscribe', { scope, id }); }
    else rooms.set(key, left);
  };
}
export function useRoom(scope: RoomScope, id: string | null | undefined) {
  useEffect(() => (id ? joinRoom(scope, id) : undefined), [scope, id]);
}

export function useSocketEvent<E extends keyof ServerToClientEvents>(event: E, handler: ServerToClientEvents[E]) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const h = (...args: unknown[]) => (ref.current as (...a: unknown[]) => void)(...args);
    socket.on(event, h as never);
    return () => { socket.off(event, h as never); };
  }, [event]);
}

type ConnState = 'connected' | 'connecting' | 'offline';
let state: ConnState = 'connecting';
const listeners = new Set<() => void>();
const setState = (s: ConnState) => { state = s; listeners.forEach((l) => l()); };
socket.on('connect', () => setState('connected'));
socket.on('disconnect', () => setState('connecting'));
socket.io.on('reconnect_attempt', () => setState('connecting'));
socket.io.on('reconnect_failed', () => setState('offline'));
socket.on('connect_error', () => setState(navigator.onLine ? 'connecting' : 'offline'));
export function useConnectionState(): ConnState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state, () => state);
}
```

`apps/web/src/lib/useMe.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import type { MeView } from '@shillex/shared';
import { get } from './api';
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => get<{ user: MeView | null }>('/auth/me').then((r) => r.user), staleTime: 60_000 });
export function useRequiredMe(): MeView {
  const { data } = useMe();
  if (!data) throw new Error('useRequiredMe used outside RequireAuth');
  return data;
}
```

- [ ] **Step 4: Wordmark**

`apps/web/src/components/brand/Wordmark.tsx`:
```tsx
import s from './Wordmark.module.css';

export function XMark({ size = '0.78em' }: { size?: string | number }) {
  return (
    <svg className={s.x} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="M12 10 L52 54" stroke="currentColor" strokeWidth="10" strokeLinecap="round" />
      <path d="M52 10 L35.5 28 M28.5 35.5 L12 54" stroke="var(--accent)" strokeWidth="10" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ size = 21 }: { size?: number }) {
  return (
    <span className={s.wordmark} style={{ fontSize: size }} role="img" aria-label="Shillex">
      <span aria-hidden="true">shille</span>
      <XMark />
    </span>
  );
}
```
`apps/web/src/components/brand/Wordmark.module.css`:
```css
.wordmark { display: inline-flex; align-items: baseline; gap: 0.02em; font-family: var(--font-brand); font-weight: 700; letter-spacing: -0.045em; line-height: 1; color: var(--text); }
.x { transform: translateY(0.06em); margin-left: 0.01em; }
```

- [ ] **Step 5: UI primitives**

`apps/web/src/components/ui/ui.module.css`:
```css
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: var(--radius-sm); border: 1px solid var(--line-strong); background: var(--raised); font-weight: 500; font-size: var(--fs-md); white-space: nowrap; transition: background .12s, border-color .12s; }
.btn:hover:not(:disabled) { background: var(--hover); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.sm { height: 26px; padding: 0 9px; font-size: var(--fs-sm); }
.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.primary:hover:not(:disabled) { background: #d6f85c; }
.ghost { background: transparent; border-color: transparent; color: var(--muted); }
.ghost:hover:not(:disabled) { color: var(--text); background: var(--hover); }
.danger { color: var(--down); }
.iconBtn { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: var(--radius-sm); border: 0; background: transparent; color: var(--muted); }
.iconBtn:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.iconBtn[aria-pressed='true'] { color: var(--accent); }
.avatar { position: relative; flex: none; border-radius: 50%; background: var(--raised); }
.avatar img { width: 100%; height: 100%; border-radius: inherit; object-fit: cover; }
.presence { position: absolute; right: -1px; bottom: -1px; width: 28%; height: 28%; min-width: 8px; min-height: 8px; border-radius: 50%; background: var(--up); box-shadow: 0 0 0 2px var(--panel); }
.tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--line); }
.tab { position: relative; padding: 10px 12px; border: 0; background: none; color: var(--muted); font-weight: 500; }
.tab[aria-selected='true'] { color: var(--text); }
.tab[aria-selected='true']::after { content: ''; position: absolute; left: 10px; right: 10px; bottom: -1px; height: 2px; background: var(--accent); border-radius: 2px; }
.tabCount { margin-left: 6px; color: var(--muted); font-family: var(--font-mono); font-size: var(--fs-xs); }
.skeleton { background: linear-gradient(90deg, var(--raised) 0%, var(--hover) 50%, var(--raised) 100%); background-size: 200% 100%; animation: shimmer 1.4s infinite linear; border-radius: 4px; }
@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.state { display: grid; justify-items: center; gap: 8px; padding: 40px 20px; text-align: center; color: var(--muted); }
.stateIcon { color: var(--line-strong); }
.stateTitle { color: var(--text); font-weight: 600; font-size: var(--fs-lg); }
.badge { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border-radius: 4px; font: 600 10px/1 var(--font-mono); letter-spacing: .06em; text-transform: uppercase; }
.badge_demo, .badge_promoted { color: var(--warn); background: var(--warn-soft); }
.badge_accent { color: var(--accent); background: var(--accent-soft); }
.badge_muted { color: var(--muted); background: var(--raised); }
.menu { position: fixed; z-index: 60; min-width: 180px; padding: 4px; border-radius: var(--radius); background: var(--raised); box-shadow: var(--shadow-pop); }
.menuItem { display: flex; width: 100%; align-items: center; gap: 8px; padding: 7px 10px; border: 0; border-radius: 5px; background: none; text-align: left; }
.menuItem:hover, .menuItem:focus-visible { background: var(--hover); outline: none; }
.menuDanger { color: var(--down); }
.dialog { width: min(480px, calc(100vw - 32px)); padding: 0; border: 1px solid var(--line-strong); border-radius: 12px; background: var(--panel); color: var(--text); box-shadow: var(--shadow-pop); }
.dialog::backdrop { background: rgba(5, 7, 12, .7); }
.dialogHead { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--line); font-weight: 600; }
.dialogBody { padding: 16px; }
.dialogFoot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--line); }
.popover { position: fixed; z-index: 70; border-radius: var(--radius); background: var(--raised); box-shadow: var(--shadow-pop); }
.toasts { position: fixed; z-index: 90; left: 50%; bottom: calc(var(--tabbar-h) + 16px); transform: translateX(-50%); display: grid; gap: 8px; pointer-events: none; }
@media (min-width: 768px) { .toasts { bottom: 20px; } }
.toast { pointer-events: auto; padding: 10px 14px; border-radius: var(--radius); background: var(--raised); box-shadow: var(--shadow-pop); font-weight: 500; }
.toast_error { box-shadow: var(--shadow-pop), inset 3px 0 0 var(--down); }
.toast_success { box-shadow: var(--shadow-pop), inset 3px 0 0 var(--up); }
.spinner { width: 14px; height: 14px; border: 2px solid var(--line-strong); border-top-color: var(--accent); border-radius: 50%; animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
```

`apps/web/src/components/ui/Button.tsx`:
```tsx
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from '../../lib/cx';
import { Spinner } from './Spinner';
import s from './ui.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'secondary', size = 'md', loading, icon, children, className, disabled, ref, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button ref={ref} type="button" className={cx(s.btn, variant !== 'secondary' && s[variant], size === 'sm' && s.sm, className)}
      disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}
export function IconButton({ label, children, className, ref, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; ref?: Ref<HTMLButtonElement> }) {
  return <button ref={ref} type="button" aria-label={label} title={label} className={cx(s.iconBtn, className)} {...rest}>{children}</button>;
}
```

`apps/web/src/components/ui/Spinner.tsx`:
```tsx
import s from './ui.module.css';
export const Spinner = ({ label }: { label?: string }) => <span className={s.spinner} role={label ? 'status' : undefined} aria-label={label} />;
```

`apps/web/src/components/ui/Avatar.tsx`:
```tsx
import s from './ui.module.css';
export function Avatar({ src, size = 36, online, alt = '' }: { src: string; size?: number; online?: boolean; alt?: string }) {
  return (
    <span className={s.avatar} style={{ width: size, height: size }}>
      <img src={src} alt={alt} width={size} height={size} loading="lazy" />
      {online && <span className={s.presence} aria-label="online" role="img" />}
    </span>
  );
}
```

`apps/web/src/components/ui/Tabs.tsx`:
```tsx
import { useRef, type KeyboardEvent } from 'react';
import s from './ui.module.css';

export interface TabDef { id: string; label: string; count?: number }
export function Tabs({ tabs, value, onChange, label, idPrefix = 'tab' }: { tabs: TabDef[]; value: string; onChange: (id: string) => void; label: string; idPrefix?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + tabs.length) % tabs.length;
    refs.current[n]?.focus();
    onChange(tabs[n]!.id);
  };
  return (
    <div role="tablist" aria-label={label} className={s.tabs}>
      {tabs.map((t, i) => (
        <button key={t.id} ref={(el) => { refs.current[i] = el; }} role="tab" id={`${idPrefix}-${t.id}`} aria-selected={t.id === value}
          aria-controls={`${idPrefix}-panel`} tabIndex={t.id === value ? 0 : -1} className={s.tab} onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}>
          {t.label}{t.count !== undefined && <span className={s.tabCount}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
```

`apps/web/src/components/ui/Skeleton.tsx`:
```tsx
import s from './ui.module.css';
export const Skeleton = ({ w = '100%', h = 12, r }: { w?: number | string; h?: number; r?: number }) =>
  <span className={s.skeleton} style={{ display: 'block', width: w, height: h, borderRadius: r }} aria-hidden="true" />;
```

`apps/web/src/components/ui/EmptyState.tsx`:
```tsx
import type { ReactNode } from 'react';
import s from './ui.module.css';
export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return <div className={s.state}>{icon && <span className={s.stateIcon} aria-hidden="true">{icon}</span>}<div className={s.stateTitle}>{title}</div>{body && <div>{body}</div>}{action}</div>;
}
```

`apps/web/src/components/ui/ErrorState.tsx`:
```tsx
import { AlertTriangle } from 'lucide-react';
import { errorMessage } from '../../lib/api';
import { Button } from './Button';
import s from './ui.module.css';
export function ErrorState({ error, onRetry, title = 'Couldn’t load this' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div className={s.state} role="alert">
      <AlertTriangle size={28} className={s.stateIcon} aria-hidden="true" />
      <div className={s.stateTitle}>{title}</div>
      <div>{errorMessage(error)}</div>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}
```

`apps/web/src/components/ui/Badge.tsx`:
```tsx
import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import s from './ui.module.css';
export const Badge = ({ tone, children, title }: { tone: 'demo' | 'promoted' | 'accent' | 'muted'; children: ReactNode; title?: string }) =>
  <span className={cx(s.badge, s[`badge_${tone}`])} title={title}>{children}</span>;
```

`apps/web/src/components/ui/Popover.tsx`:
```tsx
import { useLayoutEffect, useState, type ReactNode, type PointerEventHandler } from 'react';
import { createPortal } from 'react-dom';
import s from './ui.module.css';

export function Popover({ anchor, open, id, children, onPointerEnter, onPointerLeave, width = 300 }:
  { anchor: HTMLElement | null; open: boolean; id: string; children: ReactNode; width?: number; onPointerEnter?: PointerEventHandler; onPointerLeave?: PointerEventHandler }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      const below = r.bottom + 6;
      const top = below + 220 > window.innerHeight && r.top > 240 ? r.top - 6 - 220 : below;
      setPos({ top, left });
    };
    place();
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, anchor, width]);
  if (!open || !pos) return null;
  return createPortal(
    <div id={id} role="dialog" aria-modal="false" className={s.popover} style={{ top: pos.top, left: pos.left, width }} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>{children}</div>,
    document.body,
  );
}
```

`apps/web/src/components/ui/Menu.tsx`:
```tsx
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../../lib/cx';
import s from './ui.module.css';

export interface MenuItem { label: string; onSelect: () => void; danger?: boolean; icon?: ReactNode }
export function Menu({ trigger, items, label }: {
  label: string; items: MenuItem[];
  trigger: (p: { ref: (el: HTMLButtonElement | null) => void; onClick: () => void; 'aria-haspopup': 'menu'; 'aria-expanded': boolean; 'aria-controls': string; 'aria-label': string }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const close = (e: MouseEvent) => { if (!listRef.current?.contains(e.target as Node) && e.target !== anchor) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, anchor]);
  const onKey = (e: React.KeyboardEvent) => {
    const els = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); anchor?.focus(); }
  };
  const r = anchor?.getBoundingClientRect();
  return (
    <>
      {trigger({ ref: setAnchor, onClick: () => setOpen((o) => !o), 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': id, 'aria-label': label })}
      {open && r && createPortal(
        <div ref={listRef} id={id} role="menu" aria-label={label} className={s.menu} onKeyDown={onKey}
          style={{ top: Math.min(r.bottom + 4, window.innerHeight - 8 - items.length * 34), left: Math.max(8, Math.min(r.right - 200, window.innerWidth - 208)) }}>
          {items.map((it) => (
            <button key={it.label} role="menuitem" type="button" className={cx(s.menuItem, it.danger && s.menuDanger)}
              onClick={() => { setOpen(false); anchor?.focus(); it.onSelect(); }}>{it.icon}{it.label}</button>
          ))}
        </div>, document.body)}
    </>
  );
}
```

`apps/web/src/components/ui/Dialog.tsx`:
```tsx
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './Button';
import s from './ui.module.css';

export function Dialog({ open, onClose, title, children, footer, className }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`${s.dialog} ${className ?? ''}`} aria-labelledby="dlg-title" onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <>
          <div className={s.dialogHead}><span id="dlg-title">{title}</span><IconButton label="Close" onClick={onClose}><X size={16} /></IconButton></div>
          <div className={s.dialogBody}>{children}</div>
          {footer && <div className={s.dialogFoot}>{footer}</div>}
        </>
      )}
    </dialog>
  );
}
```

`apps/web/src/components/ui/Toaster.tsx`:
```tsx
import { createStore, useStore } from '../../lib/store';
import { cx } from '../../lib/cx';
import s from './ui.module.css';

type Tone = 'info' | 'error' | 'success';
const toasts = createStore<{ id: number; message: string; tone: Tone }[]>([]);
let n = 0;
export function toast(message: string, opts: { tone?: Tone } = {}) {
  const id = ++n;
  toasts.set((t) => [...t.slice(-2), { id, message, tone: opts.tone ?? 'info' }]);
  setTimeout(() => toasts.set((t) => t.filter((x) => x.id !== id)), 4000);
}
export function Toaster() {
  const list = useStore(toasts);
  return (
    <div className={s.toasts} role="status" aria-live="polite">
      {list.map((t) => <div key={t.id} className={cx(s.toast, s[`toast_${t.tone}`])}>{t.message}</div>)}
    </div>
  );
}
```

- [ ] **Step 6: Layout**

`apps/web/src/layout/layout.module.css`:
```css
.shell { min-height: 100%; display: grid; grid-template-columns: var(--left-w) minmax(0, 1fr) var(--right-w); }
.left { position: sticky; top: 0; height: 100vh; border-right: 1px solid var(--line); background: var(--panel); overflow-y: auto; }
.center { min-width: 0; min-height: 100vh; outline: none; }
.right { position: sticky; top: 0; height: 100vh; border-left: 1px solid var(--line); overflow-y: auto; }
.skip { position: absolute; left: 8px; top: -40px; z-index: 100; padding: 8px 12px; background: var(--accent); color: var(--accent-ink); border-radius: var(--radius-sm); font-weight: 600; }
.skip:focus { top: 8px; }
@media (max-width: 1199px) { .shell { grid-template-columns: var(--left-w) minmax(0, 1fr); } .right { display: none; } }
@media (max-width: 1023px) { .shell { grid-template-columns: 72px minmax(0, 1fr); } }
@media (max-width: 767px) {
  .shell { grid-template-columns: minmax(0, 1fr); }
  .left { display: none; }
  .center { min-height: calc(100vh - var(--tabbar-h)); padding-bottom: var(--tabbar-h); }
  .shell[data-immersive='true'] .center { padding-bottom: 0; }
}
.nav { display: flex; flex-direction: column; min-height: 100%; padding: 14px 10px; gap: 2px; }
.brand { display: flex; align-items: center; height: 36px; padding: 0 10px; margin-bottom: 10px; }
.navItem { display: flex; align-items: center; gap: 12px; height: 38px; padding: 0 10px; border-radius: var(--radius-sm); color: var(--muted); font-weight: 500; font-size: var(--fs-lg); }
.navItem:hover { background: var(--hover); color: var(--text); }
.navItem[aria-current='page'] { color: var(--text); background: var(--raised); box-shadow: inset 2px 0 0 var(--accent); }
.navBadge { margin-left: auto; min-width: 18px; height: 18px; padding: 0 5px; border-radius: var(--radius-pill); background: var(--accent); color: var(--accent-ink); font: 600 11px/18px var(--font-mono); text-align: center; }
.sectionLabel { margin: 18px 10px 6px; color: var(--muted); font-size: var(--fs-xs); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
.community { display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 10px; border-radius: var(--radius-sm); color: var(--muted); }
.community:hover { background: var(--hover); color: var(--text); }
.community[aria-current='page'] { background: var(--raised); color: var(--text); }
.community img { width: 20px; height: 20px; border-radius: 5px; }
.communityName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.unreadDot { margin-left: auto; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.unreadCount { margin-left: auto; color: var(--text); font: 500 11px var(--font-mono); }
.navFoot { margin-top: auto; padding-top: 12px; display: grid; gap: 10px; }
.account { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--radius); border: 0; background: none; text-align: left; width: 100%; }
.account:hover { background: var(--hover); }
.demoNote { margin: 0 6px; padding: 10px; border: 1px dashed var(--line-strong); border-radius: var(--radius); color: var(--muted); font-size: var(--fs-sm); }
.demoNote strong { color: var(--warn); font-weight: 600; }
@media (max-width: 1023px) {
  .navLabel, .sectionLabel, .communityName, .unreadCount, .demoNote, .accountText { display: none; }
  .navItem, .community { justify-content: center; padding: 0; }
  .navBadge { position: absolute; transform: translate(10px, -10px); }
  .navItem { position: relative; }
}
.tabbar { position: fixed; z-index: 40; inset: auto 0 0 0; height: var(--tabbar-h); padding-bottom: env(safe-area-inset-bottom); display: none; grid-template-columns: repeat(5, 1fr); background: var(--panel); border-top: 1px solid var(--line); }
.tabbar a { position: relative; display: grid; place-items: center; align-content: center; gap: 2px; color: var(--muted); font-size: 10px; }
.tabbar a[aria-current='page'] { color: var(--accent); }
@media (max-width: 767px) { .tabbar { display: grid; } .shell[data-immersive='true'] .tabbar { display: none; } }
.mobileHeader { position: sticky; top: 0; z-index: 30; display: none; align-items: center; justify-content: space-between; height: var(--mobile-header-h); padding: 0 12px; background: rgba(14, 18, 25, .92); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); }
@media (max-width: 767px) { .mobileHeader { display: flex; } .shell[data-immersive='true'] .mobileHeader { display: none; } }
.banner { position: fixed; z-index: 95; top: 8px; left: 50%; transform: translateX(-50%); padding: 6px 12px; border-radius: var(--radius-pill); background: var(--raised); box-shadow: var(--shadow-pop); color: var(--warn); font-size: var(--fs-sm); font-weight: 500; }
```

`apps/web/src/layout/AppShell.tsx`:
```tsx
import { Outlet, useMatch } from 'react-router';
import { LeftNav } from './LeftNav';
import { MobileTabBar } from './MobileTabBar';
import { MobileHeader } from './MobileHeader';
import { ReconnectBanner } from './ReconnectBanner';
import { Toaster } from '../components/ui/Toaster';
import s from './layout.module.css';

export function AppShell() {
  // Conversation screens are immersive on mobile: no tab bar or global header (they render their own back header).
  const inChannel = useMatch('/c/:slug/:channelId');
  const inDm = useMatch('/messages/:id');
  return (
    <div className={s.shell} data-immersive={!!(inChannel || inDm)}>
      <a href="#main" className={s.skip}>Skip to content</a>
      <ReconnectBanner />
      <aside className={s.left} aria-label="Primary"><LeftNav /></aside>
      <main id="main" className={s.center} tabIndex={-1}>
        <MobileHeader />
        <Outlet />
      </main>
      {/* Task 23 adds <aside className={s.right}><RightRail/></aside>; Task 19 adds <TokenPanelHost/> */}
      <MobileTabBar />
      <Toaster />
    </div>
  );
}
```

`apps/web/src/layout/LeftNav.tsx`:
```tsx
import { NavLink, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CircleUser, Compass, House, MessagesSquare, Plus, Settings, UsersRound, LogOut, Bookmark } from 'lucide-react';
import type { CommunitySummary, ConversationView } from '@shillex/shared';
import { get, post } from '../lib/api';
import { useRequiredMe } from '../lib/useMe';
import { socket } from '../lib/socket';
import { useStore } from '../lib/store';
import { mentionDots } from './unreadStore';
import { Wordmark } from '../components/brand/Wordmark';
import { Avatar } from '../components/ui/Avatar';
import { Menu } from '../components/ui/Menu';
import { DemoWorldNote } from './DemoWorldNote';
import s from './layout.module.css';

export function useJoinedCommunities() {
  return useQuery({ queryKey: ['communities', 'joined'], queryFn: () => get<{ communities: CommunitySummary[] }>('/communities?filter=joined').then((r) => r.communities) });
}
export function useConversations() {
  return useQuery({ queryKey: ['conversations'], queryFn: () => get<{ conversations: ConversationView[] }>('/conversations').then((r) => r.conversations) });
}

export function LeftNav() {
  const me = useRequiredMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data: joined } = useJoinedCommunities();
  const { data: convs } = useConversations();
  const dots = useStore(mentionDots);
  const dmUnread = (convs ?? []).filter((c) => !c.muted).reduce((n, c) => n + c.unread, 0);
  const items = [
    { to: '/', label: 'Home', icon: House, end: true },
    { to: '/discover', label: 'Discover', icon: Compass },
    { to: '/communities', label: 'Communities', icon: UsersRound },
    { to: '/messages', label: 'Messages', icon: MessagesSquare, badge: dmUnread },
    { to: '/notifications', label: 'Notifications', icon: Bell, badge: me.unreadNotifications },
    { to: `/u/${me.username}`, label: 'Profile', icon: CircleUser },
  ];
  const logout = async () => { await post('/auth/logout'); socket.disconnect(); qc.clear(); nav('/login'); };
  return (
    <nav className={s.nav} aria-label="Main">
      <NavLink to="/" className={s.brand} aria-label="Shillex home"><Wordmark /></NavLink>
      {items.map(({ to, label, icon: Icon, badge, end }) => (
        <NavLink key={to} to={to} end={end} className={s.navItem}>
          <Icon size={20} aria-hidden="true" /><span className={s.navLabel}>{label}</span>
          {!!badge && <span className={s.navBadge} aria-label={`${badge} unread`}>{badge > 99 ? '99+' : badge}</span>}
        </NavLink>
      ))}
      <div className={s.sectionLabel} id="joined-label">Your communities</div>
      <ul aria-labelledby="joined-label" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {(joined ?? []).map((c) => (
          <li key={c.id}>
            <NavLink to={`/c/${c.slug}`} className={s.community} title={c.name}>
              <img src={c.avatarUrl} alt="" />
              <span className={s.communityName}>{c.name}</span>
              {dots.has(c.id) ? <span className={s.unreadDot} aria-label="You were mentioned" role="img" />
                : c.unread > 0 ? <span className={s.unreadCount} aria-label={`${c.unread} unread`}>{c.unread}</span> : null}
            </NavLink>
          </li>
        ))}
        <li><NavLink to="/communities" className={s.community}><Plus size={18} aria-hidden="true" /><span className={s.communityName}>Browse or create</span></NavLink></li>
      </ul>
      <div className={s.navFoot}>
        <DemoWorldNote />
        <Menu label="Account" items={[
          { label: 'Profile', icon: <CircleUser size={15} />, onSelect: () => nav(`/u/${me.username}`) },
          { label: 'Bookmarks', icon: <Bookmark size={15} />, onSelect: () => nav('/bookmarks') },
          { label: 'Settings', icon: <Settings size={15} />, onSelect: () => nav('/settings') },
          { label: 'Log out', icon: <LogOut size={15} />, onSelect: logout, danger: true },
        ]} trigger={(p) => (
          <button {...p} className={s.account} type="button">
            <Avatar src={me.avatarUrl} size={30} />
            <span className={s.accountText}><div style={{ fontWeight: 600 }}>{me.displayName}</div><div style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>@{me.username}</div></span>
          </button>
        )} />
      </div>
    </nav>
  );
}
```

`apps/web/src/layout/unreadStore.ts`:
```ts
import { createStore } from '../lib/store';
/** Communities where the viewer was @mentioned since last visiting them. */
export const mentionDots = createStore<Set<string>>(new Set());
export const clearMentionDot = (communityId: string) => mentionDots.set((s) => { if (!s.has(communityId)) return s; const n = new Set(s); n.delete(communityId); return n; });
export const addMentionDot = (communityId: string) => mentionDots.set((s) => new Set(s).add(communityId));
```

`apps/web/src/layout/DemoWorldNote.tsx`:
```tsx
import { useQuery } from '@tanstack/react-query';
import type { SidebarView } from '@shillex/shared';
import { get } from '../lib/api';
import s from './layout.module.css';
export function DemoWorldNote() {
  const { data } = useQuery({ queryKey: ['sidebar'], queryFn: () => get<SidebarView>('/sidebar'), refetchInterval: 60_000 });
  return (
    <p className={s.demoNote}>
      <strong>Demo world.</strong> Seeded people, communities and tokens are fictional. Market numbers on DEMO tokens are invented; live tokens show their data source.
      {data?.demoSimulator && <><br /><span style={{ color: 'var(--accent)' }}>●</span> Demo activity is on — personas post automatically.</>}
    </p>
  );
}
```

`apps/web/src/layout/MobileTabBar.tsx`:
```tsx
import { NavLink } from 'react-router';
import { CircleUser, Compass, House, MessagesSquare, UsersRound } from 'lucide-react';
import { useRequiredMe } from '../lib/useMe';
import { useConversations } from './LeftNav';
import s from './layout.module.css';
export function MobileTabBar() {
  const me = useRequiredMe();
  const { data } = useConversations();
  const dm = (data ?? []).filter((c) => !c.muted).reduce((n, c) => n + c.unread, 0);
  const tabs = [
    { to: '/', label: 'Home', icon: House, end: true }, { to: '/discover', label: 'Discover', icon: Compass },
    { to: '/communities', label: 'Communities', icon: UsersRound }, { to: '/messages', label: 'Messages', icon: MessagesSquare, badge: dm },
    { to: `/u/${me.username}`, label: 'Profile', icon: CircleUser },
  ];
  return (
    <nav className={s.tabbar} aria-label="Tabs">
      {tabs.map(({ to, label, icon: Icon, end, badge }) => (
        <NavLink key={to} to={to} end={end}>
          <Icon size={21} aria-hidden="true" /><span>{label}</span>
          {!!badge && <span className={s.navBadge} style={{ position: 'absolute', top: 6, left: '55%' }} aria-label={`${badge} unread`}>{badge}</span>}
        </NavLink>
      ))}
    </nav>
  );
}
```

`apps/web/src/layout/MobileHeader.tsx`:
```tsx
import { Link } from 'react-router';
import { Bell, Settings } from 'lucide-react';
import { Wordmark } from '../components/brand/Wordmark';
import { useRequiredMe } from '../lib/useMe';
import s from './layout.module.css';
export function MobileHeader() {
  const me = useRequiredMe();
  return (
    <header className={s.mobileHeader}>
      <Link to="/" aria-label="Shillex home"><Wordmark size={19} /></Link>
      <div style={{ display: 'flex', gap: 4 }}>
        <Link to="/notifications" aria-label={`Notifications${me.unreadNotifications ? `, ${me.unreadNotifications} unread` : ''}`} style={{ position: 'relative', padding: 8 }}>
          <Bell size={20} aria-hidden="true" />{me.unreadNotifications > 0 && <span className={s.unreadDot} style={{ position: 'absolute', top: 6, right: 6 }} />}
        </Link>
        <Link to="/settings" aria-label="Settings" style={{ padding: 8 }}><Settings size={20} aria-hidden="true" /></Link>
      </div>
    </header>
  );
}
```

`apps/web/src/layout/ReconnectBanner.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useConnectionState } from '../lib/socket';
import s from './layout.module.css';
export function ReconnectBanner() {
  const state = useConnectionState();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (state === 'connected') { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 1500); // avoid flashing on the initial connect
    return () => clearTimeout(t);
  }, [state]);
  if (!show) return null;
  return <div className={s.banner} role="status">{state === 'offline' ? 'You’re offline — messages will sync when you reconnect' : 'Reconnecting…'}</div>;
}
```

- [ ] **Step 7: Auth pages, routing, entry**

`apps/web/src/features/auth/auth.module.css`:
```css
.page { min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: var(--bg); }
.card { width: min(380px, 100%); padding: 28px 24px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); box-shadow: var(--highlight); }
.tagline { margin: 10px 0 22px; color: var(--muted); }
.form { display: grid; gap: 12px; }
.field { display: grid; gap: 6px; font-size: var(--fs-sm); color: var(--muted); }
.input { height: 38px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--bg); color: var(--text); }
.input:focus-visible { outline: 2px solid var(--accent); outline-offset: 0; }
.error { color: var(--down); font-size: var(--fs-sm); }
.divider { display: flex; align-items: center; gap: 10px; margin: 18px 0; color: var(--muted); font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: .08em; }
.divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--line); }
.demoHint { margin-top: 8px; color: var(--muted); font-size: var(--fs-sm); }
.switch { margin-top: 18px; color: var(--muted); font-size: var(--fs-sm); text-align: center; }
.switch a { color: var(--accent); }
```

`apps/web/src/features/auth/LoginPage.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { MeView } from '@shillex/shared';
import { errorMessage, post } from '../../lib/api';
import { Wordmark } from '../../components/brand/Wordmark';
import { Button } from '../../components/ui/Button';
import s from './auth.module.css';

export function LoginPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next')?.startsWith('/') ? params.get('next')! : '/';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'login' | 'demo' | null>(null);

  async function go(kind: 'login' | 'demo', e?: FormEvent) {
    e?.preventDefault();
    setBusy(kind); setError(null);
    try {
      const r = kind === 'demo' ? await post<{ user: MeView }>('/auth/demo') : await post<{ user: MeView }>('/auth/login', { username, password });
      qc.setQueryData(['me'], r.user);
      nav(next, { replace: true });
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(null); }
  }

  return (
    <div className={s.page}>
      <main className={s.card}>
        <h1 style={{ margin: 0 }}><Wordmark size={28} /></h1>
        <p className={s.tagline}>Talk with the trenches. Every coin starts as a conversation.</p>
        <form className={s.form} onSubmit={(e) => go('login', e)}>
          <label className={s.field}>Username<input className={s.input} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
          <label className={s.field}>Password<input className={s.input} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {error && <div className={s.error} role="alert">{error}</div>}
          <Button type="submit" variant="primary" loading={busy === 'login'}>Sign in</Button>
        </form>
        <div className={s.divider}>or</div>
        <Button style={{ width: '100%' }} onClick={() => go('demo')} loading={busy === 'demo'}>Enter the demo world</Button>
        <p className={s.demoHint}>Signs you in as <span className="mono">@demo</span> — a fictional account in a seeded world of fictional people, communities and tokens.</p>
        <p className={s.switch}>New here? <Link to="/signup">Create an account</Link></p>
      </main>
    </div>
  );
}
```

`apps/web/src/features/auth/SignupPage.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { MeView } from '@shillex/shared';
import { ApiError, errorMessage, post } from '../../lib/api';
import { Wordmark } from '../../components/brand/Wordmark';
import { Button } from '../../components/ui/Button';
import s from './auth.module.css';

export function SignupPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [form, setForm] = useState({ username: '', displayName: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await post<{ user: MeView }>('/auth/signup', form);
      qc.setQueryData(['me'], r.user);
      nav('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'VALIDATION' ? 'Check the fields: username 3–20 letters, numbers or _; password at least 8 characters.' : errorMessage(err));
    } finally { setBusy(false); }
  }
  return (
    <div className={s.page}>
      <main className={s.card}>
        <h1 style={{ margin: 0 }}><Wordmark size={28} /></h1>
        <p className={s.tagline}>Create your account. Wallets are optional and never shown unless you choose.</p>
        <form className={s.form} onSubmit={submit}>
          <label className={s.field}>Username<input className={s.input} autoComplete="username" pattern="[A-Za-z0-9_]{3,20}" value={form.username} onChange={set('username')} required /></label>
          <label className={s.field}>Display name<input className={s.input} maxLength={40} value={form.displayName} onChange={set('displayName')} required /></label>
          <label className={s.field}>Password<input className={s.input} type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={set('password')} required /></label>
          {error && <div className={s.error} role="alert">{error}</div>}
          <Button type="submit" variant="primary" loading={busy}>Create account</Button>
        </form>
        <p className={s.switch}>Already have an account? <Link to="/login">Sign in</Link></p>
      </main>
    </div>
  );
}
```

`apps/web/src/features/auth/RequireAuth.tsx`:
```tsx
import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '../../lib/useMe';
import { onUnauthorized } from '../../lib/api';
import { socket } from '../../lib/socket';
import { Wordmark } from '../../components/brand/Wordmark';
import { ErrorState } from '../../components/ui/ErrorState';

export function RequireAuth({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const loc = useLocation();
  const { data: me, isLoading, error, refetch } = useMe();
  useEffect(() => onUnauthorized(() => qc.setQueryData(['me'], null)), [qc]);
  useEffect(() => {
    if (!me) return;
    socket.connect();
    return () => { socket.disconnect(); };
  }, [me?.id]);
  if (isLoading) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }} aria-busy="true"><Wordmark size={30} /></div>;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} title="Can’t reach Shillex" />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}
```

`apps/web/src/routes.tsx` (pages from later tasks are added as they are built; until then unbuilt routes render `<ComingNext name="…"/>` — a temporary component deleted in Task 24, see note):
```tsx
import { createBrowserRouter } from 'react-router';
import { AppShell } from './layout/AppShell';
import { RequireAuth } from './features/auth/RequireAuth';
import { LoginPage } from './features/auth/LoginPage';
import { SignupPage } from './features/auth/SignupPage';
import { EmptyState } from './components/ui/EmptyState';

const ComingNext = ({ name }: { name: string }) => <EmptyState title={name} body="This screen is built in a later task." />;

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  {
    element: <RequireAuth><AppShell /></RequireAuth>,
    children: [
      { path: '/', element: <ComingNext name="Home" /> },
      { path: '/discover', element: <ComingNext name="Discover" /> },
      { path: '/communities', element: <ComingNext name="Communities" /> },
      { path: '/c/:slug', element: <ComingNext name="Community" /> },
      { path: '/c/:slug/:channelId', element: <ComingNext name="Channel" /> },
      { path: '/messages', element: <ComingNext name="Messages" /> },
      { path: '/messages/:id', element: <ComingNext name="Conversation" /> },
      { path: '/notifications', element: <ComingNext name="Notifications" /> },
      { path: '/u/:username', element: <ComingNext name="Profile" /> },
      { path: '/p/:id', element: <ComingNext name="Thread" /> },
      { path: '/bookmarks', element: <ComingNext name="Bookmarks" /> },
      { path: '/settings', element: <ComingNext name="Settings" /> },
      { path: '/invite/:code', element: <ComingNext name="Invite" /> },
      { path: '*', element: <EmptyState title="Page not found" body="That link doesn’t go anywhere." /> },
    ],
  },
]);
```
Note: `ComingNext` exists only so the shell is navigable during the build; each later task replaces its route element, and Task 24 Step 1 asserts `ComingNext` no longer appears (`grep -r ComingNext apps/web/src` returns nothing).

`apps/web/src/App.tsx`:
```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { queryClient } from './lib/queryClient';
import { router } from './routes';
export function App() {
  return <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>;
}
```

`apps/web/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './App';
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
```

- [ ] **Step 8: Tests**

`apps/web/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
// jsdom lacks <dialog> modal APIs
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')); };
globalThis.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ''; thresholds = []; } as unknown as typeof IntersectionObserver;
```

`apps/web/test/utils.tsx`:
```tsx
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { MeView } from '@shillex/shared';

export const me: MeView = { id: 'u1', username: 'demo', displayName: 'You (demo)', avatarUrl: '/media/avatar/u1.svg', isDemo: true, unreadNotifications: 3, createdAt: '2026-09-01T00:00:00Z' };
export function renderWithApp(ui: ReactNode, { route = '/', seed }: { route?: string; seed?: (qc: QueryClient) => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(['me'], me);
  seed?.(qc);
  const router = createMemoryRouter([{ path: '*', element: ui }], { initialEntries: [route] });
  return { qc, ...render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>) };
}
export function mockFetch(routes: Record<string, unknown | ((init?: RequestInit) => unknown)>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, '');
    const key = Object.keys(routes).find((k) => url === k || url.startsWith(k));
    if (!key) return new Response(JSON.stringify({ code: 'NOT_FOUND', message: `no mock for ${url}` }), { status: 404 });
    const v = routes[key];
    const body = typeof v === 'function' ? (v as (i?: RequestInit) => unknown)(init) : v;
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}
```
`mockFetch` matches the longest-registered prefix only if listed first — register more specific paths (e.g. `/api/tokens/<mint>/posts`) before their prefixes (`/api/tokens/<mint>`), as the tests do.

`apps/web/test/api.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { api, ApiError, onUnauthorized } from '../src/lib/api';

describe('api client', () => {
  it('parses the server error shape into ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'SLOW_MODE', message: 'wait', details: { retryAfterSec: 9 } }), { status: 429 }));
    await expect(api('/x')).rejects.toMatchObject({ status: 429, code: 'SLOW_MODE', message: 'wait', details: { retryAfterSec: 9 } });
  });
  it('notifies on 401 outside /auth', async () => {
    const cb = vi.fn(); const off = onUnauthorized(cb);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'x' }), { status: 401 }));
    await expect(api('/feed')).rejects.toBeInstanceOf(ApiError);
    await expect(api('/auth/login')).rejects.toBeInstanceOf(ApiError);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });
  it('maps network failures to NETWORK', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api('/x')).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
  });
  it('returns undefined for 204', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api('/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});
```

`apps/web/test/LeftNav.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { LeftNav } from '../src/layout/LeftNav';

describe('LeftNav', () => {
  it('shows primary nav, unread badges and joined communities', async () => {
    mockFetch({ '/api/sidebar': { liveRooms: [], people: [], newCoins: [], promoted: null, demoSimulator: true } });
    renderWithApp(<LeftNav />, {
      seed: (qc) => {
        qc.setQueryData(['communities', 'joined'], [{ id: 'c1', slug: 'trenches', name: 'The Trenches', description: '', avatarUrl: '/a.svg', visibility: 'public', memberCount: 9, onlineCount: 2, myRole: 'member', myStatus: 'active', unread: 4, isDemo: true }]);
        qc.setQueryData(['conversations'], [{ id: 'd1', kind: 'dm', name: null, members: [], lastMessage: null, unread: 2, muted: false, createdAt: '' }]);
      },
    });
    for (const label of ['Home', 'Discover', 'Communities', 'Messages', 'Notifications', 'Profile']) expect(screen.getByRole('link', { name: new RegExp(label) })).toBeInTheDocument();
    expect(screen.getByLabelText('2 unread')).toBeInTheDocument();
    expect(screen.getByLabelText('3 unread')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /The Trenches/ })).toHaveAttribute('href', '/c/trenches');
    expect(screen.getByLabelText('4 unread')).toBeInTheDocument();
    expect(await screen.findByText(/Demo activity is on/)).toBeInTheDocument();
  });
});
```

Run: `npm test -w @shillex/web && npm run typecheck -w @shillex/web` → PASS.

- [ ] **Step 9: Visual check and commit**

Run `npm run dev` (root). Open http://localhost:5173 → redirected to `/login`; "Enter the demo world" signs in; the shell shows left nav with joined communities and unread counts; at 375px width the bottom tab bar appears. Use the Playwright MCP tools to screenshot 1440×900 and 390×844 into `.playwright-mcp/` and check against the visual direction (charcoal, dense, crisp, no gradients). Fix anything off before committing.
```bash
git add apps/web package.json package-lock.json
git commit -m "feat(web): design tokens, wordmark, ui primitives, app shell and auth"
```

---

### Task 17: Token data layer, token chip, preview, PostBody

**Files:**
- Create: `apps/web/src/features/tokens/{tokenCache.ts,useTokenPanel.ts,TokenAvatar.tsx,TokenMention.tsx,TokenPreview.tsx,tokens.module.css}`
- Create: `apps/web/src/features/feed/{PostBody.tsx,PostBody.module.css}`
- Modify: `apps/web/src/layout/AppShell.tsx` (mount `useTokenEvents()`)
- Test: `apps/web/test/TokenMention.test.tsx`, `apps/web/test/PostBody.test.tsx`

**Interfaces:**
- Consumes: `post('/tokens/resolve')`, socket `token:resolved`, `useRoom`.
- Produces:
  - `tokenKey(mint) = ['token', mint]`; `primeTokens(qc, tokens?: Record<string, TokenView>)`; `useToken(mint): TokenView` (never throws; network failure → `status: 'error'`); `useTokenEvents()` (global listener)
  - `useTokenPanel(): { mint: string | null; openToken(mint: string, trigger?: HTMLElement | null): void; close(): void }` — state in `?token=<mint>`; `close()` returns focus to the trigger
  - `<TokenAvatar token size/>`, `<TokenMention mint/>`, `<TokenPreview token onOpen/>`, `<PostBody text/>`
  - `provenance(token: TokenView, now?: number): string` — e.g. `DEMO data — fictional token, not on-chain`, `Live · Dexscreener · fetched 2m ago`, `Verified mint · no trading pair found`, `Couldn’t load: …`, `Looking up this address…`

- [ ] **Step 1: Failing tests**

`apps/web/test/TokenMention.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { TokenView } from '@shillex/shared';
import { renderWithApp, mockFetch } from './utils';
import { TokenMention } from '../src/features/tokens/TokenMention';
import { useTokenPanel } from '../src/features/tokens/useTokenPanel';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const base: TokenView = { mint: MINT, status: 'resolved', source: 'live', name: 'Bonk', symbol: 'BONK', imageUrl: null, decimals: 5, liquidityUsd: 380000, marketCapUsd: 295000000, fdvUsd: null, pairAddress: null, dexId: 'orca', pairCreatedAt: '2022-12-25T00:00:00Z', promoted: false, fetchedAt: new Date().toISOString(), error: null };
const seed = (t: Partial<TokenView>) => (qc: any) => qc.setQueryData(['token', MINT], { ...base, ...t });
function PanelProbe() { const { mint } = useTokenPanel(); return <output data-testid="panel">{mint ?? ''}</output>; }

describe('TokenMention', () => {
  it('resolved: shows ticker, abbreviated address, full address accessible', () => {
    renderWithApp(<TokenMention mint={MINT} />, { seed: seed({}) });
    const chip = screen.getByRole('button', { name: new RegExp(MINT) });
    expect(chip).toHaveTextContent('$BONK');
    expect(chip).toHaveTextContent('DezX…B263');
  });
  it('demo tokens carry a DEMO tag', () => {
    renderWithApp(<TokenMention mint={MINT} />, { seed: seed({ source: 'demo' }) });
    expect(screen.getByText('DEMO')).toBeInTheDocument();
  });
  it('unindexed and error states are labeled honestly', () => {
    const { unmount } = renderWithApp(<TokenMention mint={MINT} />, { seed: seed({ status: 'unindexed', symbol: null, name: null }) });
    expect(screen.getByRole('button')).toHaveTextContent('Unindexed mint');
    unmount();
    renderWithApp(<TokenMention mint={MINT} />, { seed: seed({ status: 'error', symbol: null, error: 'dexscreener http 429' }) });
    expect(screen.getByRole('button')).toHaveTextContent('Couldn’t load');
  });
  it('not_a_token renders as plain text, not a button', () => {
    renderWithApp(<TokenMention mint={MINT} />, { seed: seed({ status: 'not_a_token' }) });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(MINT)).toBeInTheDocument();
  });
  it('pending: fetches via batch resolve and shows loading', async () => {
    const f = mockFetch({ '/api/tokens/resolve': { tokens: { [MINT]: { ...base, symbol: 'LATE' } } } });
    renderWithApp(<TokenMention mint={MINT} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('$LATE'));
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('focus opens the preview; click opens the side panel via the URL', async () => {
    renderWithApp(<><TokenMention mint={MINT} /><PanelProbe /></>, { seed: seed({}) });
    const chip = screen.getByRole('button', { name: new RegExp(MINT) });
    fireEvent.focus(chip);
    expect(await screen.findByRole('dialog')).toHaveTextContent('Live · Dexscreener');
    fireEvent.click(chip);
    expect(screen.getByTestId('panel')).toHaveTextContent(MINT);
  });
});
```

`apps/web/test/PostBody.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp } from './utils';
import { PostBody } from '../src/features/feed/PostBody';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
describe('PostBody', () => {
  it('renders mentions as profile links, urls as safe external links, mints as token chips', () => {
    renderWithApp(<PostBody text={`gm @alpha_jane see https://example.com/x and ${MINT}`} />, {
      seed: (qc) => qc.setQueryData(['token', MINT], { mint: MINT, status: 'resolved', source: 'demo', symbol: 'GRUB', name: 'Grubworm', imageUrl: null, decimals: null, liquidityUsd: null, marketCapUsd: null, fdvUsd: null, pairAddress: null, dexId: null, pairCreatedAt: null, promoted: false, fetchedAt: null, error: null }),
    });
    expect(screen.getByRole('link', { name: '@alpha_jane' })).toHaveAttribute('href', '/u/alpha_jane');
    const ext = screen.getByRole('link', { name: /example\.com/ });
    expect(ext).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(ext).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('button', { name: new RegExp(MINT) })).toHaveTextContent('$GRUB');
  });
  it('never renders HTML from text', () => {
    renderWithApp(<PostBody text={'<img src=x onerror=alert(1)>'} />);
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });
});
```

Run: `npm test -w @shillex/web` → FAIL (modules missing).

- [ ] **Step 2: Token cache and panel hook**

`apps/web/src/features/tokens/tokenCache.ts`:
```ts
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { TokenView } from '@shillex/shared';
import { errorMessage, post } from '../../lib/api';
import { useRoom, useSocketEvent } from '../../lib/socket';

export const tokenKey = (mint: string) => ['token', mint] as const;
export const pendingView = (mint: string): TokenView => ({ mint, status: 'pending', source: null, name: null, symbol: null, imageUrl: null, decimals: null, liquidityUsd: null, marketCapUsd: null, fdvUsd: null, pairAddress: null, dexId: null, pairCreatedAt: null, promoted: false, fetchedAt: null, error: null });

const rank = (t: TokenView) => (t.status === 'pending' ? 0 : 1);
export function primeTokens(qc: QueryClient, tokens?: Record<string, TokenView>) {
  if (!tokens) return;
  for (const [mint, v] of Object.entries(tokens)) {
    const prev = qc.getQueryData<TokenView>(tokenKey(mint));
    if (!prev || rank(v) > rank(prev) || (rank(v) === rank(prev) && (v.fetchedAt ?? '') >= (prev.fetchedAt ?? ''))) qc.setQueryData(tokenKey(mint), v);
  }
}

let queue = new Map<string, { resolve: (v: TokenView) => void; reject: (e: unknown) => void }[]>();
let timer: ReturnType<typeof setTimeout> | null = null;
function flush() {
  const batch = queue; queue = new Map(); timer = null;
  const mints = [...batch.keys()];
  for (let i = 0; i < mints.length; i += 25) {
    const chunk = mints.slice(i, i + 25);
    post<{ tokens: Record<string, TokenView> }>('/tokens/resolve', { mints: chunk })
      .then((r) => chunk.forEach((m) => batch.get(m)!.forEach((w) => w.resolve(r.tokens[m] ?? pendingView(m)))))
      .catch((e) => chunk.forEach((m) => batch.get(m)!.forEach((w) => w.reject(e))));
  }
}
function loadToken(mint: string): Promise<TokenView> {
  return new Promise((resolve, reject) => {
    queue.set(mint, [...(queue.get(mint) ?? []), { resolve, reject }]);
    timer ??= setTimeout(flush, 15);
  });
}

export function useToken(mint: string): TokenView {
  const q = useQuery({
    queryKey: tokenKey(mint), queryFn: () => loadToken(mint), staleTime: Infinity,
    refetchInterval: (query) => (query.state.data?.status === 'pending' && query.state.dataUpdateCount < 6 ? 4000 : false),
  });
  const view = q.data ?? (q.error ? { ...pendingView(mint), status: 'error' as const, error: errorMessage(q.error) } : pendingView(mint));
  useRoom('token', view.status === 'pending' ? mint : null);
  return view;
}

export function useTokenEvents() {
  const qc = useQueryClient();
  useSocketEvent('token:resolved', ({ token }) => {
    qc.setQueryData(tokenKey(token.mint), token);
    qc.invalidateQueries({ queryKey: ['tokenDetail', token.mint] });
  });
}
```

`apps/web/src/features/tokens/useTokenPanel.ts`:
```ts
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { isValidSolanaAddress } from '@shillex/shared';

let lastTrigger: HTMLElement | null = null;
export function useTokenPanel() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('token');
  const mint = raw && isValidSolanaAddress(raw) ? raw : null;
  const openToken = useCallback((m: string, trigger?: HTMLElement | null) => {
    lastTrigger = trigger ?? (document.activeElement as HTMLElement | null);
    setParams((p) => { const n = new URLSearchParams(p); n.set('token', m); return n; }, { preventScrollReset: true });
  }, [setParams]);
  const close = useCallback(() => {
    setParams((p) => { const n = new URLSearchParams(p); n.delete('token'); return n; }, { preventScrollReset: true });
    const t = lastTrigger; lastTrigger = null;
    if (t?.isConnected) requestAnimationFrame(() => t.focus());
  }, [setParams]);
  return { mint, openToken, close };
}
```

- [ ] **Step 3: Chip, avatar, preview**

`apps/web/src/features/tokens/tokens.module.css`:
```css
.chip { display: inline-flex; align-items: center; gap: 5px; height: 22px; max-width: 100%; padding: 0 6px 0 3px; margin: 0 1px; vertical-align: -5px;
  border: 1px solid var(--token-line); border-radius: 6px; background: var(--token-soft); color: var(--token); font: 500 12.5px/1 var(--font-ui); cursor: pointer; }
.chip:hover { background: rgba(61, 214, 245, .18); }
.chip[aria-busy='true'] { color: var(--muted); border-color: var(--line-strong); background: var(--raised); }
.chip.unindexed, .chip.error { color: var(--muted); border-style: dashed; border-color: var(--line-strong); background: transparent; }
.sym { font-weight: 600; }
.addr { font: 400 11px/1 var(--font-mono); opacity: .8; }
.plain { font-family: var(--font-mono); font-size: .92em; overflow-wrap: anywhere; color: var(--muted); }
.demo { padding: 2px 4px; border-radius: 3px; background: var(--warn-soft); color: var(--warn); font: 600 9px/1 var(--font-mono); letter-spacing: .05em; }
.tokAvatar { flex: none; border-radius: 50%; background: var(--raised); object-fit: cover; }
.loadingDot { width: 14px; height: 14px; border-radius: 50%; background: var(--line-strong); }
.preview { padding: 12px; display: grid; gap: 10px; }
.pvHead { display: flex; gap: 10px; align-items: center; }
.pvName { font-weight: 600; }
.pvSub { color: var(--muted); font-size: var(--fs-sm); }
.pvStats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.stat { padding: 6px 8px; border-radius: var(--radius-sm); background: var(--panel); }
.statLabel { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
.statValue { font: 500 12.5px var(--font-mono); }
.pvAddr { display: flex; gap: 6px; align-items: center; font: 400 11px var(--font-mono); color: var(--muted); overflow-wrap: anywhere; }
.pvActions { display: flex; gap: 6px; }
```

`apps/web/src/features/tokens/TokenAvatar.tsx`:
```tsx
import { useState } from 'react';
import type { TokenView } from '@shillex/shared';
import s from './tokens.module.css';
export function TokenAvatar({ token, size = 16 }: { token: TokenView; size?: number }) {
  const [broken, setBroken] = useState(false);
  const src = !broken && token.imageUrl ? token.imageUrl : `/media/token/${token.mint}.svg`;
  return <img className={s.tokAvatar} src={src} width={size} height={size} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}
```

`apps/web/src/features/tokens/TokenPreview.tsx`:
```tsx
import { Copy, PanelRightOpen } from 'lucide-react';
import { COPY, abbreviateMint, formatAge, formatUsd, relativeTime, type TokenView } from '@shillex/shared';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { toast } from '../../components/ui/Toaster';
import { TokenAvatar } from './TokenAvatar';
import s from './tokens.module.css';

export function provenance(t: TokenView, now = Date.now()): string {
  if (t.source === 'demo') return `${COPY.demoTag} data — fictional token, not on-chain`;
  switch (t.status) {
    case 'pending': return 'Looking up this address…';
    case 'resolved': return `Live · Dexscreener · fetched ${t.fetchedAt ? relativeTime(t.fetchedAt, now) : 'just now'}${t.fetchedAt && relativeTime(t.fetchedAt, now) !== 'now' ? ' ago' : ''}`;
    case 'unindexed': return 'Verified token mint · no trading pair found on Dexscreener';
    case 'error': return `Couldn’t load: ${t.error ?? 'unknown error'}`;
    case 'not_a_token': return 'Not a token mint';
  }
}
export async function copyAddress(mint: string) {
  try { await navigator.clipboard.writeText(mint); toast('Address copied', { tone: 'success' }); }
  catch { toast('Couldn’t copy — select the address instead', { tone: 'error' }); }
}

export function TokenPreview({ token, onOpen }: { token: TokenView; onOpen: () => void }) {
  const title = token.name ?? (token.status === 'unindexed' ? 'Unindexed mint' : token.status === 'error' ? 'Unavailable' : 'Token');
  return (
    <div className={s.preview}>
      <div className={s.pvHead}>
        <TokenAvatar token={token} size={34} />
        <div style={{ minWidth: 0 }}>
          <div className={s.pvName}>{title} {token.symbol && <span className="mono" style={{ color: 'var(--token)' }}>${token.symbol}</span>} {token.source === 'demo' && <Badge tone="demo">DEMO</Badge>} {token.promoted && <Badge tone="promoted">{COPY.promoted}</Badge>}</div>
          <div className={s.pvSub}>{provenance(token)}</div>
        </div>
      </div>
      {(token.status === 'resolved' || token.status === 'unindexed') && (
        <div className={s.pvStats}>
          <div className={s.stat}><div className={s.statLabel}>Age</div><div className={s.statValue}>{formatAge(token.pairCreatedAt)}</div></div>
          <div className={s.stat}><div className={s.statLabel}>Liquidity</div><div className={s.statValue}>{formatUsd(token.liquidityUsd)}</div></div>
          <div className={s.stat}><div className={s.statLabel}>Mkt cap</div><div className={s.statValue}>{formatUsd(token.marketCapUsd)}</div></div>
        </div>
      )}
      <div className={s.pvAddr}><span title={token.mint}>{abbreviateMint(token.mint, 8, 8)}</span><IconButton label="Copy full address" onClick={() => copyAddress(token.mint)}><Copy size={13} /></IconButton></div>
      <div className={s.pvActions}><Button size="sm" variant="primary" icon={<PanelRightOpen size={14} />} onClick={onOpen}>Open token panel</Button></div>
    </div>
  );
}
```

`apps/web/src/features/tokens/TokenMention.tsx`:
```tsx
import { useId, useRef, useState } from 'react';
import { abbreviateMint } from '@shillex/shared';
import { Popover } from '../../components/ui/Popover';
import { cx } from '../../lib/cx';
import { useToken } from './tokenCache';
import { useTokenPanel } from './useTokenPanel';
import { TokenAvatar } from './TokenAvatar';
import { TokenPreview } from './TokenPreview';
import s from './tokens.module.css';

export function TokenMention({ mint }: { mint: string }) {
  const token = useToken(mint);
  const { openToken } = useTokenPanel();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touch = useRef(false);
  const previewId = useId();
  const later = (fn: () => void, ms: number) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(fn, ms); };
  const cancel = () => { if (timer.current) clearTimeout(timer.current); };

  if (token.status === 'not_a_token') return <span className={s.plain} title="Not a token mint">{mint}</span>;
  const label = token.status === 'pending' ? 'Loading' : token.symbol ? `$${token.symbol}` : token.status === 'unindexed' ? 'Unindexed mint' : token.status === 'error' ? 'Couldn’t load' : token.name ?? 'Token';
  const a11y = `Token ${token.symbol ? `$${token.symbol} ` : ''}${token.source === 'demo' ? '(demo) ' : ''}${mint}. Open token panel`;

  return (
    <>
      <button ref={ref} type="button" className={cx(s.chip, s[token.status])} aria-label={a11y} aria-busy={token.status === 'pending' || undefined}
        aria-describedby={open ? previewId : undefined} aria-expanded={open}
        onPointerDown={(e) => { touch.current = e.pointerType === 'touch'; }}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') later(() => setOpen(true), 300); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') later(() => setOpen(false), 150); }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => { if (!document.getElementById(previewId)?.contains(e.relatedTarget as Node)) later(() => setOpen(false), 150); }}
        onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}
        onClick={(e) => {
          e.stopPropagation(); e.preventDefault();
          if (touch.current && !open) { setOpen(true); return; }
          setOpen(false); openToken(mint, ref.current);
        }}>
        {token.status === 'pending' ? <span className={s.loadingDot} aria-hidden="true" /> : <TokenAvatar token={token} size={15} />}
        <span className={s.sym}>{label}</span>
        <span className={s.addr} aria-hidden="true">{abbreviateMint(mint)}</span>
        {token.source === 'demo' && <span className={s.demo} aria-hidden="true">DEMO</span>}
      </button>
      <Popover anchor={ref.current} open={open} id={previewId} onPointerEnter={cancel} onPointerLeave={() => later(() => setOpen(false), 150)}>
        <TokenPreview token={token} onOpen={() => { setOpen(false); openToken(mint, ref.current); }} />
      </Popover>
    </>
  );
}
```
Note: `aria-label` includes the full address and "(demo)", so the visible `DEMO` tag can be `aria-hidden`. The test `getByText('DEMO')` still finds the visible tag.

- [ ] **Step 4: PostBody**

`apps/web/src/features/feed/PostBody.module.css`:
```css
.body { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; }
.link { color: var(--token); text-decoration: underline; text-decoration-color: rgba(61, 214, 245, .35); text-underline-offset: 2px; }
.mention { color: var(--accent); font-weight: 500; }
.mention:hover { text-decoration: underline; }
```

`apps/web/src/features/feed/PostBody.tsx`:
```tsx
import { Fragment, useMemo } from 'react';
import { Link } from 'react-router';
import { tokenizeBody } from '@shillex/shared';
import { cx } from '../../lib/cx';
import { TokenMention } from '../tokens/TokenMention';
import s from './PostBody.module.css';

const pretty = (href: string) => { const u = href.replace(/^https?:\/\/(www\.)?/, ''); return u.length > 48 ? `${u.slice(0, 45)}…` : u; };

export function PostBody({ text, className }: { text: string; className?: string }) {
  const segs = useMemo(() => tokenizeBody(text), [text]);
  return (
    <div className={cx(s.body, className)}>
      {segs.map((seg, i) => {
        switch (seg.type) {
          case 'text': return <Fragment key={i}>{seg.text}</Fragment>;
          case 'url': return <a key={i} className={s.link} href={seg.href} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()}>{pretty(seg.href)}</a>;
          case 'mention': return <Link key={i} className={s.mention} to={`/u/${seg.username}`} onClick={(e) => e.stopPropagation()}>@{seg.username}</Link>;
          case 'mint': return <TokenMention key={i} mint={seg.mint} />;
        }
      })}
    </div>
  );
}
```

In `AppShell.tsx` add near the top of the component: `useTokenEvents();` (import from `../features/tokens/tokenCache`).

- [ ] **Step 5: Run and commit**

Run: `npm test -w @shillex/web && npm run typecheck -w @shillex/web` → PASS.
```bash
git add apps/web
git commit -m "feat(web): token data layer, interactive CA chips with preview, safe post body rendering"
```

---

### Task 18: Feed, post card, composer, threads, bookmarks

**Files:**
- Create: `apps/web/src/lib/cache.ts`
- Create: `apps/web/src/features/feed/{postActions.ts,PostCard.tsx,PostCard.module.css,MediaGrid.tsx,QuoteEmbed.tsx,ReactionBar.tsx,CallUpdates.tsx,Composer.tsx,Composer.module.css,FeedList.tsx,NewPostsPill.tsx,HomePage.tsx,ThreadPage.tsx,BookmarksPage.tsx,ReportDialog.tsx,PostSkeleton.tsx}`
- Modify: `apps/web/src/routes.tsx` (`/`, `/p/:id`, `/bookmarks`)
- Test: `apps/web/test/cache.test.ts`, `apps/web/test/Composer.test.tsx`, `apps/web/test/PostCard.test.tsx`

**Interfaces:**
- Consumes: Task 17 (`PostBody`, `primeTokens`), `api` helpers, server post routes.
- Produces:
  - `patchPost(qc, postId, fn: (p: PostView) => PostView)`, `removePost(qc, postId)`, `prependToFeed(qc, key: QueryKey, post: PostView)` in `lib/cache.ts`; also `type PostPages = InfiniteData<Page<PostView>>`
  - `usePostActions(post: PostView)` → `{ react(emoji), toggleBookmark(), toggleRepost(), toggleSubscribe(), remove(), copyLink() }`
  - `useUserActions(user: UserSummary)` → `{ follow(on: boolean), mute(on), block(on) }`
  - `<PostCard post compact? focused? onReply?/>`, `<Composer mode parent? quote? communityId? onPosted? autoFocus? placeholder?/>`, `<FeedList queryKey path emptyState/>` (generic infinite list of posts), `<ReportDialog target onClose/>`, `<CallUpdates post/>`, `<PostSkeleton/>`
  - Pages: `HomePage` (tabs in `?tab=following|discover`), `ThreadPage`, `BookmarksPage`

- [ ] **Step 1: Failing tests**

`apps/web/test/cache.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { PostView } from '@shillex/shared';
import { patchPost, removePost, prependToFeed } from '../src/lib/cache';

const p = (id: string, extra: Partial<PostView> = {}): PostView => ({
  id, kind: 'post', author: { id: 'a', username: 'a', displayName: 'A', avatarUrl: '', isDemo: true }, body: id, createdAt: '', deleted: false,
  parentId: null, rootId: null, replyTo: null, community: null, media: [], quoted: null, reposted: null,
  counts: { replies: 0, reposts: 0, quotes: 0 }, reactions: [], viewer: { bookmarked: false, reposted: false, subscribed: false, canAddCallUpdate: false }, mints: [], callUpdates: [], ...extra,
});

describe('post cache helpers', () => {
  it('patches a post everywhere it appears, including inside quotes and reposts', () => {
    const qc = new QueryClient();
    qc.setQueryData(['feed', 'following'], { pages: [{ items: [p('1'), p('2', { kind: 'repost', reposted: p('1') }), p('3', { kind: 'quote', quoted: p('1') })], nextCursor: null }], pageParams: [null] });
    qc.setQueryData(['thread', '1'], { post: p('1'), ancestors: [], replies: [], tokens: {} });
    patchPost(qc, '1', (x) => ({ ...x, viewer: { ...x.viewer, bookmarked: true } }));
    const feed: any = qc.getQueryData(['feed', 'following']);
    expect(feed.pages[0].items[0].viewer.bookmarked).toBe(true);
    expect(feed.pages[0].items[1].reposted.viewer.bookmarked).toBe(true);
    expect(feed.pages[0].items[2].quoted.viewer.bookmarked).toBe(true);
    expect((qc.getQueryData(['thread', '1']) as any).post.viewer.bookmarked).toBe(true);
  });
  it('removes and prepends', () => {
    const qc = new QueryClient();
    qc.setQueryData(['feed', 'following'], { pages: [{ items: [p('1'), p('2')], nextCursor: null }], pageParams: [null] });
    removePost(qc, '1');
    prependToFeed(qc, ['feed', 'following'], p('9'));
    expect((qc.getQueryData(['feed', 'following']) as any).pages[0].items.map((x: PostView) => x.id)).toEqual(['9', '2']);
  });
});
```

`apps/web/test/Composer.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithApp, mockFetch } from './utils';
import { Composer } from '../src/features/feed/Composer';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
describe('Composer', () => {
  it('disables posting when empty or over 1000 code points; counts emoji as one', async () => {
    renderWithApp(<Composer mode="post" />);
    const box = screen.getByRole('textbox', { name: /what’s happening|post/i });
    const submit = screen.getByRole('button', { name: 'Post' });
    expect(submit).toBeDisabled();
    fireEvent.change(box, { target: { value: '🔥'.repeat(1000) } });
    expect(submit).toBeEnabled();
    fireEvent.change(box, { target: { value: '🔥'.repeat(1001) } });
    expect(submit).toBeDisabled();
    expect(screen.getByText('-1')).toBeInTheDocument();
  });
  it('previews detected contract addresses as chips while typing', async () => {
    mockFetch({ '/api/tokens/resolve': { tokens: {} } });
    renderWithApp(<Composer mode="post" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: `watching ${MINT}` } });
    expect(await screen.findByRole('button', { name: new RegExp(MINT) })).toBeInTheDocument();
  });
  it('submits with Ctrl+Enter, clears, and surfaces server errors', async () => {
    let n = 0;
    mockFetch({ '/api/posts': () => (++n === 1 ? new Response(JSON.stringify({ code: 'EMPTY_BODY', message: 'Write something first' }), { status: 400 }) : { post: { id: 'p1' }, tokens: {} }) });
    renderWithApp(<Composer mode="post" />);
    const box = screen.getByRole('textbox');
    await userEvent.type(box, 'gm');
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(await screen.findByRole('alert')).toHaveTextContent('Write something first');
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(box).toHaveValue(''));
  });
});
```

`apps/web/test/PostCard.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import type { PostView } from '@shillex/shared';
import { renderWithApp } from './utils';
import { PostCard } from '../src/features/feed/PostCard';

const author = { id: 'a', username: 'alpha_jane', displayName: 'Jane', avatarUrl: '/a.svg', isDemo: true };
const post: PostView = {
  id: 'p1', kind: 'post', author, body: 'watching this one', createdAt: new Date().toISOString(), deleted: false, parentId: null, rootId: null, replyTo: null,
  community: null, media: [], quoted: null, reposted: null, counts: { replies: 3, reposts: 1, quotes: 0 },
  reactions: [{ emoji: '🔥', count: 4, mine: true }], viewer: { bookmarked: false, reposted: false, subscribed: true, canAddCallUpdate: false },
  mints: [], callUpdates: [{ id: 'c1', status: 'bought', note: 'small', selfReported: true, createdAt: new Date().toISOString() }],
};
describe('PostCard', () => {
  it('renders author, body, counts, pressed reaction and self-reported call updates', () => {
    renderWithApp(<PostCard post={post} />);
    expect(screen.getByRole('link', { name: 'Jane' })).toHaveAttribute('href', '/u/alpha_jane');
    expect(screen.getByText('watching this one')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reply.*3/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /🔥 4/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Bought')).toBeInTheDocument();
    expect(screen.getByText('self-reported')).toBeInTheDocument();
  });
  it('shows repost attribution and a tombstone for deleted posts', () => {
    renderWithApp(<PostCard post={{ ...post, id: 'r1', kind: 'repost', body: '', author: { ...author, displayName: 'Dan', username: 'dex_dan' }, reposted: { ...post, deleted: true, body: '' } }} />);
    expect(screen.getByText(/Dan reposted/)).toBeInTheDocument();
    expect(screen.getByText('This post was deleted.')).toBeInTheDocument();
  });
});
```

Run: `npm test -w @shillex/web` → FAIL.

- [ ] **Step 2: Cache helpers**

`apps/web/src/lib/cache.ts`:
```ts
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';
import type { Page, PostView, ThreadView } from '@shillex/shared';

export type PostPages = InfiniteData<Page<PostView>>;
const LIST_PREFIXES: QueryKey[] = [['feed'], ['userPosts'], ['bookmarks'], ['tokenPosts'], ['communityThreads']];

function mapPost(p: PostView, id: string, fn: (p: PostView) => PostView): PostView {
  let next = p.id === id ? fn(p) : p;
  if (next.quoted) { const q = mapPost(next.quoted, id, fn); if (q !== next.quoted) next = { ...next, quoted: q }; }
  if (next.reposted) { const r = mapPost(next.reposted, id, fn); if (r !== next.reposted) next = { ...next, reposted: r }; }
  return next;
}
const mapPages = (d: PostPages | undefined, f: (items: PostView[]) => PostView[]) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: f(pg.items) })) };

export function patchPost(qc: QueryClient, id: string, fn: (p: PostView) => PostView) {
  for (const prefix of LIST_PREFIXES) qc.setQueriesData<PostPages>({ queryKey: prefix }, (d) => mapPages(d, (items) => items.map((p) => mapPost(p, id, fn))));
  qc.setQueriesData<ThreadView>({ queryKey: ['thread'] }, (t) => t && {
    ...t, post: mapPost(t.post, id, fn), ancestors: t.ancestors.map((p) => mapPost(p, id, fn)), replies: t.replies.map((p) => mapPost(p, id, fn)),
  });
}
export function removePost(qc: QueryClient, id: string) {
  for (const prefix of LIST_PREFIXES) qc.setQueriesData<PostPages>({ queryKey: prefix }, (d) => mapPages(d, (items) => items.filter((p) => p.id !== id && p.reposted?.id !== id)));
  qc.setQueriesData<ThreadView>({ queryKey: ['thread'] }, (t) => t && { ...t, replies: t.replies.filter((p) => p.id !== id) });
}
export function prependToFeed(qc: QueryClient, key: QueryKey, post: PostView) {
  qc.setQueryData<PostPages>(key, (d) => d && { ...d, pages: d.pages.map((pg, i) => (i === 0 ? { ...pg, items: [post, ...pg.items.filter((x) => x.id !== post.id)] } : pg)) });
}
```

- [ ] **Step 3: Actions**

`apps/web/src/features/feed/postActions.ts`:
```ts
import { useQueryClient } from '@tanstack/react-query';
import type { PostView, ReactionEmoji, ReactionSummary, UserSummary } from '@shillex/shared';
import { del, errorMessage, post as apiPost, put } from '../../lib/api';
import { patchPost, removePost } from '../../lib/cache';
import { toast } from '../../components/ui/Toaster';

export function usePostActions(p: PostView) {
  const qc = useQueryClient();
  const target = p.kind === 'repost' && p.reposted ? p.reposted : p;
  const optimistic = async (apply: (x: PostView) => PostView, revert: (x: PostView) => PostView, call: () => Promise<unknown>) => {
    patchPost(qc, target.id, apply);
    try { await call(); } catch (e) { patchPost(qc, target.id, revert); toast(errorMessage(e), { tone: 'error' }); }
  };
  return {
    target,
    react: (emoji: ReactionEmoji) => {
      const had = target.reactions.find((r) => r.emoji === emoji)?.mine ?? false;
      const toggle = (on: boolean) => (x: PostView): PostView => {
        const list = [...x.reactions];
        const i = list.findIndex((r) => r.emoji === emoji);
        if (i === -1 && on) list.push({ emoji, count: 1, mine: true });
        else if (i !== -1) { const r = list[i]!; const count = r.count + (on ? 1 : -1); if (count <= 0) list.splice(i, 1); else list[i] = { ...r, count, mine: on }; }
        return { ...x, reactions: list as ReactionSummary[] };
      };
      const path = `/posts/${target.id}/reactions/${encodeURIComponent(emoji)}`;
      return optimistic(toggle(!had), toggle(had), () => (had ? del(path) : put(path)));
    },
    toggleBookmark: () => {
      const on = !target.viewer.bookmarked;
      const set = (v: boolean) => (x: PostView) => ({ ...x, viewer: { ...x.viewer, bookmarked: v } });
      return optimistic(set(on), set(!on), async () => { await (on ? put(`/posts/${target.id}/bookmark`) : del(`/posts/${target.id}/bookmark`)); toast(on ? 'Saved to bookmarks' : 'Removed from bookmarks'); qc.invalidateQueries({ queryKey: ['bookmarks'] }); });
    },
    toggleRepost: () => {
      const on = !target.viewer.reposted;
      const set = (v: boolean) => (x: PostView) => ({ ...x, viewer: { ...x.viewer, reposted: v }, counts: { ...x.counts, reposts: x.counts.reposts + (v ? 1 : -1) } });
      return optimistic(set(on), set(!on), async () => { await (on ? apiPost(`/posts/${target.id}/repost`) : del(`/posts/${target.id}/repost`)); qc.invalidateQueries({ queryKey: ['feed', 'following'] }); });
    },
    toggleSubscribe: () => {
      const on = !target.viewer.subscribed;
      const set = (v: boolean) => (x: PostView) => ({ ...x, viewer: { ...x.viewer, subscribed: v } });
      return optimistic(set(on), set(!on), async () => { await (on ? put(`/posts/${target.id}/subscription`) : del(`/posts/${target.id}/subscription`)); toast(on ? 'You’ll be notified about replies and call updates' : 'Unsubscribed'); });
    },
    remove: async () => {
      try { await del(`/posts/${target.id}`); removePost(qc, target.id); toast('Post deleted'); }
      catch (e) { toast(errorMessage(e), { tone: 'error' }); }
    },
    copyLink: async () => {
      try { await navigator.clipboard.writeText(`${location.origin}/p/${target.id}`); toast('Link copied', { tone: 'success' }); }
      catch { toast('Couldn’t copy link', { tone: 'error' }); }
    },
  };
}

export function useUserActions(u: UserSummary) {
  const qc = useQueryClient();
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok); qc.invalidateQueries({ queryKey: ['profile', u.username] }); qc.invalidateQueries({ queryKey: ['feed'] }); qc.invalidateQueries({ queryKey: ['sidebar'] }); }
    catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };
  return {
    follow: (on: boolean) => run(() => (on ? put(`/users/${u.username}/follow`) : del(`/users/${u.username}/follow`)), on ? `Following @${u.username}` : `Unfollowed @${u.username}`),
    mute: (on: boolean) => run(() => (on ? put(`/users/${u.username}/mute`) : del(`/users/${u.username}/mute`)), on ? `Muted @${u.username}` : `Unmuted @${u.username}`),
    block: (on: boolean) => run(() => (on ? put(`/users/${u.username}/block`) : del(`/users/${u.username}/block`)), on ? `Blocked @${u.username}` : `Unblocked @${u.username}`),
  };
}
```

- [ ] **Step 4: Post card and parts**

`apps/web/src/features/feed/PostCard.module.css`:
```css
.card { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line); background: var(--bg); cursor: pointer; }
.card:hover { background: #10151e; }
.card:focus-within { background: #10151e; }
.focused { cursor: default; background: var(--panel); }
.focused .body { font-size: var(--fs-lg); }
.compact { padding: 10px 12px; grid-template-columns: 32px minmax(0, 1fr); }
.meta { display: flex; align-items: baseline; gap: 6px; min-width: 0; white-space: nowrap; }
.name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.handle, .time { color: var(--muted); font-size: var(--fs-sm); }
.time:hover { text-decoration: underline; }
.context { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; margin: -2px 0 -4px 26px; color: var(--muted); font-size: var(--fs-sm); }
.replyTo { color: var(--muted); font-size: var(--fs-sm); margin-top: 2px; }
.replyTo a { color: var(--accent); }
.body { margin-top: 3px; }
.communityTag { display: inline-flex; align-items: center; gap: 4px; margin-left: 4px; padding: 1px 6px; border-radius: 4px; background: var(--raised); color: var(--muted); font-size: var(--fs-xs); }
.actions { display: flex; align-items: center; gap: 2px; margin: 6px 0 -4px -8px; color: var(--muted); }
.action { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 8px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--muted); font: 500 12px var(--font-mono); }
.action:hover { background: var(--hover); color: var(--text); }
.action[aria-pressed='true'] { color: var(--accent); }
.tombstone { padding: 10px 12px; border: 1px dashed var(--line-strong); border-radius: var(--radius); color: var(--muted); font-size: var(--fs-sm); }
.quote { margin-top: 8px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); }
.quote:hover { border-color: var(--line-strong); }
.reactions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.reaction { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 7px; border: 1px solid var(--line); border-radius: var(--radius-pill); background: var(--panel); font: 500 12px var(--font-mono); color: var(--muted); }
.reaction[aria-pressed='true'] { border-color: rgba(200, 241, 53, .45); background: var(--accent-soft); color: var(--text); }
.calls { margin-top: 10px; padding: 8px 10px; border-left: 2px solid var(--line-strong); display: grid; gap: 6px; }
.call { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; font-size: var(--fs-sm); }
.callStatus { padding: 1px 6px; border-radius: 4px; background: var(--raised); font-weight: 600; }
.status_bought { color: var(--up); } .status_out { color: var(--down); } .status_taking_profit { color: var(--accent); } .status_thesis_changed { color: var(--warn); } .status_watching { color: var(--token); }
.selfReported { color: var(--muted); font: 500 10px var(--font-mono); text-transform: uppercase; letter-spacing: .06em; }
.media { display: grid; gap: 4px; margin-top: 8px; border-radius: var(--radius); overflow: hidden; }
.media img { width: 100%; height: 100%; object-fit: cover; background: var(--raised); }
.media button { padding: 0; border: 0; background: none; }
.media1 { grid-template-columns: 1fr; max-height: 420px; } .media2 { grid-template-columns: 1fr 1fr; aspect-ratio: 16/9; }
.media3, .media4 { grid-template-columns: 1fr 1fr; grid-auto-rows: 1fr; aspect-ratio: 16/9; } .media3 > :first-child { grid-row: span 2; }
```

`apps/web/src/features/feed/MediaGrid.tsx`:
```tsx
import { useState } from 'react';
import type { MediaView } from '@shillex/shared';
import { Dialog } from '../../components/ui/Dialog';
import s from './PostCard.module.css';
export function MediaGrid({ media }: { media: MediaView[] }) {
  const [open, setOpen] = useState<MediaView | null>(null);
  if (!media.length) return null;
  return (
    <>
      <div className={`${s.media} ${s[`media${Math.min(media.length, 4)}`]}`} onClick={(e) => e.stopPropagation()}>
        {media.map((m) => (
          <button key={m.url} type="button" aria-label={`View image${m.alt ? `: ${m.alt}` : ''}`} onClick={() => setOpen(m)}>
            <img src={m.url} alt={m.alt} width={m.width} height={m.height} loading="lazy" />
          </button>
        ))}
      </div>
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open?.alt || 'Image'}>{open && <img src={open.url} alt={open.alt} style={{ maxHeight: '75vh', margin: '0 auto' }} />}</Dialog>
    </>
  );
}
```

`apps/web/src/features/feed/QuoteEmbed.tsx`:
```tsx
import { Link } from 'react-router';
import { relativeTime, type PostView } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { PostBody } from './PostBody';
import s from './PostCard.module.css';
export function QuoteEmbed({ post }: { post: PostView }) {
  if (post.deleted) return <div className={s.tombstone}>This post is unavailable.</div>;
  return (
    <Link to={`/p/${post.id}`} className={s.quote} style={{ display: 'block' }} onClick={(e) => e.stopPropagation()}>
      <div className={s.meta}><Avatar src={post.author.avatarUrl} size={18} /><span className={s.name}>{post.author.displayName}</span><span className={s.handle}>@{post.author.username} · {relativeTime(post.createdAt)}</span></div>
      <PostBody text={post.body.length > 280 ? `${post.body.slice(0, 280)}…` : post.body} className={s.body} />
    </Link>
  );
}
```

`apps/web/src/features/feed/ReactionBar.tsx`:
```tsx
import { SmilePlus } from 'lucide-react';
import { REACTIONS, type ReactionEmoji, type ReactionSummary } from '@shillex/shared';
import { Menu } from '../../components/ui/Menu';
import s from './PostCard.module.css';
export function ReactionPills({ reactions, onToggle, myId }: { reactions: ReactionSummary[]; onToggle: (e: ReactionEmoji) => void; myId?: string }) {
  if (!reactions.length) return null;
  return (
    <div className={s.reactions} onClick={(e) => e.stopPropagation()}>
      {reactions.map((r) => {
        const mine = r.userIds && myId ? r.userIds.includes(myId) : r.mine;
        return <button key={r.emoji} type="button" className={s.reaction} aria-pressed={mine} aria-label={`${r.emoji} ${r.count}${mine ? ', you reacted' : ''}`} onClick={() => onToggle(r.emoji)}>{r.emoji} {r.count}</button>;
      })}
    </div>
  );
}
export function ReactionPicker({ onPick }: { onPick: (e: ReactionEmoji) => void }) {
  return (
    <Menu label="Add reaction" items={REACTIONS.map((e) => ({ label: e, onSelect: () => onPick(e) }))}
      trigger={(p) => <button {...p} type="button" className={s.action} onClick={(e) => { e.stopPropagation(); p.onClick(); }}><SmilePlus size={15} aria-hidden="true" /></button>} />
  );
}
```

`apps/web/src/features/feed/CallUpdates.tsx`:
```tsx
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CALL_STATUSES, CALL_STATUS_LABELS, COPY, relativeTime, type CallStatus, type CallUpdateView, type PostView } from '@shillex/shared';
import { errorMessage, post } from '../../lib/api';
import { patchPost } from '../../lib/cache';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import s from './PostCard.module.css';

export function CallUpdates({ updates }: { updates: CallUpdateView[] }) {
  if (!updates.length) return null;
  return (
    <ol className={s.calls} aria-label="Call updates" onClick={(e) => e.stopPropagation()} style={{ listStyle: 'none', margin: '10px 0 0' }}>
      {updates.map((u) => (
        <li key={u.id} className={s.call}>
          <span className={`${s.callStatus} ${s[`status_${u.status}`]}`}>{CALL_STATUS_LABELS[u.status]}</span>
          {u.note && <span>{u.note}</span>}
          <span className={s.time}>{relativeTime(u.createdAt)}</span>
          <span className={s.selfReported} title="Posted by the author; not verified by Shillex">{COPY.selfReported}</span>
        </li>
      ))}
    </ol>
  );
}

export function AddCallUpdate({ p, open, onClose }: { p: PostView; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<CallStatus>('watching');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError(null);
    try {
      const r = await post<{ update: CallUpdateView; post: PostView }>(`/posts/${p.id}/call-updates`, { status, note: note.trim() || undefined });
      patchPost(qc, p.id, () => r.post);
      setNote(''); onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Add a call update" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Post update</Button></>}>
      <p style={{ marginTop: 0, color: 'var(--muted)' }}>Updates stay attached to this post and are labeled <strong>self-reported</strong>. They can’t be edited later.</p>
      <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <legend className="sr-only">Status</legend>
        {CALL_STATUSES.map((c) => (
          <label key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', border: '1px solid var(--line-strong)', borderRadius: 999, cursor: 'pointer', background: status === c ? 'var(--accent-soft)' : 'transparent' }}>
            <input type="radio" name="call-status" value={c} checked={status === c} onChange={() => setStatus(c)} />{CALL_STATUS_LABELS[c]}
          </label>
        ))}
      </fieldset>
      <label style={{ display: 'grid', gap: 6, color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>Note (optional)
        <textarea value={note} maxLength={280} rows={3} onChange={(e) => setNote(e.target.value)} style={{ resize: 'vertical', padding: 10, borderRadius: 6, border: '1px solid var(--line-strong)', background: 'var(--bg)' }} />
      </label>
      {error && <p role="alert" style={{ color: 'var(--down)' }}>{error}</p>}
    </Dialog>
  );
}
```

`apps/web/src/features/feed/ReportDialog.tsx`:
```tsx
import { useState } from 'react';
import { errorMessage, post } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { toast } from '../../components/ui/Toaster';

const REASONS = ['Spam or scam link', 'Impersonation', 'Harassment', 'Coordinated pump / fake hype', 'Something else'];
export function ReportDialog({ target, onClose }: { target: { type: 'post' | 'message' | 'user'; id: string } | null; onClose: () => void }) {
  const [reason, setReason] = useState(REASONS[0]!);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!target) return;
    setBusy(true);
    try { await post('/reports', { targetType: target.type, targetId: target.id, reason: details.trim() ? `${reason}: ${details.trim()}` : reason }); toast('Report sent to moderators', { tone: 'success' }); onClose(); }
    catch (e) { toast(errorMessage(e), { tone: 'error' }); } finally { setBusy(false); }
  }
  return (
    <Dialog open={!!target} onClose={onClose} title="Report" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} onClick={submit}>Send report</Button></>}>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        <legend style={{ marginBottom: 8, color: 'var(--muted)' }}>What’s wrong?</legend>
        {REASONS.map((r) => <label key={r} style={{ display: 'flex', gap: 8 }}><input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />{r}</label>)}
      </fieldset>
      <textarea aria-label="Details (optional)" placeholder="Details (optional)" value={details} maxLength={400} rows={3} onChange={(e) => setDetails(e.target.value)} style={{ width: '100%', marginTop: 12, padding: 10, borderRadius: 6, border: '1px solid var(--line-strong)', background: 'var(--bg)' }} />
    </Dialog>
  );
}
```

`apps/web/src/features/feed/PostCard.tsx`:
```tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Bookmark, Ellipsis, MessageCircle, Repeat2, Hash, Share } from 'lucide-react';
import { relativeTime, type PostView } from '@shillex/shared';
import { useRequiredMe } from '../../lib/useMe';
import { cx } from '../../lib/cx';
import { Avatar } from '../../components/ui/Avatar';
import { Menu } from '../../components/ui/Menu';
import { PostBody } from './PostBody';
import { MediaGrid } from './MediaGrid';
import { QuoteEmbed } from './QuoteEmbed';
import { ReactionPicker, ReactionPills } from './ReactionBar';
import { AddCallUpdate, CallUpdates } from './CallUpdates';
import { ReportDialog } from './ReportDialog';
import { Composer } from './Composer';
import { Dialog } from '../../components/ui/Dialog';
import { usePostActions, useUserActions } from './postActions';
import s from './PostCard.module.css';

export function PostCard({ post, focused, compact }: { post: PostView; focused?: boolean; compact?: boolean }) {
  const me = useRequiredMe();
  const nav = useNavigate();
  const a = usePostActions(post);
  const p = a.target;
  const userActions = useUserActions(p.author);
  const [report, setReport] = useState<{ type: 'post' | 'user'; id: string } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [replying, setReplying] = useState(false);
  const [addingCall, setAddingCall] = useState(false);
  const isMine = p.author.id === me.id;
  const open = (e: React.MouseEvent) => {
    if (focused || (e.target as HTMLElement).closest('a,button,input,textarea,dialog')) return;
    if (window.getSelection()?.toString()) return;
    nav(`/p/${p.id}`);
  };

  return (
    <article className={cx(s.card, focused && s.focused, compact && s.compact)} onClick={open} aria-labelledby={`post-${post.id}-author`}>
      {post.kind === 'repost' && <div className={s.context}><Repeat2 size={13} aria-hidden="true" /><Link to={`/u/${post.author.username}`}>{post.author.displayName} reposted</Link></div>}
      <Link to={`/u/${p.author.username}`} aria-hidden="true" tabIndex={-1}><Avatar src={p.author.avatarUrl} size={compact ? 32 : 40} /></Link>
      <div style={{ minWidth: 0 }}>
        <div className={s.meta}>
          <Link id={`post-${post.id}-author`} to={`/u/${p.author.username}`} className={s.name}>{p.author.displayName}</Link>
          <span className={s.handle}>@{p.author.username}</span>
          <span className={s.handle} aria-hidden="true">·</span>
          <Link to={`/p/${p.id}`} className={s.time}><time dateTime={p.createdAt} title={new Date(p.createdAt).toLocaleString()}>{relativeTime(p.createdAt)}</time></Link>
          {p.community && <Link to={`/c/${p.community.slug}`} className={s.communityTag}><Hash size={11} aria-hidden="true" />{p.community.name}</Link>}
        </div>
        {p.replyTo && !focused && <div className={s.replyTo}>Replying to <Link to={`/u/${p.replyTo.author.username}`}>@{p.replyTo.author.username}</Link></div>}
        {p.deleted ? <div className={s.tombstone} style={{ marginTop: 6 }}>This post was deleted.</div> : (
          <>
            {p.body && <PostBody text={p.body} className={s.body} />}
            <MediaGrid media={p.media} />
            {p.quoted && <QuoteEmbed post={p.quoted} />}
            <CallUpdates updates={p.callUpdates} />
            <ReactionPills reactions={p.reactions} onToggle={a.react} />
            <div className={s.actions} role="group" aria-label="Post actions">
              <button type="button" className={s.action} aria-label={`Reply, ${p.counts.replies} replies`} onClick={(e) => { e.stopPropagation(); setReplying(true); }}><MessageCircle size={15} aria-hidden="true" />{p.counts.replies || ''}</button>
              <Menu label="Repost options" items={[
                { label: p.viewer.reposted ? 'Undo repost' : 'Repost', onSelect: a.toggleRepost },
                { label: 'Quote', onSelect: () => setQuoting(true) },
              ]} trigger={(t) => <button {...t} type="button" className={s.action} aria-pressed={p.viewer.reposted} aria-label={`Repost options, ${p.counts.reposts + p.counts.quotes} reposts and quotes`} onClick={(e) => { e.stopPropagation(); t.onClick(); }}><Repeat2 size={15} aria-hidden="true" />{p.counts.reposts + p.counts.quotes || ''}</button>} />
              <ReactionPicker onPick={a.react} />
              <button type="button" className={s.action} aria-pressed={p.viewer.bookmarked} aria-label={p.viewer.bookmarked ? 'Remove bookmark' : 'Bookmark'} onClick={(e) => { e.stopPropagation(); a.toggleBookmark(); }}><Bookmark size={15} aria-hidden="true" /></button>
              <button type="button" className={s.action} aria-label="Copy link" onClick={(e) => { e.stopPropagation(); a.copyLink(); }}><Share size={15} aria-hidden="true" /></button>
              {p.viewer.canAddCallUpdate && <button type="button" className={s.action} onClick={(e) => { e.stopPropagation(); setAddingCall(true); }}>+ Update call</button>}
              <span style={{ marginLeft: 'auto' }}>
                <Menu label="More" items={[
                  { label: p.viewer.subscribed ? 'Unfollow conversation' : 'Follow conversation', onSelect: a.toggleSubscribe },
                  ...(isMine ? [{ label: 'Delete post', onSelect: a.remove, danger: true }] : [
                    { label: `Mute @${p.author.username}`, onSelect: () => userActions.mute(true) },
                    { label: `Block @${p.author.username}`, onSelect: () => userActions.block(true), danger: true },
                    { label: 'Report post', onSelect: () => setReport({ type: 'post', id: p.id }), danger: true },
                  ]),
                ]} trigger={(t) => <button {...t} type="button" className={s.action} onClick={(e) => { e.stopPropagation(); t.onClick(); }}><Ellipsis size={15} aria-hidden="true" /></button>} />
              </span>
            </div>
          </>
        )}
      </div>
      <ReportDialog target={report} onClose={() => setReport(null)} />
      <AddCallUpdate p={p} open={addingCall} onClose={() => setAddingCall(false)} />
      <Dialog open={quoting} onClose={() => setQuoting(false)} title="Quote post"><Composer mode="quote" quote={p} autoFocus onPosted={() => setQuoting(false)} /></Dialog>
      <Dialog open={replying} onClose={() => setReplying(false)} title={`Reply to @${p.author.username}`}><Composer mode="reply" parent={p} autoFocus onPosted={() => setReplying(false)} /></Dialog>
    </article>
  );
}
```

- [ ] **Step 5: Composer**

`apps/web/src/features/feed/Composer.module.css`:
```css
.composer { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.inDialog { padding: 0; border: 0; }
.textarea { width: 100%; min-height: 64px; max-height: 50vh; resize: none; padding: 8px 0; border: 0; background: transparent; color: var(--text); font-size: var(--fs-lg); line-height: 1.45; }
.textarea:focus-visible { outline: none; }
.textarea::placeholder { color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 0; }
.chipsLabel { color: var(--muted); font-size: var(--fs-xs); }
.uploads { display: flex; gap: 6px; flex-wrap: wrap; padding: 6px 0; }
.thumb { position: relative; width: 72px; height: 72px; border-radius: 6px; overflow: hidden; background: var(--raised); }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.thumb button { position: absolute; top: 2px; right: 2px; }
.bar { display: flex; align-items: center; gap: 6px; padding-top: 8px; border-top: 1px solid var(--line); }
.count { margin-left: auto; color: var(--muted); font: 500 12px var(--font-mono); }
.over { color: var(--down); }
.error { color: var(--down); font-size: var(--fs-sm); padding-top: 6px; }
```

`apps/web/src/features/feed/Composer.tsx`:
```tsx
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, X } from 'lucide-react';
import { LIMITS, codePointLength, uniqueMints, type PostView, type ThreadView, type TokenView, type UploadView } from '@shillex/shared';
import { ApiError, errorMessage, post as apiPost, uploadImage } from '../../lib/api';
import { patchPost, prependToFeed } from '../../lib/cache';
import { useRequiredMe } from '../../lib/useMe';
import { cx } from '../../lib/cx';
import { Avatar } from '../../components/ui/Avatar';
import { Button, IconButton } from '../../components/ui/Button';
import { toast } from '../../components/ui/Toaster';
import { primeTokens } from '../tokens/tokenCache';
import { TokenMention } from '../tokens/TokenMention';
import { QuoteEmbed } from './QuoteEmbed';
import s from './Composer.module.css';

export interface ComposerProps {
  mode: 'post' | 'reply' | 'quote';
  parent?: PostView; quote?: PostView; communityId?: string; communitySlug?: string;
  autoFocus?: boolean; placeholder?: string; onPosted?: (p: PostView) => void;
}

export function Composer({ mode, parent, quote, communityId, communitySlug, autoFocus, placeholder, onPosted }: ComposerProps) {
  const me = useRequiredMe();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [uploads, setUploads] = useState<UploadView[]>([]);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const len = codePointLength(text);
  const remaining = LIMITS.postMax - len;
  const mints = uniqueMints(text);
  const canSubmit = !busy && uploading === 0 && remaining >= 0 && (text.trim().length > 0 || (mode !== 'quote' && uploads.length > 0));

  useEffect(() => { if (autoFocus) area.current?.focus(); }, [autoFocus]);
  useEffect(() => { const el = area.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }, [text]);

  async function addFiles(files: FileList | null) {
    if (!files) return;
    for (const f of [...files].slice(0, LIMITS.maxImages - uploads.length)) {
      setUploading((n) => n + 1);
      try { const u = await uploadImage(f); setUploads((x) => [...x, u]); }
      catch (e) { toast(errorMessage(e), { tone: 'error' }); }
      finally { setUploading((n) => n - 1); }
    }
  }

  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setError(null);
    try {
      const r = await apiPost<{ post: PostView; tokens: Record<string, TokenView> }>('/posts', {
        body: text, uploadIds: uploads.map((u) => u.id), parentId: parent?.id, quoteOfId: quote?.id, communityId,
      });
      primeTokens(qc, r.tokens);
      if (mode === 'reply' && parent) {
        qc.setQueriesData<ThreadView>({ queryKey: ['thread'] }, (t) => t && (t.post.id === parent.id ? { ...t, replies: [...t.replies, r.post] } : t));
        patchPost(qc, parent.id, (p) => ({ ...p, counts: { ...p.counts, replies: p.counts.replies + 1 } }));
      } else if (communitySlug) {
        prependToFeed(qc, ['communityThreads', communitySlug], r.post);
      } else {
        prependToFeed(qc, ['feed', 'following'], r.post);
        if (quote) patchPost(qc, quote.id, (p) => ({ ...p, counts: { ...p.counts, quotes: p.counts.quotes + 1 } }));
      }
      qc.invalidateQueries({ queryKey: ['userPosts', me.username] });
      setText(''); setUploads([]);
      onPosted?.(r.post);
      if (mode !== 'post') toast(mode === 'reply' ? 'Reply posted' : 'Quote posted', { tone: 'success' });
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'RATE_LIMITED' ? 'You’re posting a lot — wait a moment and try again.' : errorMessage(e));
    } finally { setBusy(false); }
  }

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } };
  const label = mode === 'reply' ? 'Write your reply' : mode === 'quote' ? 'Add your take' : 'What’s happening in the trenches? Post';

  return (
    <div className={cx(s.composer, mode !== 'post' && s.inDialog)}>
      <Avatar src={me.avatarUrl} size={36} />
      <div style={{ minWidth: 0 }}>
        <textarea ref={area} className={s.textarea} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
          aria-label={label} placeholder={placeholder ?? (mode === 'reply' ? 'Post your reply' : mode === 'quote' ? 'Add your take…' : 'What’s happening in the trenches? Paste a CA to tag a token.')} rows={2} />
        {mints.length > 0 && (
          <div className={s.chips} aria-live="polite"><span className={s.chipsLabel}>Tokens:</span>{mints.map((m) => <TokenMention key={m} mint={m} />)}</div>
        )}
        {quote && <QuoteEmbed post={quote} />}
        {(uploads.length > 0 || uploading > 0) && (
          <div className={s.uploads}>
            {uploads.map((u) => (
              <div key={u.id} className={s.thumb}><img src={u.url} alt="" />
                <IconButton label="Remove image" onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}><X size={14} /></IconButton></div>
            ))}
            {uploading > 0 && <div className={s.thumb} aria-busy="true" aria-label="Uploading image" />}
          </div>
        )}
        {error && <div className={s.error} role="alert">{error}</div>}
        <div className={s.bar}>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
          <IconButton label="Add images" disabled={uploads.length >= LIMITS.maxImages || mode === 'quote'} onClick={() => file.current?.click()}><ImagePlus size={18} /></IconButton>
          <span className={cx(s.count, remaining < 0 && s.over)} aria-live="polite">{remaining <= 100 ? remaining : ''}</span>
          <Button variant="primary" size="sm" disabled={!canSubmit} loading={busy} onClick={submit}>{mode === 'reply' ? 'Reply' : 'Post'}</Button>
        </div>
      </div>
    </div>
  );
}
```
The textarea's accessible name for `mode="post"` is "What’s happening in the trenches? Post", which the test matches with `/what’s happening|post/i`.

- [ ] **Step 6: Lists and pages**

`apps/web/src/features/feed/PostSkeleton.tsx`:
```tsx
import { Skeleton } from '../../components/ui/Skeleton';
export const PostSkeleton = () => (
  <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--line)' }} aria-hidden="true">
    <Skeleton w={40} h={40} r={20} />
    <div style={{ display: 'grid', gap: 8 }}><Skeleton w="40%" /><Skeleton /><Skeleton w="75%" /></div>
  </div>
);
```

`apps/web/src/features/feed/FeedList.tsx`:
```tsx
import { useEffect, useRef, type ReactNode } from 'react';
import { useInfiniteQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { Page, PostView } from '@shillex/shared';
import { get } from '../../lib/api';
import { ErrorState } from '../../components/ui/ErrorState';
import { Spinner } from '../../components/ui/Spinner';
import { primeTokens } from '../tokens/tokenCache';
import { PostCard } from './PostCard';
import { PostSkeleton } from './PostSkeleton';

export function FeedList({ queryKey, path, empty }: { queryKey: QueryKey; path: string; empty: ReactNode }) {
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey, initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const sep = path.includes('?') ? '&' : '?';
      const page = await get<Page<PostView>>(`${path}${pageParam ? `${sep}cursor=${encodeURIComponent(pageParam)}` : ''}`, signal);
      primeTokens(qc, page.tokens);
      return page;
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage]);

  if (q.isPending) return <div aria-busy="true" aria-label="Loading posts">{Array.from({ length: 5 }, (_, i) => <PostSkeleton key={i} />)}</div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data.pages.flatMap((p) => p.items);
  if (!items.length) return <>{empty}</>;
  return (
    <div role="feed" aria-busy={q.isFetchingNextPage}>
      {items.map((p) => <PostCard key={p.id} post={p} />)}
      <div ref={sentinel} style={{ height: 1 }} />
      {q.isFetchingNextPage && <div style={{ display: 'grid', placeItems: 'center', padding: 16 }}><Spinner label="Loading more" /></div>}
      {!q.hasNextPage && items.length > 10 && <p style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>You’re all caught up.</p>}
    </div>
  );
}
```

`apps/web/src/features/feed/NewPostsPill.tsx`:
```tsx
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp } from 'lucide-react';
import { useSocketEvent } from '../../lib/socket';
export function NewPostsPill() {
  const qc = useQueryClient();
  const [n, setN] = useState(0);
  useSocketEvent('post:new', () => setN((x) => x + 1));
  if (!n) return null;
  return (
    <div style={{ position: 'sticky', top: 8, zIndex: 5, display: 'grid', placeItems: 'center', height: 0, overflow: 'visible' }}>
      <button type="button" onClick={() => { setN(0); void qc.invalidateQueries({ queryKey: ['feed', 'following'] }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: 0, borderRadius: 999, background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 600, boxShadow: 'var(--shadow-pop)' }}>
        <ArrowUp size={14} aria-hidden="true" /> {n} new {n === 1 ? 'post' : 'posts'}
      </button>
    </div>
  );
}
```

`apps/web/src/features/feed/HomePage.tsx`:
```tsx
import { Link, useSearchParams } from 'react-router';
import { Compass, Users } from 'lucide-react';
import { Tabs } from '../../components/ui/Tabs';
import { EmptyState } from '../../components/ui/EmptyState';
import { Composer } from './Composer';
import { FeedList } from './FeedList';
import { NewPostsPill } from './NewPostsPill';

export const pageHeader: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 10, background: 'rgba(14,18,25,.92)', backdropFilter: 'blur(8px)' };
export function HomePage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'discover' ? 'discover' : 'following';
  return (
    <section aria-labelledby="home-title">
      <div style={pageHeader}>
        <h1 id="home-title" className="sr-only">Home</h1>
        <Tabs label="Feed" idPrefix="home" value={tab} onChange={(id) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', id); return n; })}
          tabs={[{ id: 'following', label: 'Following' }, { id: 'discover', label: 'Discover' }]} />
      </div>
      <div id="home-panel" role="tabpanel" aria-labelledby={`home-${tab}`}>
        {tab === 'following' && <><Composer mode="post" /><NewPostsPill /></>}
        <FeedList key={tab} queryKey={['feed', tab]} path={`/feed?tab=${tab}`} empty={tab === 'following'
          ? <EmptyState icon={<Users size={32} />} title="Your feed is quiet" body="Follow people to see their posts here." action={<Link to="/?tab=discover" style={{ color: 'var(--accent)' }}>Find people in Discover</Link>} />
          : <EmptyState icon={<Compass size={32} />} title="Nothing new to discover" body="Check back soon — or start a conversation yourself." />} />
      </div>
    </section>
  );
}
```
(Task 23 adds `<LiveStrip/>` above the tabs for widths below 1200px.)

`apps/web/src/features/feed/ThreadPage.tsx`:
```tsx
import { useParams, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BellRing, Bell } from 'lucide-react';
import type { ThreadView } from '@shillex/shared';
import { ApiError, get } from '../../lib/api';
import { useSocketEvent } from '../../lib/socket';
import { patchPost } from '../../lib/cache';
import { IconButton, Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { primeTokens } from '../tokens/tokenCache';
import { PostCard } from './PostCard';
import { PostSkeleton } from './PostSkeleton';
import { Composer } from './Composer';
import { usePostActions } from './postActions';
import { pageHeader } from './HomePage';

export function ThreadPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['thread', id], queryFn: async () => { const t = await get<ThreadView>(`/posts/${id}`); primeTokens(qc, t.tokens); return t; } });
  useSocketEvent('call:update', ({ postId, update }) => patchPost(qc, postId, (p) => (p.callUpdates.some((u) => u.id === update.id) ? p : { ...p, callUpdates: [...p.callUpdates, update] })));
  return (
    <section aria-label="Thread">
      <div style={{ ...pageHeader, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--line)' }}>
        <IconButton label="Back" onClick={() => (history.length > 1 ? nav(-1) : nav('/'))}><ArrowLeft size={18} /></IconButton>
        <h1 style={{ margin: 0, fontSize: 'var(--fs-xl)' }}>Conversation</h1>
        {q.data && <SubscribeButton thread={q.data} />}
      </div>
      {q.isPending ? <><PostSkeleton /><PostSkeleton /></>
        : q.isError ? (q.error instanceof ApiError && q.error.status === 404
          ? <EmptyState title="This post isn’t available" body="It may have been deleted, or it’s in a community you can’t see." />
          : <ErrorState error={q.error} onRetry={() => q.refetch()} />)
        : (
          <>
            {q.data.ancestors.map((p) => <PostCard key={p.id} post={p} compact />)}
            <PostCard post={q.data.post} focused />
            {!q.data.post.deleted && <Composer mode="reply" parent={q.data.post} placeholder={`Reply to @${q.data.post.author.username}`} />}
            {q.data.replies.length === 0 ? <EmptyState title="No replies yet" body="Start the conversation." /> : q.data.replies.map((p) => <PostCard key={p.id} post={p} />)}
          </>
        )}
    </section>
  );
}

function SubscribeButton({ thread }: { thread: ThreadView }) {
  const a = usePostActions(thread.post);
  const on = thread.post.viewer.subscribed;
  return <Button size="sm" style={{ marginLeft: 'auto' }} aria-pressed={on} icon={on ? <BellRing size={14} /> : <Bell size={14} />} onClick={a.toggleSubscribe}>{on ? 'Following' : 'Follow conversation'}</Button>;
}
```

`apps/web/src/features/feed/BookmarksPage.tsx`:
```tsx
import { Bookmark } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { FeedList } from './FeedList';
import { pageHeader } from './HomePage';
export function BookmarksPage() {
  return (
    <section aria-labelledby="bm-title">
      <div style={{ ...pageHeader, padding: '12px 16px', borderBottom: '1px solid var(--line)' }}><h1 id="bm-title" style={{ margin: 0, fontSize: 'var(--fs-xl)' }}>Bookmarks</h1></div>
      <FeedList queryKey={['bookmarks']} path="/bookmarks" empty={<EmptyState icon={<Bookmark size={32} />} title="No bookmarks yet" body="Save posts to come back to them later." />} />
    </section>
  );
}
```

In `routes.tsx` replace the elements for `/` → `<HomePage />`, `/p/:id` → `<ThreadPage />`, `/bookmarks` → `<BookmarksPage />`.

- [ ] **Step 7: Run, look, commit**

Run: `npm test -w @shillex/web && npm run typecheck -w @shillex/web` → PASS.
Run `npm run dev`, enter the demo world, and verify with Playwright MCP screenshots (1440×900 and 390×844): feed populated with chips, call updates, reactions; composer posts and the post appears at the top; Ctrl+Enter works; thread page shows ancestors and replies; reply dialog works; bookmark toggles.
```bash
git add apps/web
git commit -m "feat(web): home feed, post cards with calls and reactions, composer, threads, bookmarks"
```

---

### Task 19: Token side panel

**Files:**
- Create: `apps/web/src/features/tokens/{TokenPanel.tsx,TokenPanelHost.tsx,ChatMentionItem.tsx,panel.module.css}`
- Modify: `apps/web/src/layout/AppShell.tsx` (render `<TokenPanelHost/>`)
- Test: `apps/web/test/TokenPanel.test.tsx`

**Interfaces:**
- Consumes: `GET /api/tokens/:mint`, `/posts`, `/chat`, `PUT|DELETE /subscription`; `useTokenPanel`, `primeTokens`, `PostCard`, `PostBody`, `provenance`, `copyAddress`.
- Produces: `<TokenPanelHost/>` (desktop: non-modal `aside[role=complementary]` fixed to the right edge over the right rail, the routed page stays mounted and interactive; < 768px: modal bottom sheet using `<dialog>`), `<TokenPanel mint onClose/>`, `<ChatMentionItem item/>`. A "Share to chat" action is added to the panel in Task 21.

- [ ] **Step 1: Failing test**

`apps/web/test/TokenPanel.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { TokenPanel } from '../src/features/tokens/TokenPanel';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const token = { mint: MINT, status: 'resolved', source: 'demo', name: 'Grubworm', symbol: 'GRUB', imageUrl: null, decimals: null, liquidityUsd: 122000, marketCapUsd: 1450000, fdvUsd: null, pairAddress: null, dexId: null, pairCreatedAt: '2026-10-08T06:00:00Z', promoted: false, fetchedAt: null, error: null };
const links = ['Axiom', 'GMGN', 'Dexscreener', 'Solscan'].map((label) => ({ id: label.toLowerCase(), label, url: null, unavailableReason: 'Fictional demo token — not on-chain' }));

describe('TokenPanel', () => {
  it('shows identity, full address, honest provenance, disabled demo links, note and empty discussion', async () => {
    mockFetch({
      [`/api/tokens/${MINT}/posts`]: { items: [], nextCursor: null },
      [`/api/tokens/${MINT}/chat`]: { items: [], nextCursor: null },
      [`/api/tokens/${MINT}`]: { token, links, stats: { mentions24h: 0, posts24h: 0, chat24h: 0, subscribed: false } },
    });
    const onClose = vi.fn();
    renderWithApp(<TokenPanel mint={MINT} onClose={onClose} />);
    expect(await screen.findByRole('heading', { name: /Grubworm/ })).toBeInTheDocument();
    expect(screen.getByText(MINT)).toBeInTheDocument();
    expect(screen.getByText(/DEMO data — fictional token, not on-chain/)).toBeInTheDocument();
    for (const l of ['Axiom', 'GMGN', 'Dexscreener', 'Solscan']) {
      const el = screen.getByText(l).closest('[aria-disabled]');
      expect(el).toHaveAttribute('aria-disabled', 'true');
    }
    expect(screen.getByText('Mentions measure discussion, not quality. Do your own research.')).toBeInTheDocument();
    expect(await screen.findByText('No public posts mention this exact address yet.')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
  it('live tokens get real links that open in a new tab', async () => {
    mockFetch({
      [`/api/tokens/${MINT}/posts`]: { items: [], nextCursor: null },
      [`/api/tokens/${MINT}/chat`]: { items: [], nextCursor: null },
      [`/api/tokens/${MINT}`]: { token: { ...token, source: 'live', fetchedAt: new Date().toISOString() }, links: [{ id: 'dexscreener', label: 'Dexscreener', url: `https://dexscreener.com/solana/${MINT}`, unavailableReason: null }], stats: { mentions24h: 3, posts24h: 2, chat24h: 1, subscribed: true } },
    });
    renderWithApp(<TokenPanel mint={MINT} onClose={() => {}} />);
    const a = await screen.findByRole('link', { name: /Dexscreener/ });
    expect(a).toHaveAttribute('href', `https://dexscreener.com/solana/${MINT}`);
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('button', { name: /Following discussion/ })).toHaveAttribute('aria-pressed', 'true');
  });
  it('error state offers retry', async () => {
    mockFetch({ [`/api/tokens/${MINT}`]: new Response(JSON.stringify({ code: 'INTERNAL', message: 'boom' }), { status: 500 }) });
    renderWithApp(<TokenPanel mint={MINT} onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Try again' }, { timeout: 4000 })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement**

`apps/web/src/features/tokens/panel.module.css`:
```css
.aside { position: fixed; z-index: 50; top: 0; right: 0; bottom: 0; width: var(--panel-w); max-width: 100vw; display: flex; flex-direction: column; background: var(--panel); border-left: 1px solid var(--line-strong); box-shadow: -20px 0 40px rgba(0, 0, 0, .35); animation: slideIn .16s ease-out; }
@keyframes slideIn { from { transform: translateX(24px); opacity: 0; } }
.sheet { width: 100vw; max-width: 100vw; max-height: 88vh; margin: auto 0 0; padding: 0; border: 0; border-radius: 14px 14px 0 0; background: var(--panel); color: var(--text); }
.sheet::backdrop { background: rgba(5, 7, 12, .7); }
.handle { width: 36px; height: 4px; margin: 8px auto 0; border-radius: 2px; background: var(--line-strong); }
.head { display: flex; gap: 12px; align-items: center; padding: 14px 16px 10px; }
.title { margin: 0; font-size: var(--fs-xl); line-height: 1.2; }
.sym { color: var(--token); font-family: var(--font-mono); font-size: var(--fs-md); }
.scroll { flex: 1; overflow-y: auto; }
.addr { display: flex; align-items: flex-start; gap: 6px; margin: 0 16px; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--bg); font: 400 12px/1.4 var(--font-mono); overflow-wrap: anywhere; }
.prov { margin: 8px 16px 0; color: var(--muted); font-size: var(--fs-sm); }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 12px 16px 0; }
.stat { padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.statLabel { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
.statValue { font: 500 var(--fs-lg) var(--font-mono); }
.links { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 12px 16px 0; }
.link { display: inline-flex; justify-content: center; align-items: center; gap: 4px; height: 30px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--raised); font-size: var(--fs-sm); font-weight: 500; }
.link:hover { background: var(--hover); }
.link[aria-disabled='true'] { color: var(--muted); background: transparent; border-style: dashed; cursor: not-allowed; }
.linkReason { margin: 6px 16px 0; color: var(--muted); font-size: var(--fs-xs); }
.row { display: flex; gap: 8px; margin: 12px 16px 0; }
.note { margin: 12px 16px; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--raised); color: var(--muted); font-size: var(--fs-sm); }
.chatItem { display: grid; gap: 4px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.chatWhere { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: var(--fs-xs); }
.chatWhere img { width: 14px; height: 14px; border-radius: 3px; }
```

`apps/web/src/features/tokens/ChatMentionItem.tsx`:
```tsx
import { Link } from 'react-router';
import { relativeTime, type PublicChatMention } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { PostBody } from '../feed/PostBody';
import s from './panel.module.css';
export function ChatMentionItem({ item }: { item: PublicChatMention }) {
  const m = item.message;
  return (
    <article className={s.chatItem}>
      <div className={s.chatWhere}>{item.community.name} › #{item.channel.name} · {relativeTime(m.createdAt)}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Avatar src={m.author.avatarUrl} size={20} /><Link to={`/u/${m.author.username}`} style={{ fontWeight: 600 }}>{m.author.displayName}</Link></div>
      <PostBody text={m.body} />
      <Link to={`/c/${item.community.slug}/${item.channel.id}?m=${m.id}`} style={{ color: 'var(--accent)', fontSize: 'var(--fs-sm)' }}>Open in context →</Link>
    </article>
  );
}
```

`apps/web/src/features/tokens/TokenPanel.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellRing, Copy, ExternalLink, X } from 'lucide-react';
import { COPY, formatAge, formatUsd, type ExternalLink as Ext, type Page, type PostView, type PublicChatMention, type TokenDiscussionStats, type TokenView } from '@shillex/shared';
import { del, errorMessage, get, put } from '../../lib/api';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Tabs } from '../../components/ui/Tabs';
import { toast } from '../../components/ui/Toaster';
import { PostCard } from '../feed/PostCard';
import { primeTokens, tokenKey } from './tokenCache';
import { TokenAvatar } from './TokenAvatar';
import { copyAddress, provenance } from './TokenPreview';
import { ChatMentionItem } from './ChatMentionItem';
import s from './panel.module.css';

interface Detail { token: TokenView; links: Ext[]; stats: TokenDiscussionStats }

export function TokenPanel({ mint, onClose, asSheet }: { mint: string; onClose: () => void; asSheet?: boolean }) {
  const qc = useQueryClient();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<'posts' | 'chat'>('posts');
  const d = useQuery({
    queryKey: ['tokenDetail', mint],
    queryFn: async () => { const r = await get<Detail>(`/tokens/${mint}`); qc.setQueryData(tokenKey(mint), r.token); return r; },
    refetchInterval: (q) => (q.state.data?.token.status === 'pending' ? 4000 : false),
  });
  useEffect(() => { closeRef.current?.focus(); }, [mint]);

  const list = <T,>(kind: 'posts' | 'chat') => ({
    queryKey: [kind === 'posts' ? 'tokenPosts' : 'tokenChat', mint], initialPageParam: null as string | null,
    queryFn: async ({ pageParam }: { pageParam: string | null }) => { const p = await get<Page<T>>(`/tokens/${mint}/${kind}${pageParam ? `?cursor=${pageParam}` : ''}`); primeTokens(qc, p.tokens); return p; },
    getNextPageParam: (l: Page<T>) => l.nextCursor,
  });
  const posts = useInfiniteQuery({ ...list<PostView>('posts'), enabled: tab === 'posts' });
  const chat = useInfiniteQuery({ ...list<PublicChatMention>('chat'), enabled: tab === 'chat' });

  async function toggleFollow() {
    if (!d.data) return;
    const on = !d.data.stats.subscribed;
    qc.setQueryData<Detail>(['tokenDetail', mint], (x) => x && { ...x, stats: { ...x.stats, subscribed: on } });
    try { await (on ? put(`/tokens/${mint}/subscription`) : del(`/tokens/${mint}/subscription`)); toast(on ? 'You’ll be notified about new public discussion' : 'Stopped following this discussion'); }
    catch (e) { qc.setQueryData<Detail>(['tokenDetail', mint], (x) => x && { ...x, stats: { ...x.stats, subscribed: !on } }); toast(errorMessage(e), { tone: 'error' }); }
  }

  const t = d.data?.token;
  const demo = t?.source === 'demo';
  return (
    <div role={asSheet ? undefined : 'complementary'} aria-labelledby="token-panel-title" className={asSheet ? undefined : s.aside}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      {asSheet && <div className={s.handle} aria-hidden="true" />}
      <div className={s.head}>
        {t ? <TokenAvatar token={t} size={40} /> : <Skeleton w={40} h={40} r={20} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 id="token-panel-title" className={s.title}>{t?.name ?? (t?.status === 'unindexed' ? 'Unindexed mint' : t?.status === 'error' ? 'Token unavailable' : 'Token')}</h2>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
            {t?.symbol && <span className={s.sym}>${t.symbol}</span>}{demo && <Badge tone="demo">DEMO</Badge>}{t?.promoted && <Badge tone="promoted" title="Paid placement">{COPY.promoted}</Badge>}
          </div>
        </div>
        <IconButton ref={closeRef} label="Close token panel" onClick={onClose}><X size={18} /></IconButton>
      </div>
      <div className={s.scroll}>
        <div className={s.addr}><span style={{ flex: 1 }}>{mint}</span><IconButton label="Copy full address" onClick={() => copyAddress(mint)}><Copy size={14} /></IconButton></div>
        {d.isPending ? <div style={{ padding: 16, display: 'grid', gap: 8 }}><Skeleton /><Skeleton w="60%" /><Skeleton h={48} /></div>
          : d.isError ? <ErrorState error={d.error} onRetry={() => d.refetch()} title="Couldn’t load token data" />
          : (
            <>
              <p className={s.prov}>{provenance(d.data.token)}</p>
              {(t!.status === 'resolved' || t!.status === 'unindexed') && (
                <div className={s.stats}>
                  <div className={s.stat}><div className={s.statLabel}>Age</div><div className={s.statValue} title={t!.pairCreatedAt ? 'Since the trading pair was created' : 'No trading pair found'}>{formatAge(t!.pairCreatedAt)}</div></div>
                  <div className={s.stat}><div className={s.statLabel}>Liquidity</div><div className={s.statValue} title={t!.liquidityUsd === null ? 'Not reported' : undefined}>{formatUsd(t!.liquidityUsd)}</div></div>
                  <div className={s.stat}><div className={s.statLabel}>Market cap</div><div className={s.statValue} title={t!.marketCapUsd === null ? 'Not reported' : undefined}>{formatUsd(t!.marketCapUsd)}</div></div>
                </div>
              )}
              {d.data.links.length > 0 && (
                <>
                  <div className={s.links}>
                    {d.data.links.map((l) => l.url
                      ? <a key={l.id} className={s.link} href={l.url} target="_blank" rel="noopener noreferrer">{l.label}<ExternalLink size={11} aria-hidden="true" /></a>
                      : <span key={l.id} className={s.link} aria-disabled="true" title={l.unavailableReason ?? undefined}>{l.label}</span>)}
                  </div>
                  {demo ? <p className={s.linkReason}>{COPY.demoLinkReason}.</p>
                    : d.data.links.some((l) => !l.url) && <p className={s.linkReason}>{d.data.links.find((l) => !l.url)?.unavailableReason}.</p>}
                </>
              )}
              <div className={s.row}>
                <Button size="sm" aria-pressed={d.data.stats.subscribed} icon={d.data.stats.subscribed ? <BellRing size={14} /> : <Bell size={14} />} onClick={toggleFollow}>
                  {d.data.stats.subscribed ? 'Following discussion' : 'Follow discussion'}
                </Button>
              </div>
              <p className={s.note}>{COPY.tokenPanelNote}</p>
              <Tabs label="Discussion" idPrefix="tokdisc" value={tab} onChange={(v) => setTab(v as 'posts' | 'chat')}
                tabs={[{ id: 'posts', label: 'Posts', count: d.data.stats.posts24h }, { id: 'chat', label: 'Community chat', count: d.data.stats.chat24h }]} />
              <p className="sr-only">Counts are public mentions in the last 24 hours.</p>
              <div id="tokdisc-panel" role="tabpanel" aria-labelledby={`tokdisc-${tab}`}>
                {tab === 'posts'
                  ? posts.isPending ? <Skeleton h={60} /> : posts.isError ? <ErrorState error={posts.error} onRetry={() => posts.refetch()} />
                    : posts.data.pages[0]!.items.length === 0 ? <EmptyState title="No public posts mention this exact address yet." />
                    : <>{posts.data.pages.flatMap((p) => p.items).map((p) => <PostCard key={p.id} post={p} compact />)}
                        {posts.hasNextPage && <Button size="sm" variant="ghost" onClick={() => posts.fetchNextPage()} loading={posts.isFetchingNextPage}>Load more</Button>}</>
                  : chat.isPending ? <Skeleton h={60} /> : chat.isError ? <ErrorState error={chat.error} onRetry={() => chat.refetch()} />
                    : chat.data.pages[0]!.items.length === 0 ? <EmptyState title="No public community chat mentions this address yet." />
                    : <>{chat.data.pages.flatMap((p) => p.items).map((m) => <ChatMentionItem key={m.message.id} item={m} />)}
                        {chat.hasNextPage && <Button size="sm" variant="ghost" onClick={() => chat.fetchNextPage()} loading={chat.isFetchingNextPage}>Load more</Button>}</>}
              </div>
            </>
          )}
      </div>
    </div>
  );
}
```
Note: in the sheet variant, the `<dialog>` is the modal container; the `complementary` role applies only to the desktop aside. The test renders the default (desktop) variant.

`apps/web/src/features/tokens/TokenPanelHost.tsx`:
```tsx
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useTokenPanel } from './useTokenPanel';
import { TokenPanel } from './TokenPanel';
import s from './panel.module.css';

const mq = typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)') : null;
const useIsMobile = () => useSyncExternalStore((l) => { mq?.addEventListener('change', l); return () => mq?.removeEventListener('change', l); }, () => !!mq?.matches, () => false);

export function TokenPanelHost() {
  const { mint, close } = useTokenPanel();
  const mobile = useIsMobile();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (mobile && mint && dlg.current && !dlg.current.open) dlg.current.showModal(); }, [mobile, mint]);
  if (!mint) return null;
  if (mobile) {
    return (
      <dialog ref={dlg} className={s.sheet} aria-labelledby="token-panel-title" onCancel={(e) => { e.preventDefault(); close(); }} onClick={(e) => { if (e.target === dlg.current) close(); }}>
        <TokenPanel mint={mint} onClose={close} asSheet />
      </dialog>
    );
  }
  return <TokenPanel mint={mint} onClose={close} />;
}
```

In `AppShell.tsx` render `<TokenPanelHost />` after `</main>`.

- [ ] **Step 3: Run, verify, commit**

Run: `npm test -w @shillex/web && npm run typecheck -w @shillex/web` → PASS.
Manual check via Playwright MCP: click a chip in the feed — the panel opens on the right, the feed underneath keeps its scroll position and remains clickable; Esc closes and focus returns to the chip; at 390px the panel is a bottom sheet; browser Back closes the panel (URL state).
```bash
git add apps/web
git commit -m "feat(web): token side panel with provenance, verified links, follow and public discussion"
```
