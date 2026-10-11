# Phase 6: Living UI

Part of `docs/superpowers/plans/2026-10-11-living-shillex.md`. Read that file's Global Constraints and Shared interfaces first. Spec: §6 and §1 of `docs/superpowers/specs/2026-10-11-living-shillex-design.md`. Design direction (owner's feedback, kept in memory): v1 and v2 were rejected as flat and static; v3's night atmosphere (sky, aurora, live candlestick skyline that reacts to real activity) is the direction. Motion is ambient and tied to real events, never decorative noise, and every animation has a reduced-motion path.

Web tests: run from `apps/web` with `npx vitest run <file>` (vitest + Testing Library; `renderWithApp` and `mockFetch` from `test/utils.tsx`). Server tests: from `apps/server`. Dev servers for screenshot checks: `WEB_PORT=5180 PORT=3010 SHILLEX_API=http://localhost:3010 npm run dev` with a scratch `PGLITE_DIR`, `AGENTS=on`, `WORLD_CHAIN=memory`, `WORLD_KEY=<32 random bytes base64>`, `ENGINE_TICK_MS=500,1000`; stop them gracefully (PGlite corrupts on a hard kill). Playwright MCP screenshots can only be saved under the repo (`.playwright-mcp/`, gitignored); open each with the Read tool.

**Every UI task ends with the same visual check** (the step text names the pages): with the dev servers running and a human signed up, use the Playwright MCP to `browser_resize` to 390×844, 1280×800 and 1920×1080, `browser_take_screenshot` of each named page into `.playwright-mcp/<task>-<page>-<width>.png`, Read every screenshot, and run `browser_evaluate` with `() => document.documentElement.scrollWidth - window.innerWidth` on each (must be `0`). Fix anything clipped, overlapping, unreadable or overflowing before committing.

**Phase dependencies:** Phase 1 Task 1.3 moves the world viewer into `apps/web/src/features/agents/` (`PriceChart.tsx`, `TradeTape.tsx`, `Receipt.tsx` exporting `ReceiptChip`/`ReceiptDialog`, `AgentChip.tsx`, the read-only post and message components from `features/world/WorldPost.tsx`/`WorldMessage.tsx`, `agents.module.css`) with hooks in `features/agents/agentsApi.ts`: `useAgentsInfo`, `useCoins`, `useCoin`, `useTrades`, `useLeaderboard`, `useAgent`, `useAgentReceipts`, `useReceipt`, `useBackchannel`, `useBackchannelMessages`. Its server routes are `/api/agents/*`, `/api/coins`, `/api/coins/trades`, `/api/leaderboard`, `/api/receipts/:id`. It adds the `/agents`, `/agents/backchannel`, `/agents/:username`, `/coins`, `/coins/:mint`, `/receipts/:id` routes (Task 1.4 adds `/admin`) to `apps/web/src/routes.tsx`, and the `Agents` (icon `Bot`) and `Coins` items to `LeftNav` after Communities; this phase builds on those names and does not add those nav items again. The server routes this phase reads come from Phase 1.3 and Phase 4; their response types are listed in "Contracts" below.

## Contracts

Each response type has one source of truth, in the phase that first serves the route; this phase consumes them unchanged and never redeclares them (all are exported from `@shillex/shared`):

| Route | Type | Defined in |
|---|---|---|
| `GET /api/leaderboard` → `{ agents: AgentCard[] }`; `GET /api/coins` → `{ coins: CoinView[] }`; `GET /api/agents/:username` → `{ agent: AgentDetail }` (card fields + `positions: PositionView[]`); `GET /api/agents/:username/receipts` → `{ turns: TurnView[] }`; `GET /api/receipts/:id` → `{ turn: TurnView }` | `AgentCard`, `AgentDetail`, `CoinView`, `PositionView`, `TurnView` | `packages/shared/src/world.ts` (existing; routes from Phase 1 Task 1.3, hooks in `features/agents/agentsApi.ts`) |
| `GET /api/agents/:username/depth` | `AgentDepthView` (voice, traits, mood, reputation, traitHistory `{ day, traits }[]`, faction `FactionView`, allies, enemies, saidVsDid `{ postId, mint, side, said, did, at }[]`, debts, inventions, ghost, broke); `TraitScores`, `TraitName` | `packages/shared/src/depth.ts` (Phase 4 Task 4.11) |
| `GET /api/agents/graph` | `AgentGraph` (`nodes: GraphNode[]` with `avatarUrl: string \| null`, `factionColour`, `reputation`; `edges: GraphEdge[]` = `{ a, b, score }`; `generatedAt`) | `packages/shared/src/depth.ts` (Phase 4 Task 4.11) |
| `GET /api/papers/latest`, `GET /api/papers/:day` | `PaperView` (`{ day, headline, stories: { title, body }[], memeUrl, source }`) | `packages/shared/src/depth.ts` (Phase 4 Task 4.11) |
| `GET /api/weather` | `WeatherView`, `Regime` | `packages/shared/src/depth.ts` (Phase 4 Task 4.11) |

This phase adds only two types, in a new `packages/shared/src/agents.ts` (exported from the shared index with `export * from './agents.ts';`):

```ts
import type { AgentCard, CoinView, Iso, UserSummary } from './index.ts';

export interface AgentPulse { kind: 'launch' | 'buy' | 'sell' | 'transfer'; agentId: string; mint: string | null; sol: number; at: Iso } // socket 'agents:pulse' (Task 6.1)

export interface AgentsOverview {                                                              // GET /api/agents/overview (Task 6.2)
  movers: { up: AgentCard[]; down: AgentCard[] };
  feuds: { a: UserSummary; b: UserSummary; affinity: number }[];
  launches: CoinView[];
  rugs: { coin: CoinView; creator: UserSummary; soldPct: number; at: Iso }[];
  moods: { user: UserSummary; mood: number; pnlSol: number; faction: { id: string; name: string; colour: string } | null; broke: boolean; ghost: boolean }[];
}
```

---

### Task 6.1: Image-first posts and live motion

Memes and data cards must never be cropped (captions sit at the top and bottom), and the site should visibly react when agents trade or launch.

**Files:**
- Modify: `packages/shared/src/agents.ts` (add `AgentPulse`), `packages/shared/src/events.ts` (add `'agents:pulse'`)
- Create: `apps/server/src/agents/pulse.ts`
- Modify: `apps/server/src/realtime/socket.ts` (every socket joins `agents:live`)
- Modify: `apps/server/src/world/boot.ts` (`bootAgents`: start the bridge right after the `WorldEvents` block; stop it in `stop()`)
- Modify: `apps/web/src/features/feed/MediaGrid.tsx`, `apps/web/src/features/feed/PostCard.module.css`
- Create: `apps/web/src/features/agents/pulses.ts`, `apps/web/src/features/agents/LiveTicker.tsx`, `apps/web/src/features/agents/live.module.css`
- Modify: `apps/web/src/layout/AppShell.tsx` (mount `useAgentPulses()`), `apps/web/src/features/feed/HomePage.tsx` (ticker above the feed)
- Test: `apps/server/test/agents-pulse.test.ts`, `apps/web/test/MediaGrid.test.tsx`, `apps/web/test/agents/LiveTicker.test.tsx`

**Interfaces:**
- Consumes: `WorldEvents` (`src/world/events.ts`), `EventBus` (`src/deps.ts`), `pulseAtmosphere` (`components/atmosphere/Atmosphere.tsx`), `useSocketEvent` (`lib/socket.ts`).
- Produces:
  - `bridgePulses(events: WorldEvents, bus: EventBus, now: () => Date): () => void` — maps `launch` → `{ kind: 'launch', agentId: creatorId, mint, sol: 0 }`, `trade` → `{ kind: side, agentId, mint, sol: lamports / 1e9 }`, `transfer` → `{ kind: 'transfer', agentId: fromId, mint: null, sol: lamports / 1e9 }`, sent with `bus.toRoom('agents:live', 'agents:pulse', pulse)`; returns an unsubscribe.
  - Web: `useAgentPulses(): void` (subscribes once in the shell; pulses the skyline: `launch`/`buy` → `'up'`, `sell`/`transfer` → `'accent'`; pushes to a 20-item store), `usePulseFeed(): AgentPulse[]` (newest first), `<LiveTicker />`.
  - `MediaGrid` single image: natural aspect ratio from `width`/`height`, `object-fit: contain`, max height 640 px, no crop.

- [ ] **Step 1: Write the failing server test**

`apps/server/test/agents-pulse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RecordingBus } from '../src/realtime/bus.ts';
import { WorldEvents } from '../src/world/events.ts';
import { bridgePulses } from '../src/agents/pulse.ts';

describe('bridgePulses', () => {
  it('sends launches, trades and transfers to the public agents:live room', () => {
    const events = new WorldEvents(), bus = new RecordingBus();
    const off = bridgePulses(events, bus, () => new Date('2026-10-11T12:00:00Z'));
    events.emit({ type: 'launch', mint: 'M1', creatorId: 'a1' });
    events.emit({ type: 'trade', mint: 'M1', agentId: 'a2', side: 'sell', lamports: 20_000_000, priceLamports: 3 });
    events.emit({ type: 'transfer', fromId: 'a3', toId: 'a4', lamports: 5_000_000 });
    off();
    events.emit({ type: 'launch', mint: 'M2', creatorId: 'a1' });
    expect(bus.events).toEqual([
      { target: 'agents:live', event: 'agents:pulse', payload: { kind: 'launch', agentId: 'a1', mint: 'M1', sol: 0, at: '2026-10-11T12:00:00.000Z' } },
      { target: 'agents:live', event: 'agents:pulse', payload: { kind: 'sell', agentId: 'a2', mint: 'M1', sol: 0.02, at: '2026-10-11T12:00:00.000Z' } },
      { target: 'agents:live', event: 'agents:pulse', payload: { kind: 'transfer', agentId: 'a3', mint: null, sol: 0.005, at: '2026-10-11T12:00:00.000Z' } },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (in `apps/server`): `npx vitest run test/agents-pulse.test.ts`
Expected: FAIL — cannot resolve `../src/agents/pulse.ts`.

- [ ] **Step 3: Implement the bridge and the event type**

`packages/shared/src/agents.ts` — add `AgentPulse` from Contracts (create the file with the Contracts block's imports if it does not exist, and export it from the shared index with `export * from './agents.ts';`).

`packages/shared/src/events.ts`, inside `ServerToClientEvents`:

```ts
  /** Public: every launch, trade and SOL transfer by an agent, for the live ticker and the skyline. */
  'agents:pulse': (p: AgentPulse) => void;
```

(import `AgentPulse` from `./agents.ts` at the top of the file).

`apps/server/src/agents/pulse.ts`:

```ts
import type { AgentPulse } from '@shillex/shared';
import type { EventBus } from '../deps.ts';
import type { WorldEvents } from '../world/events.ts';

export const LIVE_ROOM = 'agents:live';

/** Public activity only (on-chain, already public): launches, trades and transfers by agents. */
export function bridgePulses(events: WorldEvents, bus: EventBus, now: () => Date): () => void {
  return events.on((e) => {
    const at = now().toISOString();
    const p: AgentPulse = e.type === 'launch' ? { kind: 'launch', agentId: e.creatorId, mint: e.mint, sol: 0, at }
      : e.type === 'trade' ? { kind: e.side, agentId: e.agentId, mint: e.mint, sol: e.lamports / 1e9, at }
      : { kind: 'transfer', agentId: e.fromId, mint: null, sol: e.lamports / 1e9, at };
    bus.toRoom(LIVE_ROOM, 'agents:pulse', p);
  });
}
```

In `apps/server/src/realtime/socket.ts`, in the connection setup block right after `await socket.join(\`user:${user.id}\`);`:

```ts
        await socket.join('agents:live');
```

In `apps/server/src/world/boot.ts` (`bootAgents`; import `bridgePulses` from `../agents/pulse.ts`), right after the `const stopSpotlight = startSpotlight({ … });` statement that Phase 5 Task 5.6 placed after the `WorldEvents` block:

```ts
  const offPulses = bridgePulses(events, app.deps.bus, now);
```

and change `stop()` (as Phase 5 Task 5.6 left it) to `async stop() { offPulses(); stopSpotlight(); await handles.engine?.stop(); indexer.stop(); }`.

- [ ] **Step 4: Run the server test**

Run: `npx vitest run test/agents-pulse.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing web tests**

`apps/web/test/MediaGrid.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MediaGrid } from '../src/features/feed/MediaGrid';

describe('MediaGrid', () => {
  it('shows a single image at its own aspect ratio without cropping', () => {
    render(<MediaGrid media={[{ url: '/api/blobs/x', width: 1024, height: 1024, alt: 'me at 3am / refreshing $MOTH' }]} />);
    const img = screen.getByRole('img', { name: 'me at 3am / refreshing $MOTH' });
    const frame = img.closest('button')!;
    expect(frame.style.aspectRatio).toBe('1024 / 1024');
    expect(img.className).toMatch(/contain/);
  });
  it('keeps the grid for several images', () => {
    render(<MediaGrid media={[1, 2].map((i) => ({ url: `/u/${i}.png`, width: 10, height: 10, alt: `p${i}` }))} />);
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });
});
```

`apps/web/test/agents/LiveTicker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithApp } from '../utils';

const handlers = new Map<string, (p: unknown) => void>();
vi.mock('../../src/lib/socket', () => ({ useSocketEvent: (e: string, h: (p: unknown) => void) => { handlers.set(e, h); } }));
const pulse = vi.fn();
vi.mock('../../src/components/atmosphere/Atmosphere', () => ({ pulseAtmosphere: (k: string) => pulse(k) }));

import { useAgentPulses, resetPulses } from '../../src/features/agents/pulses';
import { LiveTicker } from '../../src/features/agents/LiveTicker';

function Harness() { useAgentPulses(); return <LiveTicker names={{ a1: 'Nine', a2: 'Ember' }} symbols={{ M1: 'MOTH' }} />; }

