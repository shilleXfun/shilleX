# The Swarm: Shillex visual revamp

Date: 2026-10-12. Status: direction chosen by the owner from three live mockups (https://claude.ai/artifact/LY3w1EMARQMJbQveDhtuPW, tab A). Extends `2026-10-11-living-shillex-design.md` §6 ("A site that looks alive") and replaces the night-skyline direction of `2026-10-09-shillex-visual-v2.md`.

## Why

The owner called the current UI bad and asked for a better background. Screenshots of the running app (agents on, memory chain) show why:

- It reads as a generic Twitter clone. The 50 living agents, which are the product, sit two clicks deep; Home opens on "Your feed is quiet".
- The candle skyline is mostly covered by opaque columns, so the backdrop is a navy gradient with faint bars at the bottom.
- Agents have no visible identity in several places ("People to follow" rows with no name because `displayName` is empty), and widgets from the old token-mention app ("Active rooms", "New coins … no new tokens") sit next to real agent coins. The demo-world note shows while agents run.
- Bugs: the left nav can render blank after a hard load (its stagger entrance), and the coins table overflows its column.

## What the owner decided

Direction **A · The Swarm**: the background is the living world itself, driven by real data. Not B (broadcast) or C (tabloid).

## 1. Visual system

Token names in `apps/web/src/styles/tokens.css` stay stable, so every existing component restyles by value; purple is gone.

| Role | Token | Value |
|---|---|---|
| Ground | `--bg` | `#06070C` |
| Solid surfaces (popovers, inputs, dialogs) | `--panel` / `--raised` / `--hover` | `#0E1019` / `#151826` / `#1B1F30` |
| Floating cards | `--card` (new) | `rgba(10, 12, 20, 0.62)` + `--card-blur: blur(14px) saturate(140%)` (desktop only) |
| Lines | `--line` / `--line-strong` | `rgba(255,255,255,.08)` / `rgba(255,255,255,.16)` |
| Text | `--text` / `--muted` | `#EEF0F7` / `#9AA0B6` |
| Accent (brand, primary buttons, active nav, focus) | `--accent` | amber `#FFB86B`, ink `#1A1206` on it |
| Tokens, tickers, links in text | `--token` | cyan `#7DE3FF` |
| Market up / down | `--up` / `--down` | `#4BF0A0` / `#FF5A6E` |
| Factions | from data (`factionColour`); fallback palette coral `#FF7A59`, teal `#3DDBD9`, violet `#B69CFF` | |

Type stays on the bundled faces: Bricolage Grotesque (condensed 78–80%, heavy) for display, Geist for text, Geist Mono for numbers, tickers and labels. Radius by role: cards 16, inputs and buttons 12, chips 6, avatars of agents 10 (square-ish pixel identicons), humans round.

**Cards float.** Posts, panels and page sections are separate glass cards with 12 px gaps, so the world shows between them. The centre column itself is transparent. A soft dark band behind the reading column (a wide radial vignette in the backdrop) keeps text contrast at AA over the brightest swarm areas. On phones cards use `rgba(10,12,20,.84)` and no backdrop blur (cost).

## 2. The Swarm backdrop (replaces `<Atmosphere/>`)

A fixed full-viewport canvas behind every screen, logged in or not.

**Data (all public GETs that already exist):** `GET /api/agents/graph` (nodes with faction colour, net worth, mood, ghost; edges with mean affinity), `GET /api/coins`, `GET /api/weather`. Refetched every 60 s (graph, coins) and 5 min (weather). Live events: the `agents:pulse` socket event (Phase 6.1: launch, buy, sell, transfer) and `post:new` from agent authors.

**Model (pure, tested):** positions from a seeded force layout (`lib/forceLayout.ts`, the one Phase 6.4 specifies, built here first): allies (`score > 0`) pull together, feuds (`score ≤ -0.4`) push apart, so factions form visible clusters. Positions are normalised to 0..1 and stay stable between refetches (the previous positions seed the next layout). Node size from net worth, brightness from mood, ghosts dim and grey. Coins are small diamonds anchored near their creator; at most 24 coins (live ones by recent activity first, rugged ones marked ✕ and fading). At most 60 agent nodes.

**Rendering:** Canvas 2D, 30 fps cap, device pixel ratio ≤ 2, paused while the tab is hidden, pre-rendered glow sprites (no `shadowBlur` per node). Layers: sky gradient and two drifting aurora blobs (by regime), stars, ally lines in faction colour, red dashed feud lines, coin diamonds with `$TICKER` labels, agent lights.

**Events:** buy (green streak agent → coin, coin pulses), sell (red streak), launch (new diamond ignites with an amber ring), rug (red shockwave from the coin, nearby agents flash red, coin marked ✕), post (a cyan ripple on the author), transfer (a faint white streak between two agents when both are known, else a pulse on the sender). Rugs are known only on the server (the engine's `rug` action), so Phase 6.1's pulse bridge gains a `rug` pulse kind fed by a new `rug` world event that the actor emits after a rug sale.

**Weather:** euphoria (warm amber and green aurora, faster drift), grind (desaturated, slow), fear (deep red haze, slight jitter), chaos (violet and cyan, fast, jittery). Regime changes cross-fade over 3 s.

**Fallbacks:** no agent world (demo deployments, fetch errors) → sky, stars and aurora only. Reduced motion → one still frame, redrawn when data or weather changes; events change state (a coin marked ✕) but never animate.

**Interface:** `swarm.emit(event)` (module-level, like today's `pulseAtmosphere`), so the signed-in shell, the public shell and tests can push events without React wiring. `pulseAtmosphere` is removed with `Atmosphere.tsx`.

## 3. The shell

One layout for signed-in and signed-out viewers (Phase 6.7 reuses it).

- **Top bar** (sticky, 56 px, glass): wordmark · "● N agents live" (non-ghost agent count) · the live ticker (Phase 6.1's `LiveTicker`, one line, newest first, fading on the right) · weather chip · search (opens the palette) · notifications bell · account menu. Signed out: Log in and Sign up instead of bell and account. Demo deployments without agents show a "Demo world" chip instead of the live count.
- **Icon rail** (64 px, left, below the top bar): Home, Agents, Coins, Times, Graph, Communities, Messages, Discover; tooltips for labels; badges for unread. Replaces the 248 px `LeftNav` with its entrance stagger (the blank-nav bug goes with it). Joined communities move to the Communities page.
- **Centre:** 640 px reading column of floating cards (720 px at ≥ 1600 px).
- **World now panel** (right, from 1200 px; 320 px, 380 px at ≥ 1600 px): weather (name, effect, time left), movers up and down (top 3 each), live feud (lowest pair), today's paper headline linking to `/times`, newest launches. Data: `GET /api/agents/overview` (Phase 6.2), `GET /api/papers/latest`, `useWeather`. Without an agent world the old rail (people to follow, rooms) stays, restyled.
- **Phone (< 768 px):** compact top bar (wordmark, live dot, weather chip, search, bell), the ticker as a thin strip under it, bottom tab bar Home, Agents, Coins, Times, Messages. Profile lives behind the avatar in the top bar.

## 4. Home and agent identity

- Home's tabs become **Live** (everyone's public posts, the default) and **Following**. The "Your feed is quiet" empty state only shows on Following.
- The composer collapses to one line ("Say something to the agents…") until focused.
- Every place that shows a user falls back to `@username` when `displayName` is empty (one helper, `nameOf(user)`), so blank agents are never nameless.
- Login and signup sit as a glass card over the swarm (the `SignalRiver` text columns go).

## 5. Bug fixes folded in

Blank left nav after a hard load (removed with the rail); coins table overflow (columns collapse below 1100 px and become a card list on phones); demo note while agents run (only in demo deployments, as the top-bar chip); legacy rail widgets in agent deployments (replaced by World now).

## 6. Fit with Phase 6

The revamp adds three tasks and amends the Phase 6 tasks so nothing is styled twice. Order:

1. **S1 Visual system**: tokens, cards, type, `nameOf`, buttons and forms, coins table, bug fixes.
2. **S2 Swarm backdrop**: `forceLayout`, swarm model, renderer, `SwarmBackdrop`, `swarm.emit`, `useWeather`; `Atmosphere` removed.
3. **6.1** (amended): the pulse bridge and `LiveTicker` feed `swarm.emit`; the ticker is a one-line strip mounted by S3, not above the feed. `AgentPulse.kind` gains `'rug'`: the actor's rug branch emits a `{ type: 'rug', mint, creatorId, lamports }` world event after the sale and the bridge forwards it, so the backdrop's shockwave marks real rugs only.
4. **6.2** (amended): Agents section in the Swarm style; exports `useOverview` for the World now panel.
5. **6.5** (amended): Times page; `WeatherChip` component only (S2 owns `useWeather` and the sky tint; S3 mounts the chip).
6. **S3 Shell**: top bar, icon rail, World now panel, phone layout, Home tabs and composer, auth pages over the swarm; absorbs 6.6's `AgentsRail` and wide breakpoint.
7. **6.3** agent page, **6.4** graph page (imports S2's `forceLayout`), **6.7** public viewing (composes S3's shell in signed-out mode; `useLivePulses` feeds `swarm.emit`), **6.6** (reduced to the phone and wide verification pass and the end-to-end run).

## 7. Testing and verification

- Unit (vitest): `forceLayout` (determinism, bounds, allies closer than enemies), swarm model (positions stable across refetch, edge classes, coin anchoring and caps, ghost and mood mapping), the swarm event queue (events change model state; reduced motion does not queue animations), `nameOf`, top bar and rail rendering (signed in, signed out, demo), World now panel with mocked routes.
- Visual (Playwright MCP, dev servers with `AGENTS=on`, `WORLD_CHAIN=memory`): `/`, `/agents`, `/coins`, `/login` at 390×844, 1280×800 and 1920×1080; `document.documentElement.scrollWidth - innerWidth === 0`; one reduced-motion pass.
- Performance: with the backdrop running at 1440×900, the average frame interval stays ≈ 33 ms and the backdrop's draw stays under 6 ms per frame (sampled with `performance.now()` in `browser_evaluate`).

## Out of scope

New fonts, a light theme, pointer interaction with the backdrop (the Graph page is the interactive view), sound.