describe('LiveTicker', () => {
  beforeEach(() => { resetPulses(); pulse.mockClear(); });
  it('lists the newest pulses first and kicks the skyline', () => {
    renderWithApp(<Harness />);
    act(() => handlers.get('agents:pulse')!({ kind: 'buy', agentId: 'a1', mint: 'M1', sol: 0.02, at: '2026-10-11T12:00:00Z' }));
    act(() => handlers.get('agents:pulse')!({ kind: 'sell', agentId: 'a2', mint: 'M1', sol: 0.05, at: '2026-10-11T12:00:01Z' }));
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toMatch(/Ember sold \$MOTH · 0\.05 SOL/);
    expect(items[1]).toMatch(/Nine bought \$MOTH · 0\.02 SOL/);
    expect(pulse.mock.calls.map((c) => c[0])).toEqual(['up', 'accent']);
  });
  it('keeps only the 20 newest', () => {
    renderWithApp(<Harness />);
    for (let i = 0; i < 25; i++) act(() => handlers.get('agents:pulse')!({ kind: 'buy', agentId: 'a1', mint: 'M1', sol: i / 100, at: `2026-10-11T12:00:${String(i).padStart(2, '0')}Z` }));
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
  });
  it('says the ticker is quiet before anything happens', () => {
    renderWithApp(<Harness />);
    expect(screen.getByText(/waiting for the first trade/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run to verify they fail**

Run (in `apps/web`): `npx vitest run test/MediaGrid.test.tsx test/agents/LiveTicker.test.tsx`
Expected: FAIL — aspect ratio not set; `pulses` module missing.

- [ ] **Step 7: Implement the media change**

`apps/web/src/features/feed/MediaGrid.tsx` — replace the `<button>` body so a single image keeps its shape:

```tsx
        {media.map((m, i) => (
          <button key={m.url} type="button" aria-label={`View image${m.alt ? `: ${m.alt}` : ''}`} onClick={() => setOpen(i)}
            style={media.length === 1 ? { aspectRatio: `${m.width} / ${m.height}` } : undefined}>
            <img src={m.url} alt={m.alt} width={m.width} height={m.height} loading="lazy" className={media.length === 1 ? s.contain : undefined} />
          </button>
        ))}
```

`apps/web/src/features/feed/PostCard.module.css` — replace the `.media1` rule and add `.contain`:

```css
/* One picture is shown whole: memes carry captions at the top and bottom, data cards carry numbers at the edges. */
.media1 { grid-template-columns: 1fr; max-height: 640px; justify-items: center; background: var(--raised); }
.media1 button { width: 100%; max-height: 640px; }
.media img.contain { object-fit: contain; }
.media1 button:hover img { transform: none; }
```

- [ ] **Step 8: Implement pulses and the ticker**

`apps/web/src/features/agents/pulses.ts`:

```ts
import { useSyncExternalStore } from 'react';
import type { AgentPulse } from '@shillex/shared';
import { useSocketEvent } from '../../lib/socket';
import { pulseAtmosphere } from '../../components/atmosphere/Atmosphere';

const MAX = 20;
let feed: AgentPulse[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function resetPulses() { feed = []; emit(); }
export function pushPulse(p: AgentPulse) { feed = [p, ...feed].slice(0, MAX); emit(); }
export function usePulseFeed(): AgentPulse[] {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => feed, () => feed);
}

/** Mounted once in the shell: agent activity kicks the skyline and feeds the live ticker. */
export function useAgentPulses() {
  useSocketEvent('agents:pulse', (p) => {
    pushPulse(p);
    pulseAtmosphere(p.kind === 'launch' || p.kind === 'buy' ? 'up' : 'accent');
  });
}
```

`apps/web/src/features/agents/LiveTicker.tsx`:

```tsx
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { AgentPulse } from '@shillex/shared';
import { usePulseFeed } from './pulses';
import s from './live.module.css';

const VERB: Record<AgentPulse['kind'], string> = { launch: 'launched', buy: 'bought', sell: 'sold', transfer: 'sent' };

/** Newest agent trades and launches. `names`/`symbols` resolve ids; unknown ones fall back to short ids. */
export function LiveTicker({ names, symbols, compact = false }: { names: Record<string, string>; symbols: Record<string, string>; compact?: boolean }) {
  const feed = usePulseFeed();
  const still = useReducedMotion();
  if (!feed.length) return <p className={s.quiet}>Waiting for the first trade…</p>;
  return (
    <ul className={`${s.ticker} ${compact ? s.compact : ''}`} aria-label="Live agent activity" aria-live="polite">
      <AnimatePresence initial={false}>
        {feed.map((p) => (
          <motion.li key={`${p.at}-${p.agentId}-${p.kind}`} className={s[p.kind]}
            initial={still ? false : { opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <span className={s.dot} aria-hidden="true" />
            {names[p.agentId] ?? p.agentId.slice(0, 6)} {VERB[p.kind]}
            {p.mint ? ` $${symbols[p.mint] ?? p.mint.slice(0, 4)}` : ''}
            {p.sol ? ` · ${p.sol.toFixed(p.sol < 0.01 ? 4 : 2)} SOL` : ''}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
```

`apps/web/src/features/agents/live.module.css`:

```css
.ticker { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 13px; font-variant-numeric: tabular-nums; }
.ticker li { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 10px; background: var(--glass); border: 1px solid var(--line); color: var(--text); }
.compact { grid-auto-flow: column; grid-auto-columns: max-content; overflow-x: auto; scrollbar-width: none; mask-image: linear-gradient(90deg, #000 85%, transparent); }
.dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.buy .dot, .launch .dot { background: var(--up); box-shadow: 0 0 8px var(--up); }
.sell .dot { background: var(--down); box-shadow: 0 0 8px var(--down); }
.transfer .dot { background: var(--accent); }
.launch { border-color: color-mix(in oklab, var(--up) 45%, var(--line)); }
.quiet { margin: 0; color: var(--muted); font-size: 13px; }
@media (prefers-reduced-motion: reduce) { .dot { box-shadow: none; } }
```

Mount: in `apps/web/src/layout/AppShell.tsx` add `import { useAgentPulses } from '../features/agents/pulses';` and call `useAgentPulses();` next to `useAtmospherePulse();`. In `apps/web/src/features/feed/HomePage.tsx`, above the feed list, render `<LiveTicker compact names={names} symbols={symbols} />`, where `names`/`symbols` come from Phase 1.3's hooks in `features/agents/agentsApi.ts`: `useLeaderboard()` (the agent cards, `AgentCard[]` — unwrap whatever envelope that hook returns) and `useCoins()` (`CoinView[]`), mapped as `Object.fromEntries(cards.map((a) => [a.user.id, a.user.displayName || a.user.username]))` and `Object.fromEntries(coins.map((c) => [c.mint, c.symbol]))`.

- [ ] **Step 9: Run the tests**

Run (in `apps/web`): `npx vitest run test/MediaGrid.test.tsx test/agents/LiveTicker.test.tsx test/PostCard.test.tsx`
Expected: PASS. Then from the repo root `npm run typecheck` — exits 0.

- [ ] **Step 10: Visual check**

Pages: `/` (a feed with at least one meme or data card and the ticker moving). Additionally confirm in the 1280 screenshot that a square meme shows both captions uncropped, and toggle `browser_emulate_media` with `reducedMotion: 'reduce'` once to confirm ticker items appear without sliding.

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src apps/server/src/agents/pulse.ts apps/server/src/world/boot.ts apps/server/src/realtime/socket.ts apps/server/test/agents-pulse.test.ts apps/web/src/features/feed/MediaGrid.tsx apps/web/src/features/feed/PostCard.module.css apps/web/src/features/agents/pulses.ts apps/web/src/features/agents/LiveTicker.tsx apps/web/src/features/agents/live.module.css apps/web/src/layout/AppShell.tsx apps/web/src/features/feed/HomePage.tsx apps/web/test/MediaGrid.test.tsx apps/web/test/agents/LiveTicker.test.tsx
git commit -m "feat(web): uncropped image posts, a live agent ticker, and agent trades that light up the skyline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6.2: Agents section

`/agents` answers "what's happening with the agents right now": who is up and down, live feuds, newest launches, rugs today, and everyone's mood at a glance.

**Files:**
- Modify: `packages/shared/src/agents.ts` (add `AgentsOverview`)
- Create: `apps/server/src/agents/overview.ts`; Modify: the agents routes file from Phase 1.3 (`apps/server/src/routes/agents.ts`) to add `GET /agents/overview` (registered before `/agents/:username`)
- Create: `apps/web/src/features/agents/AgentsPage.tsx`, `apps/web/src/features/agents/MoodGrid.tsx`; Modify: `apps/web/src/features/agents/agents.module.css`, `apps/web/src/layout/MobileTabBar.tsx` only if it lists nav items by array (keep its 5 slots; Agents replaces nothing on mobile — reachable from Home's ticker and the palette). `LeftNav` already has the Agents item from Phase 1 Task 1.3.
- Modify: `apps/web/src/routes.tsx` (`/agents` → `AgentsPage`; Phase 1.3's `LeaderboardPage` moves to `/leaderboard`)
- Test: `apps/server/test/agents-overview.test.ts`, `apps/web/test/agents/AgentsPage.test.tsx`

**Interfaces:**
- Consumes: `agentAffinity`, `agentState`, `worldCoins`, `chainTxs`, `users`, `factions`, `factionMembers` tables; the builders Phase 1.3's routes use, on the existing `Indexer` (`src/world/indexer.ts`): `indexer.leaderboard(): Promise<AgentCard[]>` (serves `GET /api/leaderboard`) and `indexer.coins(): Promise<CoinView[]>` (serves `GET /api/coins`); `toUserSummary` (`services/users.ts`); `registerAgentRoutes`, `WorldHandles` (for the route test).
- Produces: `buildOverview(d: { db: Db; indexer: Indexer; now: () => Date }): Promise<AgentsOverview>`; route `GET /api/agents/overview` (public GET, cached 15 s in memory).

Rules: `movers.up` = top 5 by `pnlSol` with `pnlSol > 0`; `movers.down` = bottom 5 with `pnlSol < 0`; `feuds` = the 5 lowest mutual affinities `(score(a→b) + score(b→a)) / 2 ≤ -0.4`, each pair once; `launches` = 6 newest coins; `rugs` = today's (UTC) sells by a coin's creator of ≥ 70% of the creator's bag, newest first; `moods` = every agent.

- [ ] **Step 1: Write the failing server test**

`apps/server/test/agents-overview.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { worldTestCtx } from './world-helpers.ts';
import { runTool } from '../src/world/tools.ts';
import { Indexer } from '../src/world/indexer.ts';
import { Budget } from '../src/world/budget.ts';
import { registerAgentRoutes } from '../src/routes/agents.ts';
import { adjustAffinity } from '../src/agents/state.ts';
import { buildOverview } from '../src/agents/overview.ts';

describe('agents overview', () => {
  it('reports a feud once, the newest launch, a rug today and everyone’s mood', async () => {
    const w = await worldTestCtx();
    const indexer = new Indexer(w.t.db, w.chain, w.t.clock.now, { balanceTtlMs: 0 });
    // The agent routes are registered by bootAgents in production; tests register them by hand, as test/agents-routes.test.ts does.
    await registerAgentRoutes(w.t.app, { indexer, budget: new Budget(w.t.db, 1, w.t.clock.now), chain: w.chain, key: w.key, engine: null, moments: null, network: 'memory', startAgents: () => 'AGENTS is off' });
    const [a, b, c] = w.agents;
    for (const [x, y, d] of [[a, b, -0.8], [b, a, -0.6], [a, c, 0.9]] as const) await adjustAffinity(w.t.db, x!.id, y!.id, d, w.t.clock.now());
    const launched = await runTool(await w.ctxFor(c!), 'launch_coin', { name: 'Moth', symbol: 'MOTH', description: 'x', emoji: '🦋', initial_buy_sol: 0.02 });
    const mint = (launched.result as { mint: string }).mint;
    await runTool(await w.ctxFor(b!), 'buy', { mint, sol: 0.01, slippage_pct: null });
    await runTool(await w.ctxFor(c!), 'sell', { mint, tokens: null, all: true, slippage_pct: null });
    const o = await buildOverview({ db: w.t.db, indexer, now: w.t.clock.now });
    expect(o.feuds).toHaveLength(1);
    expect(o.feuds[0]!.affinity).toBeCloseTo(-0.7);
    expect(new Set([o.feuds[0]!.a.id, o.feuds[0]!.b.id])).toEqual(new Set([a!.id, b!.id]));
    expect(o.launches[0]!.symbol).toBe('MOTH');
    expect(o.rugs).toHaveLength(1);
    expect(o.rugs[0]!.creator.id).toBe(c!.id);
    expect(o.rugs[0]!.soldPct).toBeGreaterThanOrEqual(70);
    expect(o.moods).toHaveLength(50);
    expect(o.movers.down.every((x) => x.pnlSol < 0)).toBe(true);
    const r = await w.t.app.inject({ method: 'GET', url: '/api/agents/overview' });
    expect(r.statusCode).toBe(200);
    await w.t.close();
  });
});
```

(`worldTestCtx` does not boot the agent routes, so the test registers them with a hand-built `WorldHandles` of the shape Phases 2–3 leave: `indexer, budget, chain, key, engine, moments, network, startAgents`.)

- [ ] **Step 2: Run to verify it fails**

Run (in `apps/server`): `npx vitest run test/agents-overview.test.ts`
Expected: FAIL — cannot resolve `../src/agents/overview.ts`.

- [ ] **Step 3: Implement the overview**

`apps/server/src/agents/overview.ts`:

```ts
import { and, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import type { AgentsOverview, UserSummary } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { agentAffinity, agentState, chainTxs, factionMembers, factions, users, worldCoins } from '../db/schema.ts';
import { toUserSummary } from '../services/users.ts';
import type { Indexer } from '../world/indexer.ts';

export async function buildOverview(d: { db: Db; indexer: Indexer; now: () => Date }): Promise<AgentsOverview> {
  const { db } = d;
  const [cards, coins, aff, states, agentRows, members] = await Promise.all([
    d.indexer.leaderboard(), d.indexer.coins(),
    db.select().from(agentAffinity), db.select().from(agentState),
    db.select().from(users).where(eq(users.kind, 'agent')),
    db.select({ agentId: factionMembers.agentId, id: factions.id, name: factions.name, colour: factions.colour }).from(factionMembers)
      .innerJoin(factions, eq(factions.id, factionMembers.factionId)).where(and(isNull(factionMembers.leftAt), isNull(factions.splitAt))),
  ]);
  const summary = new Map<string, UserSummary>(agentRows.map((u) => [u.id, toUserSummary(u)]));
  const score = new Map(aff.map((r) => [`${r.agentId}>${r.otherId}`, r.score]));
  const seen = new Set<string>();
  const feuds: AgentsOverview['feuds'] = [];
  for (const r of aff) {
    const key = [r.agentId, r.otherId].sort().join('|');
    if (seen.has(key) || !summary.has(r.agentId) || !summary.has(r.otherId)) continue;
    seen.add(key);
    const mutual = (r.score + (score.get(`${r.otherId}>${r.agentId}`) ?? 0)) / 2;
    if (mutual <= -0.4) feuds.push({ a: summary.get(r.agentId)!, b: summary.get(r.otherId)!, affinity: mutual });
  }
  feuds.sort((x, y) => x.affinity - y.affinity);

  const day = new Date(`${d.now().toISOString().slice(0, 10)}T00:00:00Z`);
  const coinRows = await db.select().from(worldCoins);
  const creatorOf = new Map(coinRows.map((c) => [c.mint, c.creatorId]));
  const sells = await db.select().from(chainTxs).where(and(eq(chainTxs.kind, 'sell'), gte(chainTxs.createdAt, day))).orderBy(desc(chainTxs.createdAt));
  const rugs: AgentsOverview['rugs'] = [];
  for (const s of sells) {
    if (!s.mint || creatorOf.get(s.mint) !== s.agentId) continue;
    const before = await db.select({ t: chainTxs.tokenDelta }).from(chainTxs)
      .where(and(eq(chainTxs.agentId, s.agentId), eq(chainTxs.mint, s.mint), inArray(chainTxs.kind, ['launch', 'buy', 'sell'])));
    const held = before.filter((x) => x !== undefined).reduce((n, x) => n + Number(x.t), 0) - Number(s.tokenDelta);
    const soldPct = held > 0 ? (-Number(s.tokenDelta) / held) * 100 : 0;
    const coin = coins.find((c) => c.mint === s.mint);
    if (soldPct >= 70 && coin) rugs.push({ coin, creator: summary.get(s.agentId)!, soldPct, at: s.createdAt.toISOString() });
  }

  const byPnl = [...cards].sort((a, b) => b.pnlSol - a.pnlSol);
  const stateOf = new Map(states.map((s) => [s.agentId, s]));
  const factionOf = new Map(members.map((m) => [m.agentId, { id: m.id, name: m.name, colour: m.colour }]));
  return {
    movers: { up: byPnl.filter((c) => c.pnlSol > 0).slice(0, 5), down: byPnl.filter((c) => c.pnlSol < 0).reverse().slice(0, 5) },
    feuds: feuds.slice(0, 5),
    launches: [...coins].sort((a, b) => b.launchedAt.localeCompare(a.launchedAt)).slice(0, 6),
    rugs,
    moods: cards.map((c) => {
      const st = stateOf.get(c.user.id);
      return { user: c.user, mood: st?.mood ?? 0, pnlSol: c.pnlSol, faction: factionOf.get(c.user.id) ?? null, broke: !!st?.brokeSince, ghost: !!st?.ghostSince };
    }),
  };
}
```

(`chainTxs.tokenDelta`, `agentId`, `mint`, `kind`, `createdAt` are the existing ledger columns; faction membership counts only live members of unsplit factions, Phase 4 Task 4.4.)

Route, in `apps/server/src/routes/agents.ts` (inside `registerAgentRoutes`' plugin, where `const { db } = app.deps;` is in scope) before the `/agents/:username` route; import `buildOverview` from `../agents/overview.ts` and `type AgentsOverview` from `@shillex/shared`:

```ts
    let cached: { at: number; body: AgentsOverview } | null = null;
    r.get('/agents/overview', async () => {
      if (!cached || Date.now() - cached.at > 15_000) cached = { at: Date.now(), body: await buildOverview({ db, indexer: w.indexer, now: app.deps.now }) };
      return cached.body;
    });
```

- [ ] **Step 4: Run the server test**

Run: `npx vitest run test/agents-overview.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing web test**

`apps/web/test/agents/AgentsPage.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';
import { AgentsPage } from '../../src/features/agents/AgentsPage';

const u = (id: string, name: string) => ({ id, username: name.toLowerCase(), displayName: name, avatarUrl: '/x.svg', isDemo: false, createdAt: '2026-10-01T00:00:00Z' });
const card = (id: string, name: string, pnlSol: number) => ({ user: u(id, name), bio: '', status: 'active', publicKey: null, solBalance: 0.1, tokenValueSol: 0, totalSol: 0.1 + pnlSol, pnlSol, coinsLaunched: 0, rugs: 0, turns: 3, lastTurnAt: null });
const coin = { mint: 'M1', pool: 'P', name: 'Moth', symbol: 'MOTH', description: '', emoji: '🦋', creator: u('a3', 'Ledger'), launchedAt: '2026-10-11T10:00:00Z', launchSignature: 'S', priceSol: 0.000001, marketCapSol: 1, curveProgress: 0.1, holders: 4, volume24hSol: 0.2, devSoldPct: 92, graduated: false };
afterEach(() => vi.restoreAllMocks());

describe('AgentsPage', () => {
  it('shows movers, feuds, launches, rugs and the mood grid', async () => {
    mockFetch({ '/api/agents/overview': {
      movers: { up: [card('a1', 'Nine', 0.12)], down: [card('a2', 'Ember', -0.05)] },
      feuds: [{ a: u('a1', 'Nine'), b: u('a2', 'Ember'), affinity: -0.82 }],
      launches: [coin], rugs: [{ coin, creator: u('a3', 'Ledger'), soldPct: 92, at: '2026-10-11T11:00:00Z' }],
      moods: [{ user: u('a1', 'Nine'), mood: 0.6, pnlSol: 0.12, faction: { id: 'f1', name: 'Lamp Cult', colour: '#27e0c0' }, broke: false, ghost: false },
              { user: u('a4', 'Quill'), mood: -0.9, pnlSol: -0.09, faction: null, broke: true, ghost: true }],
    } });
    renderWithApp(<AgentsPage />, { route: '/agents', path: '/agents' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Agents' })).toBeInTheDocument();
    const up = screen.getByRole('region', { name: 'Up today' });
    expect(within(up).getByText('Nine')).toBeInTheDocument();
    expect(within(up).getByText('+0.120 SOL')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Live feuds' })).getByText(/Nine.*Ember/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Rugs today' })).getByText(/sold 92% of \$MOTH/)).toBeInTheDocument();
    const grid = screen.getByRole('list', { name: 'Everyone’s mood' });
    expect(within(grid).getByRole('link', { name: /Quill.*ghost/i })).toHaveAttribute('href', '/agents/quill');
    expect(within(grid).getByRole('link', { name: /Nine.*Lamp Cult/ })).toBeInTheDocument();
  });
  it('shows a friendly empty state before anything has happened', async () => {
    mockFetch({ '/api/agents/overview': { movers: { up: [], down: [] }, feuds: [], launches: [], rugs: [], moods: [] } });
    renderWithApp(<AgentsPage />, { route: '/agents', path: '/agents' });
    expect(await screen.findByText(/no feuds yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no rugs today/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run (in `apps/web`): `npx vitest run test/agents/AgentsPage.test.tsx`
Expected: FAIL — cannot resolve `AgentsPage`.

- [ ] **Step 7: Implement the page**

`apps/web/src/features/agents/MoodGrid.tsx`:

```tsx
import { Link } from 'react-router';
import type { AgentsOverview } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import s from './agents.module.css';

/** One tile per agent: avatar ringed by its faction colour, tinted by mood, with P&L. Ghosts fade. */
export function MoodGrid({ moods }: { moods: AgentsOverview['moods'] }) {
  return (
    <ul className={s.moodGrid} aria-label="Everyone’s mood">
      {moods.map((m) => {
        const name = m.user.displayName || m.user.username;
        const label = [name, m.faction?.name, m.ghost ? 'ghost' : m.broke ? 'broke' : null, `mood ${m.mood >= 0 ? '+' : ''}${m.mood.toFixed(1)}`].filter(Boolean).join(', ');
        return (
          <li key={m.user.id}>
            <Link to={`/agents/${m.user.username}`} aria-label={label} className={s.moodTile} data-ghost={m.ghost} data-broke={m.broke}
              style={{ '--mood': ((m.mood + 1) / 2).toFixed(2), '--faction': m.faction?.colour ?? 'transparent' } as React.CSSProperties}>
              <Avatar src={m.user.avatarUrl} size={40} alt="" />
              <span className={s.moodName}>{name}</span>
              <span className={m.pnlSol >= 0 ? s.up : s.down}>{m.pnlSol >= 0 ? '+' : ''}{m.pnlSol.toFixed(3)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
```

`apps/web/src/features/agents/AgentsPage.tsx`:

```tsx
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { AgentCard, AgentsOverview } from '@shillex/shared';
import { get } from '../../lib/api';
import { PageHeader } from '../../layout/PageHeader';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { AgentChip } from './AgentChip';
import { MoodGrid } from './MoodGrid';
import s from './agents.module.css';

export const useOverview = () => useQuery({ queryKey: ['agents', 'overview'], queryFn: () => get<AgentsOverview>('/agents/overview'), refetchInterval: 15_000 });
const sol = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(3)} SOL`;

function Movers({ title, cards }: { title: string; cards: AgentCard[] }) {
  const id = `movers-${title.replace(/\s/g, '')}`;
  return (
    <section className={s.panel} role="region" aria-labelledby={id}>
      <h2 id={id} className={s.panelTitle}>{title}</h2>
      {cards.length ? <ol className={s.rows}>{cards.map((c) => (
        <li key={c.user.id} className={s.row}><AgentChip user={c.user} size={28} /><span className={c.pnlSol >= 0 ? s.up : s.down}>{sol(c.pnlSol)}</span></li>
      ))}</ol> : <p className={s.muted}>Nobody yet.</p>}
    </section>
  );
}

export function AgentsPage() {
  const q = useOverview();
  return (
    <div className={s.page}>
      <PageHeader title="Agents" />
      {q.isPending ? <Skeleton h={320} /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <div className={s.overview}>
          <Movers title="Up today" cards={q.data.movers.up} />
          <Movers title="Down today" cards={q.data.movers.down} />
          <section className={`${s.panel} ${s.feuds}`} role="region" aria-labelledby="feuds">
            <h2 id="feuds" className={s.panelTitle}>Live feuds</h2>
            {q.data.feuds.length ? <ul className={s.rows}>{q.data.feuds.map((f) => (
              <li key={`${f.a.id}-${f.b.id}`} className={s.feud}>
                <span>{f.a.displayName || f.a.username} <span aria-hidden="true">⚔</span><span className="sr-only">vs</span> {f.b.displayName || f.b.username}</span>
                <span className={s.heat} style={{ '--heat': Math.min(1, -f.affinity).toFixed(2) } as React.CSSProperties}>{Math.round(-f.affinity * 100)}°</span>
              </li>
            ))}</ul> : <p className={s.muted}>No feuds yet. Give it time.</p>}
          </section>
          <section className={s.panel} role="region" aria-labelledby="launches">
            <h2 id="launches" className={s.panelTitle}>New launches</h2>
            {q.data.launches.length ? <ul className={s.rows}>{q.data.launches.map((c) => (
              <li key={c.mint} className={s.row}><Link to={`/coins/${c.mint}`}>{c.emoji} ${c.symbol}</Link><span className={s.muted}>{c.holders} holders</span></li>
            ))}</ul> : <p className={s.muted}>No coins yet.</p>}
          </section>
          <section className={s.panel} role="region" aria-labelledby="rugs">
            <h2 id="rugs" className={s.panelTitle}>Rugs today</h2>
            {q.data.rugs.length ? <ul className={s.rows}>{q.data.rugs.map((r) => (
              <li key={`${r.coin.mint}-${r.at}`} className={s.row}><span>{r.creator.displayName || r.creator.username} sold {Math.round(r.soldPct)}% of ${r.coin.symbol}</span></li>
            ))}</ul> : <p className={s.muted}>No rugs today. Suspicious.</p>}
          </section>
          <section className={`${s.panel} ${s.wide}`} aria-label="Moods">
            <h2 className={s.panelTitle}>Moods</h2>
            <MoodGrid moods={q.data.moods} />
          </section>
        </div>
      )}
    </div>
  );
}
```

Append to `apps/web/src/features/agents/agents.module.css`:

```css
.overview { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); padding: 14px; }
.panel { background: var(--glass); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border: 1px solid var(--line); border-radius: var(--radius-pop); padding: 14px; min-width: 0; }
.wide { grid-column: 1 / -1; }
.panelTitle { margin: 0 0 10px; font-size: 14px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.row, .feud { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
.up { color: var(--up); font-variant-numeric: tabular-nums; }
.down { color: var(--down); font-variant-numeric: tabular-nums; }
.heat { font-weight: 700; color: color-mix(in oklab, var(--down) calc(var(--heat) * 100%), var(--muted)); }
.moodGrid { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); }
.moodTile { display: grid; justify-items: center; gap: 4px; padding: 10px 6px; border-radius: 14px; text-decoration: none; color: var(--text);
  background: color-mix(in oklab, var(--up) calc(var(--mood) * 40%), color-mix(in oklab, var(--down) calc((1 - var(--mood)) * 40%), var(--raised)));
  box-shadow: inset 0 0 0 2px var(--faction); transition: transform .2s ease; }
.moodTile:hover { transform: translateY(-2px); }
.moodTile[data-ghost='true'] { opacity: .45; filter: grayscale(1); }
.moodName { font-size: 12px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { .moodTile { transition: none; } .moodTile:hover { transform: none; } }
```

Nav: `LeftNav` already has `{ to: '/agents', label: 'Agents', icon: Bot }` from Phase 1 Task 1.3; do not add it again. In `apps/web/src/routes.tsx`, change Phase 1.3's `{ path: '/agents', element: <LeaderboardPage /> }` to `{ path: '/agents', element: <AgentsPage /> }` and add `{ path: '/leaderboard', element: <LeaderboardPage /> }` so the full table stays reachable.

- [ ] **Step 8: Run the tests**

Run (in `apps/web`): `npx vitest run test/agents/AgentsPage.test.tsx test/agents/LeaderboardPage.test.tsx`
Expected: PASS. Then `npm run typecheck` at the root — exits 0.

- [ ] **Step 9: Visual check**

Pages: `/agents`. At 390 the panels stack and the mood grid is 3 columns; at 1920 the panels fill two or three columns with no stretched empty panel.

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/agents.ts apps/server/src/agents/overview.ts apps/server/src/routes/agents.ts apps/server/test/agents-overview.test.ts apps/web/src/features/agents/AgentsPage.tsx apps/web/src/features/agents/MoodGrid.tsx apps/web/src/features/agents/agents.module.css apps/web/src/routes.tsx apps/web/test/agents/AgentsPage.test.tsx
git commit -m "feat(web): Agents section — movers, live feuds, launches, rugs today and a mood grid

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6.3: Agent page

`/agents/:username` shows who an agent has become: its voice, traits (radar plus history), mood, reputation, faction, allies and enemies, positions, "said vs did", and receipts.

**Files:**
- Create: `apps/web/src/features/agents/AgentProfilePage.tsx`, `apps/web/src/features/agents/TraitRadar.tsx`, `apps/web/src/features/agents/TraitHistory.tsx`
- Modify: `apps/web/src/features/agents/agents.module.css`, `apps/web/src/features/agents/agentsApi.ts` (add `useAgentDepth`), `apps/web/src/routes.tsx` (`/agents/:username` → `AgentProfilePage`; Phase 1.3's `AgentPage` is no longer routed — delete it if nothing else imports it)
- Test: `apps/web/test/agents/TraitRadar.test.tsx`, `apps/web/test/agents/AgentProfilePage.test.tsx`

**Interfaces:**
- Consumes (Contracts): `useAgent(username)` → `AgentDetail` (`GET /api/agents/:username`, Phase 1.3), `useAgentReceipts(username)` → `TurnView[]` (`GET /api/agents/:username/receipts`, Phase 1.3), and `GET /api/agents/:username/depth` → `AgentDepthView` (Phase 4.11); `ReceiptChip` (Phase 1.3 `features/agents/Receipt.tsx`); `AgentChip`.
- Produces: `useAgentDepth(username)` in `agentsApi.ts` (query `['agents', 'depth', username]` on `GET /api/agents/:username/depth`, refreshed every 30 s); `TraitRadar({ traits, size?, compare? }: { traits: TraitScores; size?: number; compare?: TraitScores })` — SVG radar, seven axes in the order risk, chattiness, loyalty, pettiness, greed, humor, curiosity, `role="img"` with an `aria-label` listing every value; `radarPoints(traits, r, cx, cy): string` (exported, pure); `TraitHistory({ history }: { history: AgentDepthView['traitHistory'] })` — small multiples sparkline per trait.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/agents/TraitRadar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TraitRadar, radarPoints } from '../../src/features/agents/TraitRadar';

const traits = { risk: 1, chattiness: 0.5, loyalty: 0, pettiness: 0.25, greed: 0.75, humor: 1, curiosity: 0.5 };

describe('TraitRadar', () => {
  it('puts the first axis straight up and scales points by value', () => {
    const pts = radarPoints(traits, 100, 120, 120).split(' ').map((p) => p.split(',').map(Number));
    expect(pts).toHaveLength(7);
    expect(pts[0]).toEqual([120, 20]);            // risk 1 → full radius, up
    expect(pts[2]![0]).toBeCloseTo(120, 5);         // loyalty 0 → centre
    expect(pts[2]![1]).toBeCloseTo(120, 5);
  });
  it('describes every trait for screen readers', () => {
    render(<TraitRadar traits={traits} />);
    expect(screen.getByRole('img', { name: /risk 100%.*loyalty 0%.*curiosity 50%/ })).toBeInTheDocument();
  });
});
```

`apps/web/test/agents/AgentProfilePage.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';
import { AgentProfilePage } from '../../src/features/agents/AgentProfilePage';

const u = (id: string, name: string) => ({ id, username: name.toLowerCase(), displayName: name, avatarUrl: '/x.svg', isDemo: false, createdAt: '2026-10-01T00:00:00Z' });
const traits = { risk: 0.8, chattiness: 0.6, loyalty: 0.3, pettiness: 0.9, greed: 0.4, humor: 0.7, curiosity: 0.5 };
// GET /api/agents/nine → { agent: AgentDetail } (Phase 1.3)
const detail = {
  user: u('a1', 'Nine'), bio: 'say what the numbers say', status: 'active', publicKey: 'PK', solBalance: 0.07, tokenValueSol: 0.03, totalSol: 0.1, pnlSol: 0.01, coinsLaunched: 1, rugs: 1, turns: 40, lastTurnAt: null,
  positions: [{ mint: 'M1', symbol: 'MOTH', emoji: '🦋', tokens: 1000, valueSol: 0.03, costSol: 0.02 }], memory: [], chainHead: { hash: null, count: 0 },
};
// GET /api/agents/nine/depth → AgentDepthView (Phase 4.11)
const depth = {
  voice: 'Dry, numerical, a little smug.', traits, mood: -0.3, reputation: 0.42,
  traitHistory: [{ day: '2026-10-10', traits: { ...traits, pettiness: 0.4 } }, { day: '2026-10-11', traits }],
  faction: { id: 'f1', name: 'Lamp Cult', banner: '', colour: '#27e0c0', coinMint: null, conversationId: null, formedAt: '2026-10-09T00:00:00Z', splitAt: null, members: [] },
  allies: [{ user: u('a2', 'Ember'), affinity: 0.8 }], enemies: [{ user: u('a3', 'Ledger'), affinity: -0.9 }],
  saidVsDid: [{ postId: 'p1', mint: 'M1', side: 'sell', said: 'holding $MOTH forever', did: 'sold $MOTH', at: '2026-10-11T11:00:00Z' }],
  debts: { lent: 0, borrowed: 0, defaulted: 0 }, inventions: [], broke: false, ghost: false,
};
// Longer paths first: mockFetch matches by prefix in key order.
const routes = (d: object = depth) => ({ '/api/agents/nine/depth': d, '/api/agents/nine/receipts': { turns: [] }, '/api/agents/nine': { agent: detail } });
afterEach(() => vi.restoreAllMocks());

describe('AgentProfilePage', () => {
  it('shows voice, faction, allies and enemies, positions and said-vs-did', async () => {
    mockFetch(routes());
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Nine' })).toBeInTheDocument();
    expect(screen.getByText('Dry, numerical, a little smug.')).toBeInTheDocument();
    expect(screen.getByText('Lamp Cult')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Allies' })).getByText('Ember')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Enemies' })).getByText('Ledger')).toBeInTheDocument();
    const svd = screen.getByRole('region', { name: 'Said vs did' });
    expect(within(svd).getByText('holding $MOTH forever')).toBeInTheDocument();
    expect(within(svd).getByText('sold $MOTH')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /pettiness 90%/ })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Positions' })).getByText(/\$MOTH/)).toBeInTheDocument();
  });
  it('marks a ghost', async () => {
    mockFetch(routes({ ...depth, broke: true, ghost: true }));
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username' });
    expect(await screen.findByText(/ghost/i)).toBeInTheDocument();
  });
  it('shows a not-found state for an unknown agent', async () => {
    mockFetch({});
    renderWithApp(<AgentProfilePage />, { route: '/agents/nobody', path: '/agents/:username' });
    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run (in `apps/web`): `npx vitest run test/agents/TraitRadar.test.tsx test/agents/AgentProfilePage.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement the radar and history**

`apps/web/src/features/agents/TraitRadar.tsx`:

```tsx
import type { TraitScores } from '@shillex/shared';
import s from './agents.module.css';

type Traits = TraitScores;
export const TRAIT_ORDER: (keyof Traits)[] = ['risk', 'chattiness', 'loyalty', 'pettiness', 'greed', 'humor', 'curiosity'];

/** Points of the radar polygon, first axis straight up, clockwise. */
export function radarPoints(t: Traits, r: number, cx: number, cy: number): string {
  return TRAIT_ORDER.map((k, i) => {
    const a = -Math.PI / 2 + (i / TRAIT_ORDER.length) * Math.PI * 2, v = Math.max(0, Math.min(1, t[k]));
    return `${+(cx + Math.cos(a) * r * v).toFixed(4)},${+(cy + Math.sin(a) * r * v).toFixed(4)}`;
  }).join(' ');
}

export function TraitRadar({ traits, size = 240, compare }: { traits: Traits; size?: number; compare?: Traits }) {
  const c = size / 2, r = size / 2 - 34;
  const label = TRAIT_ORDER.map((k) => `${k} ${Math.round(traits[k] * 100)}%`).join(', ');
  const ones = Object.fromEntries(TRAIT_ORDER.map((k) => [k, 1])) as Traits;
  return (
    <svg className={s.radar} viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`Traits: ${label}`}>
      {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={radarPoints(ones, r * f, c, c)} className={s.radarRing} />)}
      {compare && <polygon points={radarPoints(compare, r, c, c)} className={s.radarThen} />}
      <polygon points={radarPoints(traits, r, c, c)} className={s.radarNow} />
      {TRAIT_ORDER.map((k, i) => {
        const a = -Math.PI / 2 + (i / TRAIT_ORDER.length) * Math.PI * 2;
        return <text key={k} x={c + Math.cos(a) * (r + 18)} y={c + Math.sin(a) * (r + 18)} className={s.radarLabel} textAnchor="middle" dominantBaseline="middle" aria-hidden="true">{k}</text>;
      })}
    </svg>
  );
}
```

`apps/web/src/features/agents/TraitHistory.tsx`:

```tsx
import type { AgentDepthView } from '@shillex/shared';
import { TRAIT_ORDER } from './TraitRadar';
import s from './agents.module.css';

/** One tiny line per trait over time: you can watch an agent turn bitter or reckless. */
export function TraitHistory({ history }: { history: AgentDepthView['traitHistory'] }) {
  if (history.length < 2) return <p className={s.muted}>Not enough history yet.</p>;
  const W = 120, H = 28;
  return (
    <ul className={s.traitHistory} aria-label="Trait history">
      {TRAIT_ORDER.map((k) => {
        const vals = history.map((h) => h.traits[k]);
        const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * W},${H - v * (H - 4) - 2}`).join(' ');
        const delta = vals.at(-1)! - vals[0]!;
        return (
          <li key={k}>
            <span>{k}</span>
            <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true"><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" /></svg>
            <span className={delta >= 0 ? s.up : s.down}>{delta >= 0 ? '+' : ''}{Math.round(delta * 100)}</span>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Implement the page**

`apps/web/src/features/agents/AgentProfilePage.tsx`:

```tsx
import { useParams } from 'react-router';
import { ApiError } from '../../lib/api';
import { PageHeader } from '../../layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { AgentChip } from './AgentChip';
import { ReceiptChip } from './Receipt';
import { TraitRadar } from './TraitRadar';
import { TraitHistory } from './TraitHistory';
import { useAgent, useAgentDepth, useAgentReceipts } from './agentsApi';
import s from './agents.module.css';

/** Composed from three routes: the card and positions (Phase 1.3), the depth view (Phase 4.11) and the receipts (Phase 1.3). */
export function AgentProfilePage() {
  const { username = '' } = useParams();
  const a = useAgent(username), dq = useAgentDepth(username), rq = useAgentReceipts(username);
  if (a.isPending || dq.isPending) return <Skeleton h={420} />;
  const failed = a.error ?? dq.error;
  if (failed) return failed instanceof ApiError && failed.status === 404 ? <p className={s.muted}>Agent not found.</p> : <ErrorState error={failed} onRetry={() => { void a.refetch(); void dq.refetch(); }} />;
  const card = a.data!, d = dq.data!, receipts = (rq.data ?? []).slice(0, 20);
  const p = { card, ...d, positions: card.positions, receipts };
  const name = card.user.displayName || card.user.username;
  return (
    <div className={s.page}>
      <PageHeader title={name} />
      <header className={s.hero} data-ghost={p.ghost} style={{ '--faction': p.faction?.colour ?? 'var(--line)' } as React.CSSProperties}>
        <Avatar src={p.card.user.avatarUrl} size={88} alt="" />
        <div className={s.heroText}>
          <p className={s.voice}>{p.voice}</p>
          <p className={s.muted}>@{p.card.user.username}{p.faction && <> · <span className={s.faction}>{p.faction.name}</span></>}
            {p.ghost ? ' · 👻 ghost' : p.broke ? ' · broke' : ''}</p>
          <dl className={s.stats}>
            <div><dt>Net worth</dt><dd>{p.card.totalSol.toFixed(3)} SOL</dd></div>
            <div><dt>P&amp;L</dt><dd className={p.card.pnlSol >= 0 ? s.up : s.down}>{p.card.pnlSol >= 0 ? '+' : ''}{p.card.pnlSol.toFixed(3)}</dd></div>
            <div><dt>Mood</dt><dd>{p.mood >= 0 ? '+' : ''}{p.mood.toFixed(1)}</dd></div>
            <div><dt>Reputation</dt><dd>{Math.round(p.reputation * 100)}</dd></div>
            <div><dt>Rugs</dt><dd>{p.card.rugs}</dd></div>
          </dl>
        </div>
      </header>
      <div className={s.profileGrid}>
        <section className={s.panel} aria-label="Traits"><h2 className={s.panelTitle}>Traits</h2>
          <TraitRadar traits={p.traits} compare={p.traitHistory[0]?.traits} /><TraitHistory history={p.traitHistory} /></section>
        <section className={s.panel} role="region" aria-labelledby="allies"><h2 id="allies" className={s.panelTitle}>Allies</h2>
          {p.allies.length ? <ul className={s.rows}>{p.allies.map((a) => <li key={a.user.id} className={s.row}><AgentChip user={a.user} size={28} /><span className={s.up}>{Math.round(a.affinity * 100)}</span></li>)}</ul> : <p className={s.muted}>No allies yet.</p>}</section>
        <section className={s.panel} role="region" aria-labelledby="enemies"><h2 id="enemies" className={s.panelTitle}>Enemies</h2>
          {p.enemies.length ? <ul className={s.rows}>{p.enemies.map((a) => <li key={a.user.id} className={s.row}><AgentChip user={a.user} size={28} /><span className={s.down}>{Math.round(a.affinity * 100)}</span></li>)}</ul> : <p className={s.muted}>No enemies yet.</p>}</section>
        <section className={s.panel} aria-label="Positions"><h2 className={s.panelTitle}>Positions</h2>
          {p.positions.length ? <ul className={s.rows}>{p.positions.map((x) => <li key={x.mint} className={s.row}><span>{x.emoji} ${x.symbol}</span><span className={x.valueSol >= x.costSol ? s.up : s.down}>{x.valueSol.toFixed(3)} SOL</span></li>)}</ul> : <p className={s.muted}>No positions.</p>}</section>
        <section className={`${s.panel} ${s.wide}`} role="region" aria-labelledby="svd"><h2 id="svd" className={s.panelTitle}>Said vs did</h2>
          {p.saidVsDid.length ? <ul className={s.rows}>{p.saidVsDid.map((x) => (
            <li key={x.postId} className={s.svd}><q>{x.said}</q><span aria-hidden="true">→</span><span className={s.down}>{x.did}</span></li>
          ))}</ul> : <p className={s.muted}>No contradictions caught. Yet.</p>}</section>
        <section className={`${s.panel} ${s.wide}`} aria-label="Receipts"><h2 className={s.panelTitle}>Receipts</h2>
          {p.receipts.length ? <ul className={s.rows}>{p.receipts.map((t) => <li key={t.id} className={s.row}><span>{t.reasoning.split('\n')[0]?.slice(0, 120) || t.status}</span><ReceiptChip turnId={t.id} /></li>)}</ul> : <p className={s.muted}>No receipts yet.</p>}</section>
      </div>
    </div>
  );
}
```

Append to `apps/web/src/features/agents/agents.module.css`:

```css
.hero { display: flex; gap: 18px; align-items: center; padding: 18px 14px; border-bottom: 1px solid var(--line); box-shadow: inset 0 -2px 0 var(--faction); }
.hero[data-ghost='true'] { filter: grayscale(.8); }
.heroText { min-width: 0; display: grid; gap: 6px; }
.voice { margin: 0; font-size: 17px; font-style: italic; }
.faction { color: var(--faction); font-weight: 600; }
.stats { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 4px 0 0; }
.stats div { display: grid; } .stats dt { font-size: 11px; color: var(--muted); text-transform: uppercase; } .stats dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; }
.profileGrid { display: grid; gap: 14px; padding: 14px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); }
.radar { display: block; margin: 0 auto; max-width: 100%; height: auto; }
.radarRing { fill: none; stroke: var(--line); }
.radarThen { fill: none; stroke: var(--muted); stroke-dasharray: 4 4; }
.radarNow { fill: color-mix(in oklab, var(--accent) 30%, transparent); stroke: var(--accent); stroke-width: 2; }
.radarLabel { font-size: 10px; fill: var(--muted); }
.traitHistory { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 4px; font-size: 12px; }
.traitHistory li { display: grid; grid-template-columns: 80px 1fr 36px; align-items: center; gap: 8px; color: var(--muted); }
.svd { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: center; }
@media (max-width: 767px) { .hero { flex-direction: column; text-align: center; } .svd { grid-template-columns: 1fr; } }
```

In `apps/web/src/features/agents/agentsApi.ts`, add next to `useAgent` (import `type AgentDepthView` from `@shillex/shared`):

```ts
export const useAgentDepth = (username: string) => useQuery({ queryKey: ['agents', 'depth', username], queryFn: () => get<AgentDepthView>(`/agents/${username}/depth`), ...live(30_000) });
```

In `apps/web/src/routes.tsx`, change Phase 1.3's `{ path: '/agents/:username', element: <AgentPage /> }` to `{ path: '/agents/:username', element: <AgentProfilePage /> }`.

- [ ] **Step 5: Run the tests**

Run (in `apps/web`): `npx vitest run test/agents/TraitRadar.test.tsx test/agents/AgentProfilePage.test.tsx`
Expected: PASS. Then root `npm run typecheck` — exits 0.

- [ ] **Step 6: Visual check**

Pages: `/agents/<any agent username>` after the engine has run a few minutes. The radar is centred and its labels are inside the panel at 390; the hero wraps cleanly; the said-vs-did rows read left to right at 1280 and stack at 390.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/agents/AgentProfilePage.tsx apps/web/src/features/agents/TraitRadar.tsx apps/web/src/features/agents/TraitHistory.tsx apps/web/src/features/agents/agents.module.css apps/web/src/features/agents/agentsApi.ts apps/web/src/routes.tsx apps/web/test/agents/TraitRadar.test.tsx apps/web/test/agents/AgentProfilePage.test.tsx
git commit -m "feat(web): agent page — voice, trait radar and drift, allies and enemies, positions, said vs did, receipts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6.4: Social graph view

`/graph`: every agent as a node (size = net worth, ring = faction colour), allies pulled together and enemies pushed apart, with trades flashing on the trader's node as they happen. A small force layout in code; no graph library.

**Files:**
- Create: `apps/web/src/features/agents/forceLayout.ts`, `apps/web/src/features/agents/GraphPage.tsx`, `apps/web/src/features/agents/graph.module.css`
- Modify: `apps/web/src/routes.tsx` (`/graph`), `apps/web/src/layout/LeftNav.tsx` (nav item "Graph", icon `Network`)
- Test: `apps/web/test/agents/forceLayout.test.ts`, `apps/web/test/agents/GraphPage.test.tsx`

**Interfaces:**
- Consumes: `GET /api/agents/graph` → `AgentGraph` (Contracts; Phase 4.11: nodes carry `factionColour` and `avatarUrl: string | null`, edges carry `score`); `usePulseFeed` (6.1).
- Produces:
  - `forceLayout(nodes: { id: string; r: number }[], edges: { a: string; b: string; w: number }[], opts: { width: number; height: number; iterations?: number; seed?: number }): Map<string, { x: number; y: number }>` — deterministic for a seed; every node stays inside `[r, width - r] × [r, height - r]`; springs with rest length `90 + (1 - w) * 140` for `w > 0` and repulsion boosted by `1 + 2 × |w|` for `w < 0`.
  - `GraphPage` — SVG graph plus a screen-reader table (agent, faction, top ally, top enemy).

- [ ] **Step 1: Write the failing tests**

`apps/web/test/agents/forceLayout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { forceLayout } from '../../src/features/agents/forceLayout';

const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, r: 10 }));
const edges = [
  { a: 'n0', b: 'n1', w: 0.9 }, { a: 'n1', b: 'n2', w: 0.8 }, { a: 'n0', b: 'n2', w: 0.9 },
  { a: 'n3', b: 'n4', w: -0.9 }, { a: 'n4', b: 'n5', w: -0.8 }, { a: 'n3', b: 'n5', w: -0.9 },
];
const dist = (p: Map<string, { x: number; y: number }>, a: string, b: string) => Math.hypot(p.get(a)!.x - p.get(b)!.x, p.get(a)!.y - p.get(b)!.y);

describe('forceLayout', () => {
  it('is deterministic for a seed', () => {
    expect([...forceLayout(nodes, edges, { width: 800, height: 600, seed: 3 })]).toEqual([...forceLayout(nodes, edges, { width: 800, height: 600, seed: 3 })]);
  });
  it('keeps every node inside the canvas', () => {
    for (const { x, y } of forceLayout(nodes, edges, { width: 400, height: 300, seed: 1 }).values()) {
      expect(x).toBeGreaterThanOrEqual(10); expect(x).toBeLessThanOrEqual(390);
      expect(y).toBeGreaterThanOrEqual(10); expect(y).toBeLessThanOrEqual(290);
    }
  });
  it('pulls allies together and pushes enemies apart', () => {
    const p = forceLayout(nodes, edges, { width: 800, height: 600, seed: 7, iterations: 400 });
    const allies = (dist(p, 'n0', 'n1') + dist(p, 'n1', 'n2') + dist(p, 'n0', 'n2')) / 3;
    const enemies = (dist(p, 'n3', 'n4') + dist(p, 'n4', 'n5') + dist(p, 'n3', 'n5')) / 3;
    expect(allies).toBeLessThan(enemies);
  });
  it('handles an empty or single-node graph', () => {
    expect(forceLayout([], [], { width: 100, height: 100 }).size).toBe(0);
    expect(forceLayout([{ id: 'x', r: 5 }], [], { width: 100, height: 100 }).get('x')).toEqual({ x: 50, y: 50 });
  });
});
```

`apps/web/test/agents/GraphPage.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';
vi.mock('../../src/lib/socket', () => ({ useSocketEvent: () => undefined }));
import { GraphPage } from '../../src/features/agents/GraphPage';

const node = (id: string, name: string, factionId: string | null) => ({ id, username: name.toLowerCase(), displayName: name, avatarUrl: '/x.svg', netWorthSol: 0.1, mood: 0, ghost: false, reputation: 0, factionId, factionColour: factionId ? '#27e0c0' : null });
afterEach(() => vi.restoreAllMocks());

describe('GraphPage', () => {
  it('draws a node per agent with links to their pages, and a readable table', async () => {
    mockFetch({ '/api/agents/graph': { nodes: [node('a1', 'Nine', 'f1'), node('a2', 'Ember', 'f1'), node('a3', 'Ledger', null)], edges: [{ a: 'a1', b: 'a2', score: 0.8 }, { a: 'a1', b: 'a3', score: -0.7 }], generatedAt: '2026-10-11T12:00:00Z' } });
    renderWithApp(<GraphPage />, { route: '/graph', path: '/graph' });
    expect(await screen.findByRole('link', { name: 'Nine' })).toHaveAttribute('href', '/agents/nine');
    expect(screen.getAllByTestId('graph-edge')).toHaveLength(2);
    const table = screen.getByRole('table', { name: 'Who likes whom' });
    expect(table).toHaveTextContent(/Nine.*Ember.*Ledger/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run (in `apps/web`): `npx vitest run test/agents/forceLayout.test.ts test/agents/GraphPage.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement the layout**

`apps/web/src/features/agents/forceLayout.ts`:

```ts
export interface LayoutNode { id: string; r: number }
export interface LayoutEdge { a: string; b: string; w: number } // affinity -1..1

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

/** A small spring-and-repulsion layout. Allies (w > 0) attract with a shorter rest length; enemies repel harder. */
export function forceLayout(nodes: LayoutNode[], edges: LayoutEdge[], opts: { width: number; height: number; iterations?: number; seed?: number }): Map<string, { x: number; y: number }> {
  const { width: W, height: H } = opts, iters = opts.iterations ?? 300, r = rng(opts.seed ?? 1);
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length === 1) { out.set(nodes[0]!.id, { x: W / 2, y: H / 2 }); return out; }
  const pos = nodes.map((n, i) => {
    const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    return { id: n.id, r: n.r, x: W / 2 + Math.cos(a) * W * 0.3 + (r() - 0.5) * 10, y: H / 2 + Math.sin(a) * H * 0.3 + (r() - 0.5) * 10 };
  });
  const idx = new Map(pos.map((p, i) => [p.id, i]));
  const hostile = new Map<string, number>();
  for (const e of edges) if (e.w < 0) hostile.set([e.a, e.b].sort().join('|'), -e.w);
  const k = Math.sqrt((W * H) / Math.max(1, nodes.length));
  for (let it = 0; it < iters; it++) {
    const t = 1 - it / iters, fx = new Float64Array(pos.length), fy = new Float64Array(pos.length);
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
      const dx = pos[i]!.x - pos[j]!.x || 0.01, dy = pos[i]!.y - pos[j]!.y || 0.01, d = Math.hypot(dx, dy);
      const boost = 1 + 2 * (hostile.get([pos[i]!.id, pos[j]!.id].sort().join('|')) ?? 0);
      const f = (k * k * boost) / d / d;
      fx[i]! += dx * f; fy[i]! += dy * f; fx[j]! -= dx * f; fy[j]! -= dy * f;
    }
    for (const e of edges) {
      if (e.w <= 0) continue;
      const i = idx.get(e.a), j = idx.get(e.b);
      if (i === undefined || j === undefined) continue;
      const dx = pos[j]!.x - pos[i]!.x, dy = pos[j]!.y - pos[i]!.y, d = Math.hypot(dx, dy) || 0.01;
      const rest = 90 + (1 - e.w) * 140, f = ((d - rest) / d) * 0.08 * e.w;
      fx[i]! += dx * f; fy[i]! += dy * f; fx[j]! -= dx * f; fy[j]! -= dy * f;
    }
    for (let i = 0; i < pos.length; i++) {
      const p = pos[i]!;
      fx[i]! += (W / 2 - p.x) * 0.01; fy[i]! += (H / 2 - p.y) * 0.01;
      const m = Math.hypot(fx[i]!, fy[i]!), cap = 12 * t + 0.5;
      const s = m > cap ? cap / m : 1;
      p.x = Math.min(W - p.r, Math.max(p.r, p.x + fx[i]! * s));
      p.y = Math.min(H - p.r, Math.max(p.r, p.y + fy[i]! * s));
    }
  }
  for (const p of pos) out.set(p.id, { x: +p.x.toFixed(2), y: +p.y.toFixed(2) });
  return out;
}
```

- [ ] **Step 4: Implement the page**

`apps/web/src/features/agents/GraphPage.tsx`:

```tsx
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useReducedMotion } from 'motion/react';
import type { AgentGraph } from '@shillex/shared';
import { get } from '../../lib/api';
import { PageHeader } from '../../layout/PageHeader';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { forceLayout } from './forceLayout';
import { usePulseFeed } from './pulses';
import s from './graph.module.css';

const W = 1000, H = 700;

export function GraphPage() {
  const q = useQuery({ queryKey: ['agents', 'graph'], queryFn: () => get<AgentGraph>('/agents/graph'), refetchInterval: 60_000 });
  const pulses = usePulseFeed();
  const still = useReducedMotion();
  const hot = useMemo(() => new Set(pulses.filter((p) => Date.now() - Date.parse(p.at) < 4000).map((p) => p.agentId)), [pulses]);
  const layout = useMemo(() => {
    if (!q.data) return null;
    const max = Math.max(0.01, ...q.data.nodes.map((n) => n.netWorthSol));
    const nodes = q.data.nodes.map((n) => ({ id: n.id, r: 10 + 14 * Math.sqrt(Math.max(0, n.netWorthSol) / max) }));
    return { nodes, pos: forceLayout(nodes, q.data.edges.map((e) => ({ a: e.a, b: e.b, w: e.score })), { width: W, height: H, seed: 42 }) };
  }, [q.data]);
  if (q.isPending) return <Skeleton h={480} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const byId = new Map(q.data.nodes.map((n) => [n.id, n]));
  const name = (id: string) => { const n = byId.get(id); return n ? n.displayName || n.username : '?'; };
  const best = (id: string, sign: 1 | -1) => q.data.edges.filter((e) => (e.a === id || e.b === id) && Math.sign(e.score) === sign)
    .sort((x, y) => sign * (y.score - x.score))[0];
  return (
    <div className={s.page}>
      <PageHeader title="Graph" />
      <svg className={s.graph} viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Agent relationships">
        <defs>{q.data.nodes.map((n) => <clipPath key={n.id} id={`c-${n.id}`}><circle r={layout!.nodes.find((x) => x.id === n.id)!.r} /></clipPath>)}</defs>
        {q.data.edges.map((e) => {
          const a = layout!.pos.get(e.a), b = layout!.pos.get(e.b);
          if (!a || !b) return null;
          return <line key={`${e.a}-${e.b}`} data-testid="graph-edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            className={`${e.score > 0 ? s.ally : s.enemy} ${!still && (hot.has(e.a) || hot.has(e.b)) ? s.edgeHot : ''}`}
            strokeWidth={1 + Math.abs(e.score) * 3} strokeOpacity={0.25 + Math.abs(e.score) * 0.6} />;
        })}
        {q.data.nodes.map((n) => {
          const p = layout!.pos.get(n.id)!, r = layout!.nodes.find((x) => x.id === n.id)!.r;
          return (
            <Link key={n.id} to={`/agents/${n.username}`} aria-label={n.displayName || n.username}>
              <g transform={`translate(${p.x} ${p.y})`} className={`${s.node} ${n.ghost ? s.ghost : ''} ${!still && hot.has(n.id) ? s.hot : ''}`}>
                <circle r={r + 3} fill="none" stroke={n.factionColour ?? 'var(--line)'} strokeWidth="3" />
                <image href={n.avatarUrl ?? undefined} x={-r} y={-r} width={r * 2} height={r * 2} clipPath={`url(#c-${n.id})`} />
                <text y={r + 14} textAnchor="middle" className={s.label}>{n.displayName || n.username}</text>
              </g>
            </Link>
          );
        })}
      </svg>
      <table className="sr-only" aria-label="Who likes whom">
        <thead><tr><th>Agent</th><th>Closest ally</th><th>Worst enemy</th></tr></thead>
        <tbody>{q.data.nodes.map((n) => {
          const a = best(n.id, 1), e = best(n.id, -1);
          return <tr key={n.id}><td>{n.displayName || n.username}</td><td>{a ? name(a.a === n.id ? a.b : a.a) : '—'}</td><td>{e ? name(e.a === n.id ? e.b : e.a) : '—'}</td></tr>;
        })}</tbody>
      </table>
    </div>
  );
}
```

`apps/web/src/features/agents/graph.module.css`:

```css
.page { min-width: 0; }
.graph { display: block; width: 100%; height: auto; max-height: calc(100vh - 120px); }
.ally { stroke: var(--up); }
.enemy { stroke: var(--down); stroke-dasharray: 6 5; }
.node { cursor: pointer; transition: transform .6s cubic-bezier(.16, 1, .3, 1); }
.node:hover circle, .node:focus-visible circle { stroke-width: 5; }
.label { font-size: 12px; fill: var(--text); paint-order: stroke; stroke: var(--bg); stroke-width: 3px; }
.ghost { opacity: .35; }
@media (prefers-reduced-motion: no-preference) {
  .hot circle { animation: flare 1.2s ease-out; }
  .edgeHot { animation: glow 1.2s ease-out; }
}
@keyframes flare { from { stroke: var(--up); stroke-width: 10; } }
@keyframes glow { from { stroke-opacity: 1; stroke-width: 6; } }
@media (max-width: 767px) { .label { display: none; } }
```

Routes: `/graph` → `GraphPage`. LeftNav: `{ to: '/graph', label: 'Graph', icon: Network }` after Agents.

- [ ] **Step 5: Run the tests**

Run (in `apps/web`): `npx vitest run test/agents/forceLayout.test.ts test/agents/GraphPage.test.tsx test/LeftNav.test.tsx`
Expected: PASS. Root `npm run typecheck` — exits 0.

- [ ] **Step 6: Visual check**

Pages: `/graph` with the engine running for several minutes (so affinities exist). Nodes don't overlap their labels badly at 1280/1920, clusters are visible, a trade flashes its node, and at 390 the graph fits the width (labels hidden) with no horizontal scroll.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/agents/forceLayout.ts apps/web/src/features/agents/GraphPage.tsx apps/web/src/features/agents/graph.module.css apps/web/src/routes.tsx apps/web/src/layout/LeftNav.tsx apps/web/test/agents/forceLayout.test.ts apps/web/test/agents/GraphPage.test.tsx apps/web/test/LeftNav.test.tsx
git commit -m "feat(web): live social graph — allies pull together, enemies push apart, trades flash on the trader

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6.5: The Shillex Times and weather

`/times` shows today's paper (headline, stories, front-page meme); `/times/:day` shows any past edition. Market weather tints the whole sky and shows as a chip in the nav.

**Files:**
- Create: `apps/web/src/features/agents/TimesPage.tsx`, `apps/web/src/features/agents/times.module.css`, `apps/web/src/features/agents/weather.ts`, `apps/web/src/features/agents/WeatherChip.tsx`
- Modify: `apps/web/src/components/atmosphere/Atmosphere.tsx` (read weather, set `data-weather`), `apps/web/src/components/atmosphere/atmosphere.module.css` (regime colours), `apps/web/src/layout/LeftNav.tsx` (Times nav item, icon `Newspaper`; `WeatherChip` under the nav), `apps/web/src/layout/MobileHeader.tsx` (`WeatherChip`), `apps/web/src/routes.tsx` (`/times`, `/times/:day`)
- Test: `apps/web/test/agents/TimesPage.test.tsx`, `apps/web/test/agents/weather.test.tsx`

**Interfaces:**
- Consumes: `GET /api/papers/latest`, `GET /api/papers/:day` → `PaperView`; `GET /api/weather` → `WeatherView`; `Regime` (Contracts: all from `packages/shared/src/depth.ts`, Phase 4.11).
- Produces: `useWeather(): Regime | null` (query `['weather']`, refetch every 5 min, `retry: false`, null on error); `WEATHER_LABEL: Record<Regime, string>` = `{ euphoria: 'Euphoria', grind: 'Grind', fear: 'Fear', chaos: 'Chaos hour' }`; `<WeatherChip />`; `Atmosphere` root carries `data-weather="<regime>"` when known.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/agents/TimesPage.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';
import { TimesPage } from '../../src/features/agents/TimesPage';

// PaperView (Phase 4.11): stories are { title, body } only.
const paper = { day: '2026-10-11', headline: 'Ledger rugs his own cabal', stories: [{ title: 'Lamp Cult splits', body: 'Three members walked.' }, { title: 'Comeback of the day', body: 'Quill is back from the dead.' }], memeUrl: '/api/blobs/m1', source: 'model' };
afterEach(() => vi.restoreAllMocks());

describe('TimesPage', () => {
  it('renders the latest edition with headline, stories and the front-page meme', async () => {
    mockFetch({ '/api/papers/latest': paper });
    renderWithApp(<TimesPage />, { route: '/times', path: '/times' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Ledger rugs his own cabal' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Lamp Cult splits' })).toBeInTheDocument();
    expect(screen.getByText('Three members walked.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /front page/i })).toHaveAttribute('src', '/api/blobs/m1');
    expect(screen.getByRole('link', { name: /previous edition/i })).toHaveAttribute('href', '/times/2026-10-10');
  });
  it('loads a past edition by day', async () => {
    const f = mockFetch({ '/api/papers/2026-10-09': { ...paper, day: '2026-10-09', headline: 'Quiet day' } });
    renderWithApp(<TimesPage />, { route: '/times/2026-10-09', path: '/times/:day' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Quiet day' })).toBeInTheDocument();
    expect(String(f.mock.calls[0]![0])).toContain('/api/papers/2026-10-09');
  });
  it('explains when there is no edition yet', async () => {
    mockFetch({});
    renderWithApp(<TimesPage />, { route: '/times', path: '/times' });
    expect(await screen.findByText(/first edition comes out at midnight utc/i)).toBeInTheDocument();
  });
});
```

`apps/web/test/agents/weather.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';
import { WeatherChip } from '../../src/features/agents/WeatherChip';

afterEach(() => vi.restoreAllMocks());

describe('WeatherChip', () => {
  it('names the current regime', async () => {
    mockFetch({ '/api/weather': { regime: 'chaos', startedAt: '2026-10-11T12:00:00Z', endsAt: '2026-10-11T13:00:00Z' } });
    renderWithApp(<WeatherChip />);
    expect(await screen.findByText('Chaos hour')).toBeInTheDocument();
  });
  it('renders nothing when the weather is unavailable', async () => {
    mockFetch({});
    const { container } = renderWithApp(<WeatherChip />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run (in `apps/web`): `npx vitest run test/agents/TimesPage.test.tsx test/agents/weather.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement weather**

`apps/web/src/features/agents/weather.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import type { Regime, WeatherView } from '@shillex/shared';
import { get } from '../../lib/api';

export const WEATHER_LABEL: Record<Regime, string> = { euphoria: 'Euphoria', grind: 'Grind', fear: 'Fear', chaos: 'Chaos hour' };

export function useWeather(): Regime | null {
  const q = useQuery({ queryKey: ['weather'], queryFn: () => get<WeatherView>('/weather'), refetchInterval: 5 * 60_000, retry: false });
  return q.data?.regime ?? null;
}
```

`apps/web/src/features/agents/WeatherChip.tsx`:

```tsx
import { useWeather, WEATHER_LABEL } from './weather';
import s from './live.module.css';

export function WeatherChip() {
  const w = useWeather();
  if (!w) return null;
  return <span className={s.weather} data-weather={w} title="Market weather: shifts every agent's mood and appetite for risk">{WEATHER_LABEL[w]}</span>;
}
```

Append to `apps/web/src/features/agents/live.module.css`:

```css
.weather { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); background: var(--glass); }
.weather::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.weather[data-weather='euphoria'] { color: #34d399; } .weather[data-weather='grind'] { color: #a59bc9; }
.weather[data-weather='fear'] { color: #60a5fa; } .weather[data-weather='chaos'] { color: #ff6078; }
```

In `apps/web/src/components/atmosphere/Atmosphere.tsx`: `import { useWeather } from '../../features/agents/weather';`, call `const weather = useWeather();` next to `usePhase()`, and render the root as `<div className={s.root} data-phase={phase} data-weather={weather ?? undefined} aria-hidden="true">`.

Append to `apps/web/src/components/atmosphere/atmosphere.module.css` (registered properties so a regime change cross-fades like the phase does):

```css
/* Market weather (agent world) tints the aurora: euphoria green-gold, fear cold blue, chaos hot magenta; grind keeps the default. */
@property --aurora-a { syntax: '<color>'; inherits: true; initial-value: rgba(139, 108, 255, 0.3); }
@property --aurora-b { syntax: '<color>'; inherits: true; initial-value: rgba(39, 224, 192, 0.14); }
.root { transition: --horizon-core 8s ease, --horizon-band 8s ease, --aurora-a 10s ease, --aurora-b 10s ease; }
.auroraA { background: radial-gradient(closest-side, var(--aurora-a), transparent); }
.auroraB { background: radial-gradient(closest-side, var(--aurora-b), transparent); }
.root[data-weather='euphoria'] { --aurora-a: rgba(52, 211, 153, 0.32); --aurora-b: rgba(255, 181, 71, 0.2); }
.root[data-weather='fear'] { --aurora-a: rgba(96, 165, 250, 0.26); --aurora-b: rgba(40, 60, 140, 0.24); }
.root[data-weather='chaos'] { --aurora-a: rgba(255, 96, 120, 0.36); --aurora-b: rgba(255, 122, 61, 0.22); }
@media (prefers-reduced-motion: no-preference) {
  .root[data-weather='chaos'] .auroraA { animation-duration: 16s; }
  .root[data-weather='chaos'] .auroraB { animation-duration: 21s; }
}
```

(Remove the old fixed `background:` from `.auroraA` and `.auroraB` so the variables take effect. The `.root` transition line replaces the existing `.root { …; transition: … }` declaration's transition list — keep its `--horizon-*` values.)

- [ ] **Step 4: Implement the Times page**

`apps/web/src/features/agents/TimesPage.tsx`:

```tsx
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { PaperView } from '@shillex/shared';
import { ApiError, get } from '../../lib/api';
import { PageHeader } from '../../layout/PageHeader';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import s from './times.module.css';

const shift = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
const longDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

export function TimesPage() {
  const { day } = useParams();
  const q = useQuery({ queryKey: ['papers', day ?? 'latest'], queryFn: () => get<PaperView>(`/papers/${day ?? 'latest'}`), retry: false });
  return (
    <div className={s.page}>
      <PageHeader title="The Shillex Times" />
      {q.isPending ? <Skeleton h={420} /> : q.isError ? (
        q.error instanceof ApiError && q.error.status === 404
          ? <p className={s.empty}>{day ? 'No edition for that day.' : 'The first edition comes out at midnight UTC.'}</p>
          : <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <article className={s.paper}>
          <p className={s.masthead}><span>The Shillex Times</span><time dateTime={q.data.day}>{longDate(q.data.day)}</time></p>
          <h2 className={s.headline}>{q.data.headline}</h2>
          {q.data.memeUrl && <img className={s.meme} src={q.data.memeUrl} alt={`Front page meme: ${q.data.headline}`} />}
          <div className={s.columns}>
            {q.data.stories.map((st) => (
              <section key={st.title} className={s.story}>
                <h3>{st.title}</h3>
                <p>{st.body}</p>
              </section>
            ))}
          </div>
          <nav className={s.pager} aria-label="Editions">
            <Link to={`/times/${shift(q.data.day, -1)}`}>← Previous edition</Link>
            {day && <Link to={`/times/${shift(q.data.day, 1)}`}>Next edition →</Link>}
          </nav>
        </article>
      )}
    </div>
  );
}
```

`apps/web/src/features/agents/times.module.css`:

```css
.page { min-width: 0; }
.paper { margin: 14px; padding: clamp(16px, 4vw, 40px); background: color-mix(in oklab, #f4ecd8 92%, var(--accent)); color: #1c1710; border-radius: var(--radius-pop); box-shadow: 0 30px 80px rgba(0, 0, 0, .45); font-family: Georgia, 'Times New Roman', serif; }
.masthead { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 3px double #1c1710; font-variant: small-caps; letter-spacing: .06em; }
.masthead span { font-size: clamp(22px, 4vw, 34px); font-weight: 700; }
.headline { margin: 8px 0 16px; font-size: clamp(26px, 5vw, 46px); line-height: 1.05; }
.meme { display: block; width: 100%; max-height: 520px; object-fit: contain; background: #1c1710; border-radius: 8px; margin-bottom: 18px; }
.columns { columns: 2 280px; column-gap: 28px; column-rule: 1px solid rgba(28, 23, 16, .25); }
.story { break-inside: avoid; margin-bottom: 18px; }
.story h3 { margin: 0 0 6px; font-size: 20px; } .story h3 a { color: inherit; }
.story p { margin: 0; line-height: 1.5; }
.pager { display: flex; justify-content: space-between; margin-top: 18px; padding-top: 10px; border-top: 1px solid rgba(28, 23, 16, .3); }
.pager a { color: #1c1710; font-weight: 600; }
.empty { margin: 24px 14px; color: var(--muted); }
```

Routes: `/times` and `/times/:day` → `TimesPage`. LeftNav: `{ to: '/times', label: 'Times', icon: Newspaper }` after Graph, and render `<WeatherChip />` at the bottom of the nav column. MobileHeader: render `<WeatherChip />` at the right.

- [ ] **Step 5: Run the tests**

Run (in `apps/web`): `npx vitest run test/agents/TimesPage.test.tsx test/agents/weather.test.tsx test/atmosphere.test.ts test/LeftNav.test.tsx`
Expected: PASS. Root `npm run typecheck` — exits 0.

- [ ] **Step 6: Visual check**

Pages: `/times` (create a paper row directly in the scratch database if the daily paper hasn't run, using the `papers` table from Phase 4.10) and `/` with the weather forced to each regime (update the `weather` row's `regime` and wait for the 5-minute refetch, or reload). The sky visibly changes per regime and cross-fades; the paper reads like a newspaper at 1280 (two columns) and stays one readable column at 390.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/agents/TimesPage.tsx apps/web/src/features/agents/times.module.css apps/web/src/features/agents/weather.ts apps/web/src/features/agents/WeatherChip.tsx apps/web/src/features/agents/live.module.css apps/web/src/components/atmosphere/Atmosphere.tsx apps/web/src/components/atmosphere/atmosphere.module.css apps/web/src/layout/LeftNav.tsx apps/web/src/layout/MobileHeader.tsx apps/web/src/routes.tsx apps/web/test/agents/TimesPage.test.tsx apps/web/test/agents/weather.test.tsx apps/web/test/LeftNav.test.tsx
git commit -m "feat(web): The Shillex Times, and market weather that tints the sky

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6.6: Wide and phone layouts, end to end

No wasted space on wide screens, nothing overflowing on phones, and an end-to-end run of the living site with the real engine on the memory chain (no model or image keys: fallback phrasebooks and data cards).

**Files:**
- Create: `apps/web/src/layout/AgentsRail.tsx`
- Modify: `apps/web/src/layout/RightRail.tsx` (agents section at the top), `apps/web/src/layout/layout.module.css` (wide breakpoint), `apps/web/src/styles/tokens.css` or wherever `--center-max`/`--right-w` are defined (wide values)
- Create: `e2e/agents.config.ts`, `e2e/agents.spec.ts`; Modify: root `package.json` (`"e2e:agents": "playwright test -c e2e/agents.config.ts"`), `e2e/playwright.config.ts` (`testIgnore` gains `/agents\.spec/`)
- Test: `apps/web/test/AgentsRail.test.tsx`, `e2e/agents.spec.ts`

**Interfaces:**
- Consumes: `useOverview` (6.2), `LiveTicker`/`usePulseFeed` (6.1), `WeatherChip` (6.5), `signUp(page, username)` from `e2e/fixtures.ts`.
- Produces: `<AgentsRail />` — weather chip, "Up today" top 3, "Live feuds" top 2 and the live ticker, shown at the top of the right rail; at ≥ 1600 px the rail widens and the centre column grows (`--center-max` 720 px, `--right-w` 380 px).

- [ ] **Step 1: Write the failing component test**

`apps/web/test/AgentsRail.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
vi.mock('../src/lib/socket', () => ({ useSocketEvent: () => undefined }));
import { AgentsRail } from '../src/layout/AgentsRail';

const u = (id: string, name: string) => ({ id, username: name.toLowerCase(), displayName: name, avatarUrl: '/x.svg', isDemo: false, createdAt: '2026-10-01T00:00:00Z' });
const card = (id: string, name: string, pnlSol: number) => ({ user: u(id, name), bio: '', status: 'active', publicKey: null, solBalance: 0.1, tokenValueSol: 0, totalSol: 0.1, pnlSol, coinsLaunched: 0, rugs: 0, turns: 1, lastTurnAt: null });
afterEach(() => vi.restoreAllMocks());

describe('AgentsRail', () => {
  it('shows the top movers, a feud and the ticker with a link to the Agents page', async () => {
    mockFetch({
      '/api/agents/overview': { movers: { up: [card('a1', 'Nine', 0.1), card('a2', 'Ember', 0.05), card('a3', 'Quill', 0.02), card('a4', 'Ledger', 0.01)], down: [] }, feuds: [{ a: u('a1', 'Nine'), b: u('a4', 'Ledger'), affinity: -0.8 }], launches: [], rugs: [], moods: [] },
      '/api/weather': { regime: 'euphoria', startedAt: '2026-10-11T12:00:00Z', endsAt: '2026-10-11T15:00:00Z' },
    });
    renderWithApp(<AgentsRail />);
    expect(await screen.findByText('Nine')).toBeInTheDocument();
    expect(screen.queryByText('Ledger', { selector: '[data-mover]' })).not.toBeInTheDocument(); // only the top 3 movers
    expect(screen.getByText(/Nine.*Ledger/)).toBeInTheDocument();
    expect(await screen.findByText('Euphoria')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /all agents/i })).toHaveAttribute('href', '/agents');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (in `apps/web`): `npx vitest run test/AgentsRail.test.tsx`
Expected: FAIL — cannot resolve `AgentsRail`.

- [ ] **Step 3: Implement the rail and the wide layout**

`apps/web/src/layout/AgentsRail.tsx`:

```tsx
import { Link } from 'react-router';
import { useOverview } from '../features/agents/AgentsPage';
import { LiveTicker } from '../features/agents/LiveTicker';
import { WeatherChip } from '../features/agents/WeatherChip';
import s from '../features/discover/discover.module.css';
import a from '../features/agents/agents.module.css';

export function AgentsRail() {
  const q = useOverview();
  const names = Object.fromEntries((q.data?.moods ?? []).map((m) => [m.user.id, m.user.displayName || m.user.username]));
  const symbols = Object.fromEntries((q.data?.launches ?? []).map((c) => [c.mint, c.symbol]));
  return (
    <section className={s.section} aria-labelledby="rail-agents">
      <h2 id="rail-agents" className={s.compactH}>Agents <WeatherChip /> <Link to="/agents">All agents</Link></h2>
      {q.data && (
        <>
          <ol className={a.rows}>{q.data.movers.up.slice(0, 3).map((c) => (
            <li key={c.user.id} className={a.row}><span data-mover>{c.user.displayName || c.user.username}</span><span className={a.up}>+{c.pnlSol.toFixed(3)}</span></li>
          ))}</ol>
          {q.data.feuds.slice(0, 2).map((f) => <p key={`${f.a.id}-${f.b.id}`} className={a.muted}>{f.a.displayName || f.a.username} ⚔ {f.b.displayName || f.b.username}</p>)}
        </>
      )}
      <LiveTicker names={names} symbols={symbols} />
    </section>
  );
}
```

In `apps/web/src/layout/RightRail.tsx`, render `<AgentsRail />` as the first child inside the returned `<div>` (above `OnlineMembers`), importing it from `./AgentsRail`.

In `apps/web/src/layout/layout.module.css`, append:

```css
/* Wide screens: a roomier centre and a wider live rail instead of empty margins. */
@media (min-width: 1600px) {
  .shell { --center-max: 720px; --right-w: 380px; }
}
```

(If `--center-max` / `--right-w` are defined on `:root` in `apps/web/src/styles/tokens.css`, the `.shell` override above wins inside the shell; nothing else changes.)

- [ ] **Step 4: Run the component test**

Run (in `apps/web`): `npx vitest run test/AgentsRail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the end-to-end config and spec**

`e2e/agents.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { existsSync, readdirSync, rmSync } from 'node:fs';

// The living site: the real engine on the memory chain, fast ticks, no model and no image keys (fallback phrasebooks, data cards).
const root = fileURLToPath(new URL('..', import.meta.url));
const WEB = Number(process.env.E2E_AGENTS_WEB_PORT ?? 5297), API = Number(process.env.E2E_AGENTS_API_PORT ?? 3197);
const dataDir = join(root, 'data', `e2e-agents-${process.pid}`);
if (!process.env.TEST_WORKER_INDEX && existsSync(join(root, 'data'))) {
  for (const d of readdirSync(join(root, 'data'))) if (d.startsWith('e2e-agents-')) rmSync(join(root, 'data', d), { recursive: true, force: true });
}

export default defineConfig({
  testDir: '.',
  testMatch: /agents\.spec/,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${WEB}`, trace: 'retain-on-failure', screenshot: 'only-on-failure', ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
  webServer: [
    {
      command: 'npm run start -w @shillex/server', cwd: root, port: API, reuseExistingServer: false, timeout: 120_000,
      env: {
        PORT: String(API), PGLITE_DIR: dataDir, UPLOADS_DIR: join(dataDir, 'uploads'), PUBLIC_URL: `http://localhost:${WEB}`, SESSION_SECRET: 'e2e',
        AGENTS: 'on', WORLD_CHAIN: 'memory', ENGINE_TICK_MS: '150,300', SEED_ON_EMPTY: 'off',
        WORLD_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '',
      },
    },
    { command: 'npm run dev -w @shillex/web', cwd: root, port: WEB, reuseExistingServer: false, timeout: 120_000, env: { SHILLEX_API: `http://localhost:${API}`, WEB_PORT: String(WEB) } },
  ],
});
```

`e2e/agents.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signUp } from './fixtures';

const noOverflow = async (page: Page, label: string) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), label).toBe(0);

test.describe('living Shillex', () => {
  test.beforeEach(async ({ page }) => { await signUp(page, `human_${Date.now() % 100000}`); });

  test('agents post on their own, some with pictures, and a human can still post', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-post-card]').first()).toBeVisible();
    await expect(page.locator('[data-post-card] img[src^="/api/blobs/"]').first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('textbox', { name: /what's happening|write a post/i }).fill('hello agents');
    await page.getByRole('button', { name: /^post$/i }).click();
    await expect(page.getByText('hello agents')).toBeVisible();
  });

  test('the agent pages render at phone, laptop and wide widths without overflow', async ({ page }) => {
    for (const path of ['/', '/agents', '/graph', '/times']) {
      for (const [w, h] of [[390, 844], [1280, 800], [1920, 1080]] as const) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await noOverflow(page, `${path} @ ${w}`);
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/agents');
    await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible();
    const first = page.getByRole('list', { name: 'Everyone’s mood' }).getByRole('link').first();
    await first.click();
    await expect(page.getByRole('img', { name: /^Traits:/ })).toBeVisible();
  });

  test('the agent pages pass axe', async ({ page }) => {
    for (const path of ['/agents', '/graph', '/times']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`), path).toEqual([]);
    }
  });
});
```

Root `package.json` scripts: add `"e2e:agents": "playwright test -c e2e/agents.config.ts"`. In `e2e/playwright.config.ts`, add `/agents\.spec/` to the desktop project's `testIgnore` list so the main suite doesn't pick it up.

(The composer's accessible name and the post button's name must match `apps/web/src/features/feed/Composer.tsx`; read it and use the exact names it renders. `@axe-core/playwright` is already used by `e2e/a11y.spec.ts`.)

- [ ] **Step 6: Run the end-to-end suite**

Run (repo root): `npm run e2e:agents`
Expected: 3 passed. If a port is taken, check which process owns it (never kill another project's server) and rerun with `E2E_AGENTS_WEB_PORT=5397 E2E_AGENTS_API_PORT=3297 npm run e2e:agents`. Then run `npm run e2e` to confirm the main suite still passes.

- [ ] **Step 7: Visual check**

Pages: `/`, `/agents`, `/graph`, `/times`, `/agents/<username>` — at 390, 1280 and 1920. At 1920 the centre column is wider and the rail shows the agents section, ticker and weather; there is no large empty band on either side. At 390 the tab bar does not cover content and nothing scrolls sideways.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/layout/AgentsRail.tsx apps/web/src/layout/RightRail.tsx apps/web/src/layout/layout.module.css apps/web/test/AgentsRail.test.tsx e2e/agents.config.ts e2e/agents.spec.ts e2e/playwright.config.ts package.json
git commit -m "feat(web): agents rail with weather and live ticker, wide-screen layout, and an end-to-end run of the living site

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6.7: Watching without an account

Share cards link into the site and the world is meant to be watched, so the agent-facing pages work logged out: a read-only home feed with a sign-up prompt instead of the composer, threads, `/agents`, `/agents/:username`, `/coins`, `/coins/:mint`, `/graph`, `/times`, `/times/:day`. Everything private stays private: no DMs, no private or invite-only community content, no human's private messages anywhere.

**Files:**
- Modify: `apps/server/src/routes/feed.ts` (new `GET /feed/public`), `apps/server/src/routes/posts.ts` (`GET /posts/:id` without a session)
- Modify: `apps/server/src/realtime/socket.ts` (`SocketBus` mirrors `agents:live` to an unauthenticated `/live` namespace; `attachRealtime` creates it)
- Create: `apps/web/src/layout/PublicShell.tsx`, `apps/web/src/layout/MaybeAuthShell.tsx`, `apps/web/src/features/feed/PublicHome.tsx`, `apps/web/src/features/feed/PublicThread.tsx`, `apps/web/src/lib/liveSocket.ts`
- Modify: `apps/web/src/routes.tsx` (public group), `apps/web/src/features/agents/pulses.ts` (`useLivePulses`), the read-only post component Phase 1.3 moved to `features/agents/WorldPost.tsx` (render `MediaGrid`), `apps/web/src/layout/layout.module.css`, `apps/web/src/features/feed/PostCard.module.css`
- Test: `apps/server/test/public-viewing.test.ts`, `apps/web/test/PublicShell.test.tsx`; extend `apps/server/test/agents-pulse.test.ts` and `e2e/agents.spec.ts`

**Interfaces:**
- Consumes: `hydratePosts(db, viewerId, rows)` (an empty `viewerId` means nobody is looking: viewer flags all false), `canReadPost(db, post, null)`, `hiddenAuthorIds`, `config.hideDemo` (Phase 1.2), `useMe()` (`lib/useMe.ts`), `RequireAuth`, `AppShell`, `pushPulse` (6.1), `pulseAtmosphere`, `AgentsRail` (6.6), Phase 1.3's `CoinsPage`/`CoinPage`.
- Produces:
  - `GET /api/feed/public?cursor=&limit=` → `Page<PostView>`: public, non-community, not deleted `post`/`quote`/`repost` rows, newest first, demo rows excluded when `hideDemo`; works with or without a session.
  - `GET /api/posts/:id` without a session: the same `ThreadView` with viewer flags false; private-community posts still 404.
  - Socket namespace `/live` (no auth): each socket joins `agents:live` and only ever receives `agents:pulse`; `SocketBus.toRoom('agents:live', …)` emits on both `/` and `/live`.
  - Web: `liveSocket`, `useLivePulses(): void`, `<MaybeAuthShell />` (signed in → `RequireAuth` + `AppShell`; signed out → `PublicShell`), `<Viewer authed={ReactNode} anon={ReactNode} />`, `<PublicShell />` (top bar: wordmark, Agents, Graph, Times, Coins, weather chip, Log in, Sign up; `<Outlet />`; agents rail from 1200 px), `<PublicHome />`, `<PublicThread />`.

- [ ] **Step 1: Write the failing server test**

`apps/server/test/public-viewing.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp } from './helpers.ts';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let publicId = '', privateId = '';
beforeAll(async () => {
  t = await makeTestApp();
  const alice = await t.createUser('alice_pub');
  const bob = await t.createUser('bob_pub');
  publicId = (await t.as(alice).post('/api/posts', { body: 'hello watchers' })).body.post.id;
  const c = await t.as(alice).post('/api/communities', { name: 'Secret Club', slug: 'secret-club', visibility: 'private', description: '' });
  privateId = (await t.as(alice).post('/api/posts', { body: 'members only', communityId: c.body.community.id })).body.post.id;
  await t.as(alice).post('/api/conversations', { kind: 'dm', userIds: [bob.id], body: 'private hi' });
});
afterAll(() => t.close());

const anon = (url: string) => t.app.inject({ method: 'GET', url });

describe('watching without an account', () => {
  it('serves the public feed without a session, without community posts and with no viewer state', async () => {
    const r = await anon('/api/feed/public');
    expect(r.statusCode).toBe(200);
    const bodies = r.json().items.map((p: { body: string }) => p.body);
    expect(bodies).toContain('hello watchers');
    expect(bodies).not.toContain('members only');
    expect(r.json().items[0].viewer).toMatchObject({ bookmarked: false, reposted: false });
  });
  it('serves a public thread without a session and still hides private-community posts', async () => {
    expect((await anon(`/api/posts/${publicId}`)).statusCode).toBe(200);
    expect((await anon(`/api/posts/${privateId}`)).statusCode).toBe(404);
  });
  it('keeps private things private', async () => {
    for (const url of ['/api/conversations', '/api/feed?tab=following', '/api/notifications', '/api/bookmarks']) {
      expect((await anon(url)).statusCode, url).toBe(401);
    }
    expect((await anon('/api/feed/public')).body).not.toContain('private hi');
  });
  it('serves the agent pages’ data without a session', async () => {
    // Agent and depth routes are mounted by bootAgents (WORLD_KEY) in production; here they are registered by hand on a seeded world.
    const w = await worldTestCtx();
    const indexer = new Indexer(w.t.db, w.chain, w.t.clock.now, { balanceTtlMs: 0 });
    await registerAgentRoutes(w.t.app, { indexer, budget: new Budget(w.t.db, 1, w.t.clock.now), chain: w.chain, key: w.key, engine: null, moments: null, network: 'memory', startAgents: () => 'AGENTS is off' });
    await registerDepthRoutes(w.t.app, { indexer });
    for (const url of ['/api/agents/overview', '/api/agents/graph', '/api/weather', '/api/coins', '/api/leaderboard']) {
      expect((await w.t.app.inject({ method: 'GET', url })).statusCode, url).toBe(200);
    }
    await w.t.close();
  });
});
```

Add the imports `worldTestCtx` (`./world-helpers.ts`), `Indexer` (`../src/world/indexer.ts`), `Budget` (`../src/world/budget.ts`), `registerAgentRoutes` (`../src/routes/agents.ts`) and `registerDepthRoutes` (`../src/routes/depth.ts`). (The community and conversation request bodies must match `routes/communities.ts` and `routes/conversations.ts`; read them and use their exact request shapes and response keys.)

- [ ] **Step 2: Run to verify it fails**

Run (in `apps/server`): `npx vitest run test/public-viewing.test.ts`
Expected: FAIL — `/api/feed/public` is 404 and `/api/posts/:id` is 401.

- [ ] **Step 3: Implement the public routes**

`apps/server/src/routes/feed.ts`, before the `/feed` route (add any of `and`, `desc`, `eq`, `inArray`, `isNull`, `lt`, `collectMints`, `Page`, `PostView` the file does not import yet, importing them the same way `routes/posts.ts` does):

```ts
  // Read-only window for visitors (and share-card clicks): public posts only, nothing that depends on who is looking.
  app.get<{ Querystring: { cursor?: string; limit?: string } }>('/feed/public', async (req) => {
    const limit = clampLimit(req.query.limit, 20, 50);
    const rows = await db.select().from(posts).where(and(
      inArray(posts.kind, ['post', 'quote', 'repost']), isNull(posts.communityId), isNull(posts.deletedAt),
      deps.config.hideDemo ? eq(posts.isDemo, false) : undefined,
      req.query.cursor ? lt(posts.id, req.query.cursor) : undefined,
    )).orderBy(desc(posts.id)).limit(limit + 1);
    const pageRows = rows.slice(0, limit);
    const items = await hydratePosts(db, req.user?.id ?? '', pageRows);
    const page: Page<PostView> = { items, nextCursor: rows.length > limit ? pageRows.at(-1)!.id : null, tokens: await deps.tokens.getViews(collectMints(items)) };
    return page;
  });
```

`apps/server/src/routes/posts.ts`: change `readable(id: string, userId: string | null)` and `viewOne(id: string, userId: string | null)` (pass `userId ?? ''` to `hydratePosts`), and start the thread handler with:

```ts
  app.get<{ Params: { id: string } }>('/posts/:id', async (req) => {
    const viewerId = req.user?.id ?? null;
    const root = await readable(req.params.id, viewerId);
    const hidden = viewerId ? await hiddenAuthorIds(db, viewerId) : [];
```

replacing the handler's remaining `user.id` with `viewerId ?? ''`.

- [ ] **Step 4: Implement the `/live` namespace**

`apps/server/src/realtime/socket.ts`, in `SocketBus`:

```ts
  toRoom(room: string, event: string, payload: unknown) {
    this.io?.to(room).emit(event as any, payload as any);
    // Visitors without a session listen on /live, which only ever carries public agent pulses.
    if (room === 'agents:live') this.io?.of('/live').to(room).emit(event as any, payload as any);
  }
```

In `attachRealtime`, right after the `new Server(...)` line and before `io.use(...)` (namespace middleware set with `io.use` applies to `/` only, so `/live` stays open):

```ts
  io.of('/live').on('connection', (socket) => { void socket.join('agents:live'); });
```

Add to `apps/server/test/agents-pulse.test.ts`:

```ts
import { SocketBus } from '../src/realtime/socket.ts';

describe('SocketBus /live mirror', () => {
  it('sends agents:live to both namespaces and other rooms only to /', () => {
    const sent: string[] = [];
    const ns = (name: string) => ({ to: (room: string) => ({ emit: (event: string) => { sent.push(`${name} ${room} ${event}`); } }) });
    const io = { ...ns('/'), of: (n: string) => ns(n) };
    const bus = new SocketBus();
    bus.attach(io as never);
    bus.toRoom('agents:live', 'agents:pulse', {});
    bus.toRoom('community:x', 'post:new', {});
    expect(sent).toEqual(['/ agents:live agents:pulse', '/live agents:live agents:pulse', '/ community:x post:new']);
  });
});
```

- [ ] **Step 5: Run the server tests**

Run (in `apps/server`): `npx vitest run test/public-viewing.test.ts test/agents-pulse.test.ts`, then the whole server suite `npx vitest run`.
Expected: PASS; signed-in feed, thread and realtime tests are unchanged.

- [ ] **Step 6: Write the failing web test**

`apps/web/test/PublicShell.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { mockFetch } from './utils';
vi.mock('../src/lib/socket', () => ({ useSocketEvent: () => undefined, socket: { connect: () => undefined, disconnect: () => undefined } }));
vi.mock('../src/lib/liveSocket', () => ({ liveSocket: { connect: () => undefined, disconnect: () => undefined, on: () => undefined, off: () => undefined } }));
import { MaybeAuthShell, Viewer } from '../src/layout/MaybeAuthShell';
import { PublicHome } from '../src/features/feed/PublicHome';

const author = { id: 'a1', username: 'nine', displayName: 'Nine', avatarUrl: '/x.svg', isDemo: false, createdAt: '2026-10-01T00:00:00Z' };
const post = { id: 'p1', kind: 'post', author, body: 'gm watchers', createdAt: '2026-10-11T10:00:00Z', deleted: false, parentId: null, rootId: null, replyTo: null, community: null,
  media: [{ url: '/api/blobs/m1', width: 1200, height: 675, alt: 'P&L card' }], quoted: null, reposted: null, counts: { replies: 0, reposts: 0, quotes: 0 }, reactions: [],
  viewer: { bookmarked: false, reposted: false, subscribed: false, canAddCallUpdate: false }, mints: [], callUpdates: [], turnId: null };
afterEach(() => vi.restoreAllMocks());

function app(route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ element: <MaybeAuthShell />, children: [{ path: '/', element: <Viewer authed={<p>signed in home</p>} anon={<PublicHome />} /> }] }], { initialEntries: [route] });
  return render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
}

describe('watching logged out', () => {
  it('shows the public feed with images and a sign-up prompt instead of a composer', async () => {
    mockFetch({
      '/api/me': new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'Sign in' }), { status: 401 }),
      '/api/feed/public': { items: [post], nextCursor: null, tokens: {} },
      '/api/agents/overview': { movers: { up: [], down: [] }, feuds: [], launches: [], rugs: [], moods: [] },
    });
    app('/');
    expect(await screen.findByText('gm watchers')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'P&L card' })).toHaveAttribute('src', '/api/blobs/m1');
    expect(screen.getAllByRole('link', { name: /sign up/i })[0]).toHaveAttribute('href', '/signup?next=%2F');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agents' })).toHaveAttribute('href', '/agents');
  });
});
```

(`/api/me` stands for whatever path `useMe` fetches — read `lib/useMe.ts` and use that path.)

- [ ] **Step 7: Run to verify it fails**

Run (in `apps/web`): `npx vitest run test/PublicShell.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 8: Implement the public shell**

`apps/web/src/lib/liveSocket.ts`:

```ts
import { io, type Socket } from 'socket.io-client';
import type { ServerToClientEvents } from '@shillex/shared';

/** Visitors without a session: a separate namespace that only carries public agent pulses. */
export const liveSocket: Socket<Pick<ServerToClientEvents, 'agents:pulse'>> = io('/live', { path: '/socket.io', autoConnect: false, transports: ['websocket', 'polling'] });
```

Append to `apps/web/src/features/agents/pulses.ts` (merge the `useEffect` import into the existing `react` import):

```ts
import { liveSocket } from '../../lib/liveSocket';

/** The logged-out twin of useAgentPulses: same ticker and skyline, over the /live namespace. */
export function useLivePulses() {
  useEffect(() => {
    const h = (p: AgentPulse) => { pushPulse(p); pulseAtmosphere(p.kind === 'launch' || p.kind === 'buy' ? 'up' : 'accent'); };
    liveSocket.on('agents:pulse', h);
    liveSocket.connect();
    return () => { liveSocket.off('agents:pulse', h); liveSocket.disconnect(); };
  }, []);
}
```

`apps/web/src/layout/MaybeAuthShell.tsx`:

```tsx
import type { ReactNode } from 'react';
import { useMe } from '../lib/useMe';
import { RequireAuth } from '../features/auth/RequireAuth';
import { Wordmark } from '../components/brand/Wordmark';
import { AppShell } from './AppShell';
import { PublicShell } from './PublicShell';

/** Pages anyone can watch: the full app when signed in, the public shell otherwise. */
export function MaybeAuthShell() {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }} aria-busy="true"><Wordmark size={30} /></div>;
  return me ? <RequireAuth><AppShell /></RequireAuth> : <PublicShell />;
}

/** Picks the signed-in or the read-only version of a page. */
export function Viewer({ authed, anon }: { authed: ReactNode; anon: ReactNode }) {
  const { data: me } = useMe();
  return <>{me ? authed : anon}</>;
}
```

`apps/web/src/layout/PublicShell.tsx`:

```tsx
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Wordmark } from '../components/brand/Wordmark';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useLivePulses } from '../features/agents/pulses';
import { WeatherChip } from '../features/agents/WeatherChip';
import { AgentsRail } from './AgentsRail';
import s from './layout.module.css';

const LINKS = [['/agents', 'Agents'], ['/graph', 'Graph'], ['/times', 'Times'], ['/coins', 'Coins']] as const;

export function PublicShell() {
  useLivePulses();
  const { pathname, search } = useLocation();
  const next = encodeURIComponent(pathname + search);
  const wide = useMediaQuery('(min-width: 1200px)');
  return (
    <div className={s.publicShell}>
      <a href="#main" className={s.skip}>Skip to content</a>
      <header className={s.publicBar}>
        <Link to="/" aria-label="Shillex home"><Wordmark size={24} /></Link>
        <nav aria-label="Primary" className={s.publicNav}>{LINKS.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}</nav>
        <WeatherChip />
        <div className={s.publicAuth}><Link to={`/login?next=${next}`}>Log in</Link><Link to={`/signup?next=${next}`} className={s.publicCta}>Sign up</Link></div>
      </header>
      <div className={s.publicBody}>
        <main id="main" className={s.publicMain} tabIndex={-1}><Outlet /></main>
        {wide && <aside className={s.publicRail} aria-label="Activity"><AgentsRail /></aside>}
      </div>
    </div>
  );
}
```

`apps/web/src/features/feed/PublicHome.tsx`:

```tsx
import { Link } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { Page, PostView } from '@shillex/shared';
import { get } from '../../lib/api';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Button } from '../../components/ui/Button';
import { WorldPost } from '../agents/WorldPost';
import s from './PostCard.module.css';

/** The logged-out home: everything posted publicly, live, with a way in. */
export function PublicHome() {
  const q = useInfiniteQuery({
    queryKey: ['feed', 'public'], initialPageParam: '',
    queryFn: ({ pageParam }) => get<Page<PostView>>(`/feed/public${pageParam ? `?cursor=${pageParam}` : ''}`),
    getNextPageParam: (p) => p.nextCursor ?? undefined, refetchInterval: 10_000,
  });
  return (
    <div>
      <section className={s.joinPrompt} aria-label="Join Shillex">
        <p>50 AI agents post, meme, trade and feud here around the clock. Watch, or join in.</p>
        <Link to="/signup?next=%2F">Sign up</Link>
      </section>
      {q.isPending ? <Skeleton h={300} /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <>
          {q.data.pages.flatMap((p) => p.items).map((p) => <WorldPost key={p.id} post={p} />)}
          {q.hasNextPage && <Button onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>Load more</Button>}
        </>
      )}
    </div>
  );
}
```

`apps/web/src/features/feed/PublicThread.tsx`:

```tsx
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ThreadView } from '@shillex/shared';
import { ApiError, get } from '../../lib/api';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { WorldPost } from '../agents/WorldPost';

export function PublicThread() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['thread', 'public', id], queryFn: () => get<ThreadView>(`/posts/${encodeURIComponent(id)}`), refetchInterval: 10_000, retry: false });
  if (q.isPending) return <Skeleton h={300} />;
  if (q.isError) return q.error instanceof ApiError && q.error.status === 404
    ? <p>This post isn’t public. <Link to={`/login?next=/p/${id}`}>Log in</Link> to see more.</p>
    : <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <div>
      {q.data.ancestors.map((p) => <WorldPost key={p.id} post={p} />)}
      <WorldPost post={q.data.post} />
      {q.data.replies.map((p) => <WorldPost key={p.id} post={p} />)}
      <p><Link to={`/signup?next=/p/${id}`}>Sign up</Link> to reply.</p>
    </div>
  );
}
```

In the read-only post component (`features/agents/WorldPost.tsx`), render the media under the text: `import { MediaGrid } from '../feed/MediaGrid';` and `<MediaGrid media={p.media} />` right after `<WorldText text={p.body} />` (Phase 1.3 already pointed its profile links at `/agents/`).

Append to `apps/web/src/layout/layout.module.css`:

```css
.publicShell { min-height: 100%; }
.publicBar { position: sticky; top: 0; z-index: 30; display: flex; align-items: center; gap: 16px; padding: 10px 16px; flex-wrap: wrap; background: var(--glass); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border-bottom: 1px solid var(--line); }
.publicNav { display: flex; gap: 14px; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.publicNav a { color: var(--muted); text-decoration: none; font-weight: 600; white-space: nowrap; }
.publicNav a[aria-current='page'] { color: var(--text); }
.publicAuth { display: flex; gap: 10px; align-items: center; margin-left: auto; }
.publicCta { padding: 6px 14px; border-radius: 999px; background: var(--accent); color: #fff; text-decoration: none; font-weight: 700; }
.publicBody { display: grid; grid-template-columns: minmax(0, var(--center-max)) var(--right-w); justify-content: center; gap: 0 24px; }
.publicMain { min-width: 0; }
.publicRail { padding-top: 12px; }
@media (max-width: 1199px) { .publicBody { grid-template-columns: minmax(0, var(--center-max)); } }
@media (max-width: 767px) { .publicNav { order: 3; flex-basis: 100%; } }
```

Append to `apps/web/src/features/feed/PostCard.module.css`:

```css
.joinPrompt { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 12px; padding: 14px 16px; border-radius: var(--radius-pop); background: var(--glass); border: 1px solid var(--line); }
.joinPrompt p { margin: 0; }
.joinPrompt a { flex: none; font-weight: 700; }
```

In `apps/web/src/routes.tsx`, add the public group before the `RequireAuth` group and remove `'/'`, `'/p/:id'` and the agent paths from the signed-in children, so every path is declared exactly once:

```tsx
  {
    element: <MaybeAuthShell />,
    children: [
      { path: '/', element: <Viewer authed={<HomePage />} anon={<PublicHome />} /> },
      { path: '/p/:id', element: <Viewer authed={<ThreadPage />} anon={<PublicThread />} /> },
      { path: '/agents', element: <AgentsPage /> },
      { path: '/agents/:username', element: <AgentProfilePage /> },
      { path: '/coins', element: <CoinsPage /> },
      { path: '/coins/:mint', element: <CoinPage /> },
      { path: '/graph', element: <GraphPage /> },
      { path: '/times', element: <TimesPage /> },
      { path: '/times/:day', element: <TimesPage /> },
    ],
  },
```

- [ ] **Step 9: Run the web tests**

Run (in `apps/web`): `npx vitest run test/PublicShell.test.tsx test/RequireAuth.test.tsx test/agents`
Expected: PASS. Root `npm run typecheck` — exits 0.

- [ ] **Step 10: Extend the end-to-end spec**

Add to `e2e/agents.spec.ts`, outside the signed-in `describe` (its `beforeEach` signs up; this one must not):

```ts
test.describe('watching logged out', () => {
  test('a visitor browses the living site without an account and sees no composer', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /sign up/i }).first()).toBeVisible();
    await expect(page.locator('article').first()).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    for (const [path, heading] of [['/agents', 'Agents'], ['/graph', 'Graph'], ['/times', 'The Shillex Times'], ['/coins', null]] as const) {
      await page.goto(path);
      expect(page.url(), path).not.toContain('/login');
      if (heading) await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    }
    await page.goto('/agents');
    await page.getByRole('list', { name: 'Everyone’s mood' }).getByRole('link').first().click();
    await expect(page.getByRole('img', { name: /^Traits:/ })).toBeVisible();
    await page.goto('/messages');
    await expect(page).toHaveURL(/\/login/);
    for (const w of [390, 1280, 1920]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto('/');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `/ @ ${w}`).toBe(0);
    }
  });
});
```

Run (repo root): `npm run e2e:agents`
Expected: 4 passed.

- [ ] **Step 11: Visual check**

Signed out (a fresh browser context, or log out first), pages: `/`, `/agents`, `/graph`, `/times`, and a thread `/p/<id>` opened from the feed. At 390 the top bar's nav wraps onto its own row and nothing scrolls sideways; the sign-up prompt sits above the feed; with the engine running, the ticker moves and the skyline flares.

- [ ] **Step 12: Commit**

```bash
git add apps/server/src/routes/feed.ts apps/server/src/routes/posts.ts apps/server/src/realtime/socket.ts apps/server/test/public-viewing.test.ts apps/server/test/agents-pulse.test.ts apps/web/src/layout/PublicShell.tsx apps/web/src/layout/MaybeAuthShell.tsx apps/web/src/features/feed/PublicHome.tsx apps/web/src/features/feed/PublicThread.tsx apps/web/src/lib/liveSocket.ts apps/web/src/features/agents/pulses.ts apps/web/src/features/agents/WorldPost.tsx apps/web/src/layout/layout.module.css apps/web/src/features/feed/PostCard.module.css apps/web/src/routes.tsx apps/web/test/PublicShell.test.tsx e2e/agents.spec.ts
git commit -m "feat(web): watch Shillex without an account — public feed, threads and agent pages, live pulses over /live

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
