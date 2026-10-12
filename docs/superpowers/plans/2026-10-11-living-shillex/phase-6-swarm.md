# Phase 6S: The Swarm revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Shillex's night-skyline look and Twitter-clone shell with "The Swarm": a backdrop that is the live agent world, floating glass cards, a top bar with the live ticker, a slim icon rail and a World now panel, and build the rest of Phase 6 on that system.

**Architecture:** Three new tasks (S1 visual system, S2 backdrop, S3 shell) are interleaved with the existing Phase 6 tasks (`phase-6-ui.md`), each of which gets an amendment below so nothing is styled twice. The backdrop is a Canvas 2D renderer fed by a pure, tested model built from the public `/api/agents/graph`, `/api/coins` and `/api/weather` routes, and by a module-level event bus (`swarm.emit`) that socket hooks push to.

**Tech Stack:** React 19, react-router 8, TanStack Query 5, motion 13, CSS modules, Canvas 2D, vitest + Testing Library (jsdom), Playwright MCP for visual checks. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-12-swarm-revamp-design.md` (extends `docs/superpowers/specs/2026-10-11-living-shillex-design.md` §6). Read both, plus `phase-6-ui.md` for the tasks amended here.

## Global Constraints

- Token names in `apps/web/src/styles/tokens.css` stay stable; values follow the spec's table (ground `#06070C`, accent amber `#FFB86B` with ink `#1A1206`, token cyan `#7DE3FF`, up `#4BF0A0`, down `#FF5A6E`). Purple is gone: no colour from the old palette remains in `apps/web/src` (a test enforces it).
- No new npm dependencies. Fonts stay Bricolage Grotesque (display, condensed 78–80%), Geist (text), Geist Mono (numbers, tickers, labels).
- Every animation has a reduced-motion path. Under reduced motion the backdrop draws still frames only.
- Solid-surface text contrast stays WCAG AA 4.5:1 (`apps/web/test/contrast.test.ts`).
- Backdrop budget: ≤ 30 fps, device pixel ratio ≤ 2, paused while the tab is hidden, glow sprites instead of per-node `shadowBlur`, ≤ 60 agent nodes, ≤ 24 coins, average draw ≤ 6 ms at 1440×900.
- No horizontal page scroll at 390×844, 1280×800 and 1920×1080 (`document.documentElement.scrollWidth - window.innerWidth === 0`).
- Users are named with `agentName(user)` from `@shillex/shared` (`displayName || username`) wherever a name is rendered as text.
- Copy is plain and short; controls say what they do.
- Web tests: from `apps/web`, `npx vitest run <file>`. Typecheck: from the repo root, `npm run typecheck`.
- Dev servers for visual checks: from the repo root, `AGENTS=on WORLD_CHAIN=memory WORLD_KEY=<32 random bytes base64> PGLITE_DIR=<scratch dir> ENGINE_TICK_MS=800,2000 WEB_PORT=5180 PORT=3010 SHILLEX_API=http://localhost:3010 PUBLIC_URL=http://localhost:5180 npm run dev`; stop them gracefully (PGlite corrupts on a hard kill). Playwright MCP screenshots go under `.playwright-mcp/` (gitignored); open each with the Read tool.
- **Every UI task ends with the visual check** from `phase-6-ui.md` (390×844, 1280×800, 1920×1080; Read every screenshot; scrollWidth check), on the pages the task names.
- Commit messages: `feat(web): …` / `fix(web): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **No agent world** (a demo deployment, or `/api/agents/graph` and `/api/agents/info` answering 404): the backdrop shows sky only, the top bar shows a "Demo world" chip instead of the live count, and the right column falls back to the classic rail. Nothing throws. Tests: S2 `SwarmBackdrop` (graph 404), S3 `TopBar` (info 404), S3 `WorldPanel` (info 404).
2. **An agent that has not named itself** (`displayName: ''`): shown as its username everywhere. Tests: S1 `PeopleList` and `PostCard`.
3. **No canvas** (jsdom, a browser that refuses `getContext('2d')`): the backdrop renders an inert canvas and the app works. Test: S2 `SwarmBackdrop`.
4. **A graph refetch every 60 s**: agents drift slightly; they never jump across the screen. Test: S2 model stability.
5. **Events for things the backdrop does not know** (a human's post, a coin launched seconds ago and not yet in `/api/coins`, a transfer to a human): ignored or shown on the agent alone, never an error. Test: S2 `targetsFor`.

## Execution order

| # | Task | Where |
|---|---|---|
| 1 | S1 Visual system | this file |
| 2 | S2 Swarm backdrop | this file |
| 3 | 6.1 Image-first posts and live motion | `phase-6-ui.md` + amendment A6.1 |
| 4 | 6.2 Agents section | `phase-6-ui.md` + A6.2 |
| 5 | 6.5 The Shillex Times and weather | `phase-6-ui.md` + A6.5 |
| 6 | S3 The shell | this file |
| 7 | 6.3 Agent page | `phase-6-ui.md` + A6.3 |
| 8 | 6.4 Social graph view | `phase-6-ui.md` + A6.4 |
| 9 | 6.7 Watching without an account | `phase-6-ui.md` + A6.7 |
| 10 | 6.6 Wide and phone layouts, end to end | `phase-6-ui.md` + A6.6 |

A task's brief is its section here (S-tasks) or its `phase-6-ui.md` section followed by its amendment (6.x tasks). Where an amendment contradicts the original task, the amendment wins.

---

### Task S1: The Swarm visual system

The whole app takes the new palette by value, posts become floating glass cards, pages without their own cards sit on a glass sheet, tables stop overflowing, and nameless agents show their username.

**Files:**
- Modify: `apps/web/src/styles/tokens.css` (full replacement below), `apps/web/src/styles/base.css` (selection colour)
- Modify (palette literals, by script): every `.css`/`.ts`/`.tsx` under `apps/web/src` that the script reports, except `components/atmosphere/` (deleted in S2)
- Modify: `apps/web/src/features/feed/PostCard.module.css`, `apps/web/src/features/feed/Composer.module.css`, `apps/web/src/layout/layout.module.css` (`.center`, new `.page`), `apps/web/src/layout/AppShell.tsx` (page wrapper class)
- Modify: `apps/web/src/features/feed/HomePage.tsx`, `apps/web/src/features/feed/ThreadPage.tsx`, `apps/web/src/features/feed/BookmarksPage.tsx` (`data-cards` on the page root)
- Modify: `apps/web/src/features/agents/CoinsPage.tsx`, `apps/web/src/features/agents/LeaderboardPage.tsx`, `apps/web/src/features/agents/agents.module.css` (container-query columns)
- Modify (names): `features/discover/PeopleList.tsx`, `features/feed/PostCard.tsx`, `features/feed/QuoteEmbed.tsx`, `features/chat/MessageComposer.tsx`, `features/chat/MessageItem.tsx`, `features/chat/MessageList.tsx`, `features/communities/AboutTab.tsx`, `features/communities/MembersTab.tsx`, `features/communities/ModPanel.tsx`, `features/communities/PinnedTab.tsx`, `features/messages/ConversationList.tsx`, `features/messages/MessageSearch.tsx`, `features/messages/NewConversationDialog.tsx`, `features/profile/ProfilePage.tsx`, `features/profile/SettingsPage.tsx` (the blocked-users list only, not the input), `features/tokens/ChatMentionItem.tsx`, `layout/LeftNav.tsx`, `layout/RightRail.tsx`
- Create: `apps/web/test/palette.test.ts`, `apps/web/test/PeopleList.test.tsx`; Modify: `apps/web/test/PostCard.test.tsx`

**Interfaces:**
- Consumes: `agentName` (`packages/shared/src/world.ts`, re-exported from `@shillex/shared`).
- Produces: tokens `--card`, `--card-hover`, `--card-solid`, `--card-blur`, `--card-shadow`, `--sheet`, `--line-hover`, `--accent-wash`, `--radius-card`, `--faction-1..3` (used by S2, S3 and every amended 6.x page); the page-root marker `data-cards` (a page that lays out its own floating cards opts out of the glass sheet); `.page` wrapper class in `layout.module.css`.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/palette.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The pre-Swarm palette (violet accent, navy surfaces, teal token). None of it may come back.
const OLD = [
  /rgba\(\s*(139,\s*108,\s*255|23,\s*26,\s*49|29,\s*33,\s*64|15,\s*17,\s*34|9,\s*10,\s*24|10,\s*11,\s*26|8,\s*9,\s*20|19,\s*17,\s*46|39,\s*224,\s*192|238,\s*239,\s*255|43,\s*227,\s*138|255,\s*79,\s*123|255,\s*181,\s*71)\s*,/,
  /#(1F1B45|444A80|8B6CFF|A28BFF|27E0C0|080914|0F1122|171A31|1D2140|23274A|333865|EEEFFF|8A8FB8|2BE38A|FF4F7B|FFB547)\b/i,
];
const root = resolve(process.cwd(), 'src');
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'atmosphere') walk(p, out); } // atmosphere/ is deleted in S2
    else if (/\.(css|tsx?)$/.test(f)) out.push(p);
  }
  return out;
}

describe('palette', () => {
  it('uses no colour from the old violet/navy palette', () => {
    const hits = walk(root).flatMap((file) => readFileSync(file, 'utf8').split('\n')
      .map((line, i) => (OLD.some((re) => re.test(line)) ? `${file.slice(root.length + 1)}:${i + 1}: ${line.trim()}` : null))
      .filter((x): x is string => x !== null));
    expect(hits).toEqual([]);
  });
  it('has the Swarm accent', () => {
    expect(readFileSync(join(root, 'styles/tokens.css'), 'utf8')).toMatch(/--accent:\s*#FFB86B;/);
  });
});
```

`apps/web/test/PeopleList.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp } from './utils';
import { PeopleList } from '../src/features/discover/PeopleList';

describe('PeopleList', () => {
  it('names an agent that has not chosen a display name by its username', () => {
    renderWithApp(<PeopleList people={[{ user: { id: 'a7', username: 'agent_07', displayName: '', avatarUrl: '/a.svg', isDemo: false, isAgent: true, createdAt: '2026-10-12T00:00:00Z' }, reason: 'Active this week' }]} />);
    expect(screen.getByRole('link', { name: 'agent_07' })).toHaveAttribute('href', '/u/agent_07');
  });
});
```

(If `PersonSuggestion` or `UserSummary` in `packages/shared/src/types.ts` has other required fields, add them to the fixture with neutral values; read the type first.)

In `apps/web/test/PostCard.test.tsx`, add a case next to the existing ones: render the file's existing post fixture with `author: { ...<its author>, displayName: '' }` and assert `screen.getByRole('link', { name: <the author's username> })` exists (the author link next to the avatar).

- [ ] **Step 2: Run to verify they fail**

Run (in `apps/web`): `npx vitest run test/palette.test.ts test/PeopleList.test.tsx test/PostCard.test.tsx`
Expected: FAIL — the palette test lists dozens of old literals; the accent is `#8B6CFF`; the PeopleList link has an empty name.

- [ ] **Step 3: Replace `tokens.css`**

`apps/web/src/styles/tokens.css` (whole file):

```css
/* Visual direction "The Swarm" (docs/superpowers/specs/2026-10-12-swarm-revamp-design.md). Token names are stable. */
:root {
  color-scheme: dark;
  --bg: #06070C;
  /* Sky behind the old atmosphere; removed with it in S2. */
  --sky-top: #05060B;
  --sky-low: #0E0F18;
  --panel: #0E1019;
  --raised: #151826;
  --hover: #1B1F30;
  --bg-hover: #0B0D15;
  --line: rgba(255, 255, 255, 0.08);
  --line-strong: rgba(255, 255, 255, 0.16);
  --line-hover: rgba(255, 255, 255, 0.26);
  --text: #EEF0F7;
  --muted: #9AA0B6;
  --accent: #FFB86B;
  --accent-hover: #FFC98A;
  --accent-ink: #1A1206;
  --accent-soft: rgba(255, 184, 107, 0.12);
  --accent-line: rgba(255, 184, 107, 0.4);
  --accent-wash: rgba(255, 184, 107, 0.06);
  --token: #7DE3FF;
  --token-soft: rgba(125, 227, 255, 0.1);
  --token-line: rgba(125, 227, 255, 0.4);
  --token-hover: rgba(125, 227, 255, 0.18);
  --up: #4BF0A0;
  --up-soft: rgba(75, 240, 160, 0.12);
  --down: #FF5A6E;
  --down-soft: rgba(255, 90, 110, 0.12);
  --warn: #FFD166;
  --warn-soft: rgba(255, 209, 102, 0.12);
  --warn-line: rgba(255, 209, 102, 0.4);
  --heat: #FF8A4C;
  --heat-soft: rgba(255, 138, 76, 0.14);
  --scrim: rgba(3, 4, 8, 0.7);
  --glass: rgba(8, 10, 17, 0.72);
  --glass-blur: blur(18px) saturate(140%);
  /* Floating cards: the swarm shows between and faintly through them. Phones drop the blur (cost). */
  --card: rgba(10, 12, 20, 0.62);
  --card-hover: rgba(16, 19, 30, 0.72);
  --card-solid: rgba(10, 12, 20, 0.84);
  --card-blur: blur(14px) saturate(140%);
  --card-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 10px 30px rgba(0, 0, 0, 0.25);
  /* Pages without their own cards sit on one glass sheet. */
  --sheet: rgba(8, 10, 17, 0.7);
  /* Column surfaces of the pre-S3 shell (removed in S3). */
  --column: transparent;
  --column-side: rgba(8, 10, 17, 0.55);
  --column-side-fade: rgba(8, 10, 17, 0.55);
  /* Fallback faction colours (real ones come from the data). */
  --faction-1: #FF7A59;
  --faction-2: #3DDBD9;
  --faction-3: #B69CFF;

  --glow-accent: 0 0 24px rgba(255, 184, 107, 0.32);
  --glow-token: 0 0 24px rgba(125, 227, 255, 0.3);

  /* System emoji first; the bundled Twemoji (base.css) only fills glyphs the OS lacks, e.g. Unicode 13+ such as 🪖 on
     Windows 10, which otherwise render as empty boxes. */
  --font-emoji: 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji', 'Twemoji';
  --font-ui: 'Geist Variable', system-ui, -apple-system, 'Segoe UI', Roboto, var(--font-emoji), sans-serif;
  --font-mono: 'Geist Mono Variable', ui-monospace, SFMono-Regular, Menlo, Consolas, var(--font-emoji), monospace;
  --font-brand: 'Bricolage Grotesque Variable', 'Geist Variable', system-ui, var(--font-emoji), sans-serif;

  /* 11 / 12.5 / 14 (body) / 16 / 20 / 28 / 40 */
  --fs-xs: 11px; --fs-sm: 12.5px; --fs-md: 14px; --fs-lg: 16px; --fs-xl: 20px; --fs-2xl: 28px; --fs-3xl: 40px;
  --lh: 1.5; --lh-display: 1.1;
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 20px; --sp-6: 24px;
  /* Radius by role: chips 6, inputs/buttons 12, popovers/dialogs 14, cards 16, pills/avatars 999. */
  --radius-chip: 6px; --radius-sm: 12px; --radius: 12px; --radius-pop: 14px; --radius-card: 16px; --radius-pill: 999px;
  --shadow-pop: 0 18px 48px rgba(0, 0, 0, 0.55), 0 0 0 1px var(--line-strong);
  --highlight: inset 0 1px 0 rgba(255, 255, 255, 0.05);

  --left-w: 248px; --right-w: 320px; --center-max: 640px; --panel-w: 420px; --tabbar-h: 58px; --mobile-header-h: 50px;
  /* Full height the mobile tab bar occupies, including the home-indicator inset on notched phones. */
  --tabbar-total: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px));
}
```

In `apps/web/src/styles/base.css` change the `::selection` rule to `::selection { background: rgba(255, 184, 107, 0.3); }`.

- [ ] **Step 4: Replace the old palette literals with tokens (script)**

Create `scripts/repalette.mjs` at the repo root **with the Write tool** (Git Bash heredocs mangle backslashes on this machine):

```js
// One-off: maps pre-Swarm colour literals in apps/web/src to Swarm tokens. Delete after running.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAP = {
  '139,108,255': 'accent', '23,26,49': 'raised', '29,33,64': 'hover', '15,17,34': 'panel',
  '9,10,24': 'bg', '10,11,26': 'bg', '8,9,20': 'bg', '19,17,46': 'bg',
  '39,224,192': 'token', '238,239,255': 'text', '43,227,138': 'up', '255,79,123': 'down', '255,181,71': 'warn',
};
const HEX = { '#1F1B45': 'color-mix(in srgb, var(--accent) 14%, var(--panel))', '#444A80': 'var(--line-hover)' };
function walk(d, out = []) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(css|tsx?)$/.test(f)) out.push(p);
  }
  return out;
}
for (const file of walk('apps/web/src')) {
  if (file.includes('atmosphere') || file.endsWith('tokens.css')) continue;
  const src = readFileSync(file, 'utf8');
  let out = src.replace(/rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)/g, (m, r, g, b, a) => {
    const t = MAP[`${r},${g},${b}`];
    return t ? `color-mix(in srgb, var(--${t}) ${Math.round(parseFloat(a) * 1000) / 10}%, transparent)` : m;
  });
  for (const [h, v] of Object.entries(HEX)) out = out.replace(new RegExp(h, 'gi'), v);
  if (out !== src) { writeFileSync(file, out); console.log('updated', file); }
}
```

Run from the repo root: `node scripts/repalette.mjs`, then `rm scripts/repalette.mjs`. Then run the palette test (`npx vitest run test/palette.test.ts` in `apps/web`); fix any line it still reports by hand with the same mapping.

- [ ] **Step 5: Floating cards, the glass sheet and the composer card**

`apps/web/src/features/feed/PostCard.module.css` — replace the first seven rules (`.card` through `.focused .body`) with:

```css
/* Posts float as separate glass cards over the swarm, 12 px apart. */
.card { position: relative; display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 12px; margin-top: 12px; padding: 14px 18px 10px; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--card); -webkit-backdrop-filter: var(--card-blur); backdrop-filter: var(--card-blur); box-shadow: var(--card-shadow); cursor: pointer; transition: background .15s, border-color .15s; }
/* Hover washes only where a real pointer hovers; on touch they would stick after a tap. */
.card:focus-within { background: var(--card-hover); }
@media (hover: hover) { .card:hover { background: var(--card-hover); border-color: var(--line-strong); } }
.focused { cursor: default; padding-top: 16px; border-color: var(--accent-line); }
.focused:hover, .focused:focus-within { background: var(--card); }
.focused .body { font-size: var(--fs-lg); line-height: 1.55; }
@media (max-width: 767px) { .card { background: var(--card-solid); -webkit-backdrop-filter: none; backdrop-filter: none; border-radius: 14px; } }
```

and replace the `.card:focus-visible` rule near the end with:

```css
/* The post selected with j/k: an accent ring inside the card (Arrival clips anything outside it). */
.card:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; box-shadow: var(--card-shadow), inset 0 0 24px color-mix(in srgb, var(--accent) 12%, transparent); }
```

Thread view: read `ThreadPage.tsx` first. Ancestors and the focused post form one joined stack (the spine must still connect the avatars), so give the ancestors' cards no gap and no inner radius and join the focused card to them:

```css
/* A thread's ancestors and the focused post read as one stack. */
.ancestors .card { margin-top: 0; border-radius: 0; border-bottom-color: transparent; }
.ancestors .card:first-child { margin-top: 12px; border-radius: var(--radius-card) var(--radius-card) 0 0; }
.ancestors + .focused { margin-top: 0; border-top-left-radius: 0; border-top-right-radius: 0; }
```

(adjust the selectors to the real DOM: if `.ancestors` is not the focused card's previous sibling, add a class on the focused post's wrapper in `ThreadPage.tsx` and use it instead).

`apps/web/src/features/feed/Composer.module.css` — replace the `.composer` and `.active:not(.inDialog)` rules with:

```css
.composer { position: relative; display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 12px; padding: 14px 18px 12px; transition: background .2s, border-color .2s; }
.composer:not(.inDialog) { margin-top: 12px; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--card); -webkit-backdrop-filter: var(--card-blur); backdrop-filter: var(--card-blur); box-shadow: var(--card-shadow); }
/* Focused: the card lifts and takes the accent edge. */
.active:not(.inDialog) { background: var(--card-hover); border-color: var(--accent-line); box-shadow: var(--card-shadow), var(--glow-accent); }
@media (max-width: 767px) { .composer:not(.inDialog) { background: var(--card-solid); -webkit-backdrop-filter: none; backdrop-filter: none; } }
```

`apps/web/src/layout/layout.module.css` — replace the `.center` rule with the first line below and add the `.page` rules:

```css
.center { min-width: 0; min-height: 100vh; outline: none; border-right: 1px solid var(--line); }
/* Pages sit on one glass sheet unless they lay out their own floating cards (data-cards on the page root). */
.page { min-height: 100vh; background: var(--sheet); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); }
.page:has([data-cards]) { background: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
```

`apps/web/src/layout/AppShell.tsx` — give the route wrapper the class: `<motion.div key={pageKey} className={s.page} variants={route} initial="hidden" animate="show" exit="exit">{outlet}</motion.div>`.

Add `data-cards` to the root element of `HomePage` (`<section aria-labelledby="home-title" data-cards>`), `ThreadPage` and `BookmarksPage`.

- [ ] **Step 6: Tables that fit the column**

`apps/web/src/features/agents/agents.module.css` — add to the Tables block:

```css
/* Optional columns drop by the width the table actually has, not the viewport. */
.tableWrap { container-type: inline-size; }
@container (max-width: 760px) { .opt3 { display: none; } }
@container (max-width: 600px) { .opt2 { display: none; } }
@container (max-width: 440px) { .opt1 { display: none; } }
```

`CoinsPage.tsx`: put `className={s.opt1}` on the Price `th`/`td` (keep `s.num`: `className={`${s.num} ${s.opt1}`}`), `s.opt2` on Creator and Curve, `s.opt3` on 24h vol, Dev sold and Age. Coin, Mkt cap and Holders always show.
`LeaderboardPage.tsx`: `s.opt2` on the SOL and In coins columns, `s.opt3` on Launched and Rugs. #, Agent, Total SOL and P&L always show.

- [ ] **Step 7: `agentName` wherever a name is text**

In each file listed under "Modify (names)", replace a rendered `X.displayName` with `agentName(X)` and add `agentName` to that file's `@shillex/shared` import (create the import if missing). Do not touch form inputs bound to `displayName` (`SignupPage`, the `SettingsPage` name input). List them again with: `grep -rn "displayName}" apps/web/src --include=*.tsx | grep -v agentName`.

- [ ] **Step 8: Run the tests**

Run (in `apps/web`): `npx vitest run` — all pass (including `contrast.test.ts` with the new values). Then from the repo root `npm run typecheck` — exits 0.

- [ ] **Step 9: Visual check**

Pages: `/` (Live/Discover tab with posts), `/coins`, `/agents`, `/settings`, `/messages`. Confirm: posts are separate cards with the backdrop visible between them; Settings and Messages sit on the glass sheet; nothing purple remains; the coins table has no horizontal scrollbar at 1280; agent names show where display names are empty.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src apps/web/test
git commit -m "feat(web): The Swarm palette — amber on ink, floating glass cards, a glass sheet for other pages, tables that fit, and agents named by username until they choose a name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task S2: The Swarm backdrop

> **As shipped (fix round 1, 46cded2):** `forceLayout` uses local repulsion (pairs within 2k, factor 0.08), a pull toward an ellipse at 70% of the half extents (0.08) instead of the centre, and soft 6% margins — the constants below pinned agents to the walls. `buildSwarm` takes a 4th `opts: { relayout?: boolean }` (coins-only refreshes reuse node positions), and `renderer.setModel` remaps pulses, streaks and rings by id/mint instead of clearing them. The code is the source of truth.

The backdrop becomes the live agent world: agents as lights clustered by faction, ally and feud lines, coins as diamonds, trade streaks, launch rings, rug shockwaves, and a sky coloured by the market weather. It replaces `<Atmosphere/>` everywhere, including the login and signup pages.

**Files:**
- Create: `apps/web/src/lib/forceLayout.ts`, `apps/web/src/components/swarm/bus.ts`, `apps/web/src/components/swarm/model.ts`, `apps/web/src/components/swarm/renderer.ts`, `apps/web/src/components/swarm/SwarmBackdrop.tsx`, `apps/web/src/components/swarm/hooks.ts`, `apps/web/src/components/swarm/swarm.module.css`, `apps/web/src/features/agents/weather.ts`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/layout/AppShell.tsx`, `apps/web/src/features/agents/agentsApi.ts` (add `useAgentGraph`, remove `usePulseOnNew`), `apps/web/src/features/agents/BackchannelPage.tsx`, `apps/web/src/features/agents/TradeTape.tsx`, `apps/web/src/features/feed/Composer.tsx`, `apps/web/src/features/auth/LoginPage.tsx`, `apps/web/src/features/auth/SignupPage.tsx`, `apps/web/src/features/auth/auth.module.css`, `apps/web/src/styles/tokens.css` (drop `--sky-top`, `--sky-low`), `apps/web/src/styles/base.css` (backdrop comment), `apps/web/test/palette.test.ts` (drop the atmosphere exclusion)
- Delete: `apps/web/src/components/atmosphere/Atmosphere.tsx`, `apps/web/src/components/atmosphere/atmosphere.module.css`, `apps/web/test/atmosphere.test.ts`, `apps/web/src/features/auth/SignalRiver.tsx`
- Test: `apps/web/test/forceLayout.test.ts`, `apps/web/test/swarm/model.test.ts`, `apps/web/test/swarm/bus.test.ts`, `apps/web/test/swarm/SwarmBackdrop.test.tsx`, `apps/web/test/weather.test.tsx`

**Interfaces:**
- Consumes: `GET /api/agents/graph` → `AgentGraph`, `GET /api/coins` (via `useCoins`), `GET /api/weather` → `WeatherView` (all public; `Regime`, `WeatherView`, `AgentGraph` from `@shillex/shared`); `useSocketEvent` (`lib/socket.ts`); socket event `'post:new'` (`{ postId, authorId }`); S1's tokens.
- Produces:
  - `forceLayout(nodes: { id: string; r: number }[], edges: { a: string; b: string; w: number }[], opts: { width: number; height: number; iterations?: number; seed?: number; temperature?: number; init?: Map<string, Pt> }): Map<string, Pt>` (`temperature` = the largest move per iteration at the start, default `k / 2`, falling linearly) and `type Pt = { x: number; y: number }`, `mulberry32(seed): () => number` — in `lib/forceLayout.ts` (Task 6.4 imports these; it does not create its own).
  - `swarm.emit(e: SwarmEvent)`, `swarm.on(fn): () => void`, `type SwarmEvent`, `targetsFor(model, e)` — `components/swarm/bus.ts`. `SwarmEvent` = `{ kind: 'buy' | 'sell' | 'launch' | 'rug'; agentId: string; mint: string | null } | { kind: 'transfer'; agentId: string; toId: string | null } | { kind: 'post'; agentId: string }`.
  - `buildSwarm(graph, coins, prev): SwarmModel` — `components/swarm/model.ts`.
  - `createRenderer(canvas, { reduced }): Renderer | null` — `components/swarm/renderer.ts`.
  - `<SwarmBackdrop />` (mounted once inside the query provider), `useSwarmPosts()` (mounted in the signed-in shell).
  - `useAgentGraph()` in `agentsApi.ts` (query `['agents', 'graph']`, refetch 60 s, `retry: false`).
  - `features/agents/weather.ts`: `useWeatherView(): WeatherView | null`, `useWeather(): Regime | null`, `WEATHER_LABEL: Record<Regime, string>` = `{ euphoria: 'Euphoria', grind: 'Grind', fear: 'Fear', chaos: 'Chaos hour' }`, `WEATHER_EFFECT: Record<Regime, string>`, `minutesLeft(endsAt: string, nowMs: number): number`.
  - `pulseAtmosphere`, `useAtmospherePulse`, `phaseAt` and `usePulseOnNew` no longer exist.

- [ ] **Step 1: Write the failing pure tests**

`apps/web/test/forceLayout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { forceLayout } from '../src/lib/forceLayout';

const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, r: 10 }));
const edges = [{ a: 'a', b: 'b', w: 0.9 }, { a: 'c', b: 'd', w: -0.9 }];
const dist = (m: Map<string, { x: number; y: number }>, p: string, q: string) => Math.hypot(m.get(p)!.x - m.get(q)!.x, m.get(p)!.y - m.get(q)!.y);

describe('forceLayout', () => {
  it('is deterministic for a seed', () => {
    const a = forceLayout(nodes, edges, { width: 800, height: 500, seed: 3 });
    const b = forceLayout(nodes, edges, { width: 800, height: 500, seed: 3 });
    expect([...a]).toEqual([...b]);
  });
  it('keeps every node inside the box', () => {
    const m = forceLayout(nodes, edges, { width: 800, height: 500, seed: 1 });
    for (const p of m.values()) { expect(p.x).toBeGreaterThanOrEqual(10); expect(p.x).toBeLessThanOrEqual(790); expect(p.y).toBeGreaterThanOrEqual(10); expect(p.y).toBeLessThanOrEqual(490); }
  });
  it('pulls allies closer than enemies', () => {
    const m = forceLayout(nodes, edges, { width: 800, height: 500, seed: 1 });
    expect(dist(m, 'a', 'b')).toBeLessThan(dist(m, 'c', 'd'));
  });
  it('starts from the given positions and moves them only a little in a few iterations', () => {
    const first = forceLayout(nodes, edges, { width: 800, height: 500, seed: 1 });
    const again = forceLayout(nodes, edges, { width: 800, height: 500, seed: 9, iterations: 20, temperature: 4, init: first });
    for (const n of nodes) expect(dist(new Map([['p', first.get(n.id)!], ['q', again.get(n.id)!]]), 'p', 'q')).toBeLessThan(60);
  });
});
```

`apps/web/test/swarm/model.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { AgentGraph, CoinView, GraphNode } from '@shillex/shared';
import { buildSwarm, GHOST, LONER, MAX_COINS, MAX_NODES } from '../../src/components/swarm/model';

const node = (id: string, o: Partial<GraphNode> = {}): GraphNode => ({ id, username: id, displayName: '', avatarUrl: null, netWorthSol: 0.1, mood: 0, ghost: false, reputation: 0, factionId: null, factionColour: null, ...o });
const coin = (mint: string, creatorId: string, o: Partial<CoinView> = {}): CoinView => ({
  mint, pool: 'p', name: mint, symbol: mint.toUpperCase(), description: '', emoji: '🪙',
  creator: { id: creatorId, username: creatorId, displayName: '', avatarUrl: '/a.svg', isDemo: false, isAgent: true, createdAt: '2026-10-12T00:00:00Z' },
  launchedAt: '2026-10-12T10:00:00Z', launchSignature: 's', priceSol: 1e-9, marketCapSol: 1, curveProgress: 0.03, holders: 3, volume24hSol: 0.1, devSoldPct: 0, graduated: false, ...o,
});
const graph = (nodes: GraphNode[], edges: AgentGraph['edges'] = []): AgentGraph => ({ nodes, edges, generatedAt: '2026-10-12T10:00:00Z' });

describe('buildSwarm', () => {
  it('normalises positions and maps faction, loner and ghost colours', () => {
    const m = buildSwarm(graph([node('a', { factionId: 'f', factionColour: '#3DDBD9' }), node('b'), node('c', { ghost: true })]), [], null);
    for (const n of m.nodes) { expect(n.x).toBeGreaterThanOrEqual(0); expect(n.x).toBeLessThanOrEqual(1); expect(n.y).toBeGreaterThanOrEqual(0); expect(n.y).toBeLessThanOrEqual(1); }
    const by = (id: string) => m.nodes[m.index.get(id)!]!;
    expect(by('a').colour).toBe('#3DDBD9');
    expect(by('b').colour).toBe(LONER);
    expect(by('c').colour).toBe(GHOST);
    expect(by('c').glow).toBeLessThan(by('b').glow);
  });
  it('sorts edges into allies and feuds and ignores weak dislike', () => {
    const m = buildSwarm(graph([node('a'), node('b'), node('c'), node('d')], [{ a: 'a', b: 'b', score: 0.5 }, { a: 'c', b: 'd', score: -0.6 }, { a: 'a', b: 'c', score: -0.3 }]), [], null);
    const allies = [...m.alliesByColour.values()].flat();
    expect(allies).toHaveLength(1);
    expect(m.feuds).toHaveLength(1);
  });
  it('anchors coins near their creator, marks rugged ones dead and caps the count', () => {
    const coins = [coin('m0', 'a', { devSoldPct: 85 }), ...Array.from({ length: 30 }, (_, i) => coin(`m${i + 1}`, 'a', { volume24hSol: i }))];
    const m = buildSwarm(graph([node('a'), node('b')]), coins, null);
    expect(m.coins).toHaveLength(MAX_COINS);
    expect(m.coins.some((c) => c.mint === 'm0')).toBe(false); // dead coins rank last, so the cap drops it first
    const a = m.nodes[m.index.get('a')!]!;
    for (const c of m.coins) expect(Math.hypot(c.x - a.x, c.y - a.y)).toBeLessThan(0.15);
    const dead = buildSwarm(graph([node('a')]), [coin('mx', 'a', { devSoldPct: 70 })], null);
    expect(dead.coins[0]!.dead).toBe(true);
  });
  it('keeps at most MAX_NODES agents, the richest first', () => {
    const many = Array.from({ length: MAX_NODES + 5 }, (_, i) => node(`n${i}`, { netWorthSol: i }));
    const m = buildSwarm(graph(many), [], null);
    expect(m.nodes).toHaveLength(MAX_NODES);
    expect(m.index.has('n0')).toBe(false);
  });
  it('moves agents only slightly when the graph is refetched', () => {
    const g = graph(Array.from({ length: 20 }, (_, i) => node(`n${i}`)), [{ a: 'n0', b: 'n1', score: 0.8 }]);
    const first = buildSwarm(g, [], null);
    const second = buildSwarm(g, [], first);
    for (const n of first.nodes) {
      const s = second.nodes[second.index.get(n.id)!]!;
      expect(Math.hypot(s.x - n.x, s.y - n.y)).toBeLessThan(0.05);
    }
  });
});
```

`apps/web/test/swarm/bus.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { AgentGraph } from '@shillex/shared';
import { swarm, targetsFor } from '../../src/components/swarm/bus';
import { buildSwarm } from '../../src/components/swarm/model';

describe('swarm bus', () => {
  it('delivers events, survives a throwing listener and unsubscribes', () => {
    const bad = swarm.on(() => { throw new Error('boom'); });
    const got = vi.fn();
    const off = swarm.on(got);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    swarm.emit({ kind: 'post', agentId: 'a' });
    off(); bad();
    swarm.emit({ kind: 'post', agentId: 'b' });
    expect(got).toHaveBeenCalledTimes(1);
  });
  it('resolves agents and coins it knows and leaves the rest null', () => {
    const g: AgentGraph = { nodes: ['a', 'b'].map((id) => ({ id, username: id, displayName: '', avatarUrl: null, netWorthSol: 0.1, mood: 0, ghost: false, reputation: 0, factionId: null, factionColour: null })), edges: [], generatedAt: '' };
    const m = buildSwarm(g, [], null);
    expect(targetsFor(m, { kind: 'buy', agentId: 'a', mint: 'unknown-mint' })).toEqual({ from: m.index.get('a'), toNode: null, coin: null });
    expect(targetsFor(m, { kind: 'post', agentId: 'human-1' })).toEqual({ from: null, toNode: null, coin: null });
    expect(targetsFor(m, { kind: 'transfer', agentId: 'a', toId: 'b' }).toNode).toBe(m.index.get('b'));
    expect(targetsFor(m, { kind: 'transfer', agentId: 'a', toId: 'human-2' }).toNode).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run (in `apps/web`): `npx vitest run test/forceLayout.test.ts test/swarm`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `forceLayout`, the bus and the model**

`apps/web/src/lib/forceLayout.ts`:

```ts
export type Pt = { x: number; y: number };

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A small spring-and-repulsion layout, deterministic for a seed and `init`. Allies (w > 0) are springs with rest length
 * 90 + (1 - w) * 140; every pair repels; enemies (w < 0) repel 1 + 2|w| times harder; a weak pull toward the centre
 * keeps loners on screen. Every node ends inside [r, width - r] × [r, height - r]. Moves per iteration are capped by a
 * temperature that falls linearly from `temperature` (default k / 2); a small one nudges an existing layout (`init`).
 */
export function forceLayout(
  nodes: { id: string; r: number }[],
  edges: { a: string; b: string; w: number }[],
  opts: { width: number; height: number; iterations?: number; seed?: number; temperature?: number; init?: Map<string, Pt> },
): Map<string, Pt> {
  const { width, height, iterations = 300, seed = 1, init } = opts;
  const rnd = mulberry32(seed);
  const n = nodes.length;
  const xs = new Float64Array(n), ys = new Float64Array(n), dx = new Float64Array(n), dy = new Float64Array(n);
  nodes.forEach((nd, i) => {
    const p = init?.get(nd.id);
    xs[i] = p ? p.x : nd.r + rnd() * Math.max(1, width - 2 * nd.r);
    ys[i] = p ? p.y : nd.r + rnd() * Math.max(1, height - 2 * nd.r);
  });
  const index = new Map(nodes.map((nd, i) => [nd.id, i]));
  const springs: [number, number, number][] = [];
  const boost = new Map<number, number>();
  for (const e of edges) {
    const i = index.get(e.a), j = index.get(e.b);
    if (i === undefined || j === undefined || i === j) continue;
    if (e.w > 0) springs.push([i, j, e.w]);
    else if (e.w < 0) boost.set(Math.min(i, j) * n + Math.max(i, j), 1 + 2 * Math.abs(e.w));
  }
  const k = Math.sqrt((width * height) / Math.max(1, n)), cx = width / 2, cy = height / 2;
  const start = opts.temperature ?? k / 2;
  for (let it = 0; it < iterations; it++) {
    const temp = Math.max(start * 0.02, start * (1 - it / iterations));
    dx.fill(0); dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = xs[i]! - xs[j]!, ey = ys[i]! - ys[j]!;
        if (ex * ex + ey * ey < 0.01) { ex = rnd() - 0.5; ey = rnd() - 0.5; }
        const d = Math.max(0.1, Math.hypot(ex, ey));
        const f = ((k * k) / d) * 0.6 * (boost.get(i * n + j) ?? 1);
        dx[i]! += (ex / d) * f; dy[i]! += (ey / d) * f; dx[j]! -= (ex / d) * f; dy[j]! -= (ey / d) * f;
      }
    }
    for (const [i, j, w] of springs) {
      const ex = xs[j]! - xs[i]!, ey = ys[j]! - ys[i]!, d = Math.max(0.1, Math.hypot(ex, ey));
      const f = (d - (90 + (1 - w) * 140)) * 2 * w;
      dx[i]! += (ex / d) * f; dy[i]! += (ey / d) * f; dx[j]! -= (ex / d) * f; dy[j]! -= (ey / d) * f;
    }
    for (let i = 0; i < n; i++) {
      dx[i]! += (cx - xs[i]!) * 0.02; dy[i]! += (cy - ys[i]!) * 0.02;
      const m = Math.hypot(dx[i]!, dy[i]!);
      if (m > 0) { const s = Math.min(m, temp) / m; xs[i]! += dx[i]! * s; ys[i]! += dy[i]! * s; }
      const r = nodes[i]!.r;
      xs[i] = Math.min(width - r, Math.max(r, xs[i]!)); ys[i] = Math.min(height - r, Math.max(r, ys[i]!));
    }
  }
  return new Map(nodes.map((nd, i) => [nd.id, { x: xs[i]!, y: ys[i]! }]));
}
```

(If the repo's `tsconfig` does not use `noUncheckedIndexedAccess`, drop the `!` on typed-array indexing; keep behaviour identical.)

`apps/web/src/components/swarm/bus.ts`:

```ts
import type { SwarmModel } from './model';

/** Something that happened in the agent world, as the backdrop draws it. Unknown agents and coins are ignored. */
export type SwarmEvent =
  | { kind: 'buy' | 'sell' | 'launch' | 'rug'; agentId: string; mint: string | null }
  | { kind: 'transfer'; agentId: string; toId: string | null }
  | { kind: 'post'; agentId: string };

const listeners = new Set<(e: SwarmEvent) => void>();

/** Module-level, so the signed-in shell, the public shell and tests can push events without React wiring. */
export const swarm = {
  emit(e: SwarmEvent) {
    for (const l of listeners) { try { l(e); } catch (err) { console.error('[swarm] listener failed', err); } }
  },
  on(fn: (e: SwarmEvent) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; },
};

/** Node and coin indices an event touches in the current model; null for anything the model does not hold. */
export function targetsFor(m: SwarmModel, e: SwarmEvent): { from: number | null; toNode: number | null; coin: number | null } {
  const from = m.index.get(e.agentId) ?? null;
  const toNode = e.kind === 'transfer' && e.toId ? m.index.get(e.toId) ?? null : null;
  const coin = 'mint' in e && e.mint ? m.coinIndex.get(e.mint) ?? null : null;
  return { from, toNode, coin };
}
```

`apps/web/src/components/swarm/model.ts`:

```ts
import type { AgentGraph, CoinView } from '@shillex/shared';
import { forceLayout, type Pt } from '../../lib/forceLayout';

export const MAX_NODES = 60, MAX_COINS = 24, FEUD_AT = -0.4, MAX_ALLY_LINES = 160;
export const LONER = '#FFC98A', GHOST = '#6B7085';
/** The layout runs on a 16:10 virtual canvas; positions are stored normalised to 0..1. */
const VW = 1000, VH = 625;

export interface SwarmNode { id: string; x: number; y: number; r: number; colour: string; glow: number; ghost: boolean; phase: number }
export interface SwarmCoin { mint: string; symbol: string; creatorId: string; x: number; y: number; dead: boolean }
export interface SwarmModel {
  nodes: SwarmNode[]; index: Map<string, number>;
  alliesByColour: Map<string, [number, number][]>; feuds: [number, number][];
  coins: SwarmCoin[]; coinIndex: Map<string, number>;
}

function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** The world as the backdrop draws it. `prev` seeds the layout so a refetch nudges agents instead of reshuffling them. */
export function buildSwarm(graph: AgentGraph, coins: CoinView[], prev: SwarmModel | null): SwarmModel {
  const picked = [...graph.nodes].sort((a, b) => b.netWorthSol - a.netWorthSol || a.id.localeCompare(b.id)).slice(0, MAX_NODES);
  const ids = new Set(picked.map((n) => n.id));
  const edges = graph.edges.filter((e) => ids.has(e.a) && ids.has(e.b));
  const init = prev ? new Map<string, Pt>([...prev.index].map(([id, i]) => [id, { x: prev.nodes[i]!.x * VW, y: prev.nodes[i]!.y * VH }])) : undefined;
  const layout = forceLayout(picked.map((n) => ({ id: n.id, r: 12 })), edges.map((e) => ({ a: e.a, b: e.b, w: e.score })),
    // A refetch nudges: at most ~24 virtual px in total, so agents drift instead of jumping.
    { width: VW, height: VH, seed: 7, iterations: prev ? 24 : 300, temperature: prev ? 2 : undefined, init });
  const maxWorth = Math.max(1e-9, ...picked.map((n) => n.netWorthSol));
  const nodes: SwarmNode[] = picked.map((n) => {
    const p = layout.get(n.id)!;
    return {
      id: n.id, x: p.x / VW, y: p.y / VH,
      r: 1.4 + 3.2 * Math.sqrt(Math.max(0, n.netWorthSol) / maxWorth),
      colour: n.ghost ? GHOST : n.factionColour ?? LONER,
      glow: n.ghost ? 0.25 : 0.45 + 0.35 * ((clamp(n.mood, -1, 1) + 1) / 2),
      ghost: n.ghost, phase: (hash(n.id) % 6283) / 1000,
    };
  });
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const alliesByColour = new Map<string, [number, number][]>();
  const feuds: [number, number][] = [];
  let allyLines = 0;
  for (const e of [...edges].sort((x, y) => Math.abs(y.score) - Math.abs(x.score))) {
    const a = index.get(e.a)!, b = index.get(e.b)!;
    if (e.score <= FEUD_AT) feuds.push([a, b]);
    else if (e.score > 0 && allyLines < MAX_ALLY_LINES) {
      const colour = nodes[a]!.colour;
      alliesByColour.set(colour, [...(alliesByColour.get(colour) ?? []), [a, b]]);
      allyLines++;
    }
  }
  const ranked = [...coins]
    .sort((a, b) => Number(a.devSoldPct >= 70) - Number(b.devSoldPct >= 70) || b.volume24hSol - a.volume24hSol || b.launchedAt.localeCompare(a.launchedAt))
    .slice(0, MAX_COINS);
  const out: SwarmCoin[] = ranked.map((c) => {
    const old = prev?.coinIndex.has(c.mint) ? prev.coins[prev.coinIndex.get(c.mint)!] : undefined;
    let x: number, y: number;
    if (old) ({ x, y } = old);
    else {
      const h = hash(c.mint), ang = (h % 6283) / 1000, dist = 0.035 + ((h >>> 12) % 25) / 1000;
      const owner = index.get(c.creator.id);
      const ox = owner !== undefined ? nodes[owner]!.x : ((h >>> 4) % 1000) / 1000;
      const oy = owner !== undefined ? nodes[owner]!.y : ((h >>> 14) % 1000) / 1000;
      x = clamp(ox + Math.cos(ang) * dist, 0.03, 0.97); y = clamp(oy + Math.sin(ang) * dist * 1.6, 0.04, 0.96);
    }
    return { mint: c.mint, symbol: c.symbol, creatorId: c.creator.id, x, y, dead: c.devSoldPct >= 70 };
  });
  return { nodes, index, alliesByColour, feuds, coins: out, coinIndex: new Map(out.map((c, i) => [c.mint, i])) };
}
```

- [ ] **Step 4: Run the pure tests**

Run: `npx vitest run test/forceLayout.test.ts test/swarm`
Expected: PASS. If "pulls allies closer than enemies" or the stability test fails, tune only the force constants (repulsion 0.6, spring 2, gravity 0.02), not the tests; factions must still read as clusters in S2's visual check.

- [ ] **Step 5: Write the failing weather and backdrop tests**

`apps/web/test/weather.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { WEATHER_LABEL, minutesLeft, useWeather } from '../src/features/agents/weather';

function Probe() { const r = useWeather(); return <p>{r ? WEATHER_LABEL[r] : 'none'}</p>; }

describe('weather', () => {
  it('reads the current regime', async () => {
    mockFetch({ '/api/weather': { regime: 'fear', startedAt: '2026-10-12T10:00:00Z', endsAt: '2026-10-12T12:00:00Z' } });
    renderWithApp(<Probe />);
    expect(await screen.findByText('Fear')).toBeInTheDocument();
  });
  it('is null without an agent world', async () => {
    mockFetch({});
    renderWithApp(<Probe />);
    expect(await screen.findByText('none')).toBeInTheDocument();
  });
  it('counts whole minutes left and never goes negative', () => {
    expect(minutesLeft('2026-10-12T12:00:00Z', Date.parse('2026-10-12T11:45:20Z'))).toBe(15);
    expect(minutesLeft('2026-10-12T12:00:00Z', Date.parse('2026-10-12T12:05:00Z'))).toBe(0);
  });
});
```

`apps/web/test/swarm/SwarmBackdrop.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderWithApp, mockFetch } from '../utils';
import { SwarmBackdrop } from '../../src/components/swarm/SwarmBackdrop';
import { swarm } from '../../src/components/swarm/bus';

describe('SwarmBackdrop', () => {
  it('renders an inert decorative canvas when the browser has no 2D canvas and there is no agent world', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    mockFetch({});
    const { container } = renderWithApp(<SwarmBackdrop />);
    const canvas = container.querySelector('canvas')!;
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
    expect(() => swarm.emit({ kind: 'rug', agentId: 'a', mint: 'm' })).not.toThrow();
  });
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `npx vitest run test/weather.test.tsx test/swarm/SwarmBackdrop.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 7: Implement weather, the renderer, the component and the post hook**

`apps/web/src/features/agents/weather.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import type { Regime, WeatherView } from '@shillex/shared';
import { get } from '../../lib/api';

export const WEATHER_LABEL: Record<Regime, string> = { euphoria: 'Euphoria', grind: 'Grind', fear: 'Fear', chaos: 'Chaos hour' };
/** What each regime does to the agents (server: agents/depth/weather.ts — risk, chattiness and mood multipliers). */
export const WEATHER_EFFECT: Record<Regime, string> = {
  euphoria: 'Bigger bets, louder posts, better moods',
  grind: 'Ordinary trading',
  fear: 'Smaller bets, darker moods',
  chaos: 'Huge bets and everyone talking',
};

/** The current market weather; null while loading, on error, or without an agent world. */
export function useWeatherView(): WeatherView | null {
  const q = useQuery({ queryKey: ['weather'], queryFn: () => get<WeatherView>('/weather'), refetchInterval: 5 * 60_000, staleTime: 60_000, retry: false });
  return q.data ?? null;
}
export const useWeather = (): Regime | null => useWeatherView()?.regime ?? null;
export const minutesLeft = (endsAt: string, nowMs: number) => Math.max(0, Math.round((Date.parse(endsAt) - nowMs) / 60_000));
```

`apps/web/src/features/agents/agentsApi.ts` — delete `usePulseOnNew` (and the `useEffect`, `useRef` and `pulseAtmosphere` imports it used), add `AgentGraph` to the shared type import, and add:

```ts
/** The agent graph (public). Feeds the backdrop and the Graph page; 404 without an agent world. */
export const useAgentGraph = () => useQuery({ queryKey: ['agents', 'graph'], queryFn: () => get<AgentGraph>('/agents/graph'), refetchInterval: 60_000, refetchIntervalInBackground: false, staleTime: 30_000, retry: false });
```

Remove the `usePulseOnNew(...)` lines and imports from `BackchannelPage.tsx` and `TradeTape.tsx` (real pulses now come from the socket). In `Composer.tsx` remove the `pulseAtmosphere` import and the `if (!communityId) pulseAtmosphere('accent');` line with its comment.

`apps/web/src/components/swarm/renderer.ts`:

```ts
import type { Regime } from '@shillex/shared';
import { mulberry32 } from '../../lib/forceLayout';
import type { SwarmModel } from './model';
import { targetsFor, type SwarmEvent } from './bus';

type RGBA = [number, number, number, number];
interface Sky { top: RGBA; low: RGBA; a1: RGBA; a2: RGBA; a3: RGBA; speed: number; jitter: number }

/** Sky per market regime; `none` is the sky without an agent world or before the weather loads. */
export const SKIES: Record<Regime | 'none', Sky> = {
  none: { top: [7, 8, 13, 1], low: [14, 14, 24, 1], a1: [255, 184, 107, 0.08], a2: [125, 227, 255, 0.06], a3: [182, 156, 255, 0.06], speed: 0.6, jitter: 0 },
  euphoria: { top: [10, 9, 16, 1], low: [30, 20, 10, 1], a1: [255, 184, 107, 0.2], a2: [75, 240, 160, 0.13], a3: [255, 150, 80, 0.16], speed: 1.4, jitter: 0 },
  grind: { top: [7, 8, 11, 1], low: [16, 18, 24, 1], a1: [150, 160, 185, 0.07], a2: [120, 130, 150, 0.06], a3: [120, 130, 150, 0.07], speed: 0.45, jitter: 0 },
  fear: { top: [8, 6, 10, 1], low: [34, 7, 15, 1], a1: [255, 70, 95, 0.15], a2: [130, 40, 90, 0.13], a3: [255, 60, 80, 0.16], speed: 0.8, jitter: 0.5 },
  chaos: { top: [6, 6, 14, 1], low: [20, 10, 38, 1], a1: [170, 120, 255, 0.2], a2: [70, 230, 255, 0.15], a3: [255, 80, 200, 0.12], speed: 2.2, jitter: 2.4 },
};
const FADE_S = 3, FRAME_MS = 32, STILL_T = 12;
const UP = '#4BF0A0', DOWN = '#FF5A6E', AMBER = '#FFB86B', CYAN = '#7DE3FF', WHITE = '#E8ECFF', COIN = '#FFE3B0';

const rgba = (c: RGBA) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${c[3]})`;
const mix = (a: RGBA, b: RGBA, k: number): RGBA => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
const mixSky = (a: Sky, b: Sky, k: number): Sky => ({ top: mix(a.top, b.top, k), low: mix(a.low, b.low, k), a1: mix(a.a1, b.a1, k), a2: mix(a.a2, b.a2, k), a3: mix(a.a3, b.a3, k), speed: a.speed + (b.speed - a.speed) * k, jitter: a.jitter + (b.jitter - a.jitter) * k });
const hexA = (hex: string, a: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

type At = { node: number } | { coin: number };
interface Streak { from: number; to: At; t0: number; dur: number; col: string; hit: boolean }
interface Ring { at: At; r0: number; r1: number; t0: number; dur: number; col: string; w: number }

export interface Renderer {
  resize(w: number, h: number, dpr: number): void;
  setModel(m: SwarmModel | null): void;
  setRegime(r: Regime | null): void;
  event(e: SwarmEvent): void;
  start(): void;
  stop(): void;
  destroy(): void;
  /** Average draw time in ms over the last 60 frames (dev performance check). */
  stats(): { drawMs: number };
}

/** The Swarm backdrop on a 2D canvas. Returns null when the browser gives no 2D context. */
export function createRenderer(canvas: HTMLCanvasElement, opts: { reduced: boolean }): Renderer | null {
  const c = canvas.getContext('2d');
  if (!c) return null;
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  const rnd = mulberry32(11);
  const stars = Array.from({ length: 140 }, () => ({ x: rnd(), y: rnd(), a: 0.15 + rnd() * 0.5, ph: rnd() * 6.28 }));
  const glowCache = new Map<string, HTMLCanvasElement>();
  const deadNow = new Set<string>();
  let W = 0, H = 0, raf = 0, last = 0, running = false, drawAvg = 0;
  let model: SwarmModel | null = null;
  let px = new Float32Array(0), py = new Float32Array(0), hot = new Float32Array(0), pulse = new Float32Array(0);
  let streaks: Streak[] = [], rings: Ring[] = [];
  let from: Sky = SKIES.none, to: Sky = SKIES.none, fadeAt = -FADE_S;

  function glow(col: string) {
    let g = glowCache.get(col);
    if (g) return g;
    g = document.createElement('canvas'); g.width = g.height = 64;
    const x = g.getContext('2d');
    if (x) {
      const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, col); grad.addColorStop(0.16, col); grad.addColorStop(0.34, hexA(col, 0.32)); grad.addColorStop(1, hexA(col, 0));
      x.fillStyle = grad; x.fillRect(0, 0, 64, 64);
    }
    glowCache.set(col, g);
    return g;
  }
  function blob(x: number, y: number, r: number, col: RGBA) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(col)); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  const mx = () => W * 0.04, my = () => H * 0.07;
  const coinX = (i: number) => mx() + model!.coins[i]!.x * (W - 2 * mx());
  const coinY = (i: number) => my() + model!.coins[i]!.y * (H - 2 * my());
  const atX = (a: At) => ('node' in a ? px[a.node]! : coinX(a.coin));
  const atY = (a: At) => ('node' in a ? py[a.node]! : coinY(a.coin));
  const skyAt = (t: number) => { const k = Math.min(1, (t - fadeAt) / FADE_S); return k >= 1 ? to : mixSky(from, to, k); };

  function frame(t: number, dt: number) {
    const begin = performance.now();
    const sky = skyAt(t), sp = sky.speed, big = Math.max(W, H);
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgba(sky.top)); g.addColorStop(1, rgba(sky.low));
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    blob(W * (0.26 + 0.12 * Math.sin(t * 0.05 * sp)), H * 0.2, big * 0.5, sky.a1);
    blob(W * (0.78 + 0.1 * Math.cos(t * 0.04 * sp)), H * 0.66, big * 0.45, sky.a2);
    blob(W * 0.5, H * 1.05, big * 0.55, sky.a3);
    c.fillStyle = '#fff';
    for (const s of stars) { c.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(t * 0.8 + s.ph)); c.fillRect(s.x * W, s.y * H, 1, 1); }
    c.globalAlpha = 1;
    // A dark band behind the reading column keeps text legible over the brightest parts of the swarm.
    const band = c.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, Math.max(380, W * 0.34));
    band.addColorStop(0, 'rgba(4,5,9,0.55)'); band.addColorStop(1, 'rgba(4,5,9,0)');
    c.fillStyle = band; c.fillRect(0, 0, W, H);
    if (model) {
      const m = model, j = opts.reduced ? 0 : sky.jitter, x0 = mx(), y0 = my();
      m.nodes.forEach((n, i) => {
        px[i] = x0 + n.x * (W - 2 * x0) + Math.sin(t * 0.35 * sp + n.phase) * 9 + (j ? (Math.random() - 0.5) * j : 0);
        py[i] = y0 + n.y * (H - 2 * y0) + Math.cos(t * 0.28 * sp + n.phase * 1.3) * 7 + (j ? (Math.random() - 0.5) * j : 0);
        hot[i] = hot[i]! - Math.sign(hot[i]!) * Math.min(Math.abs(hot[i]!), dt * 0.7);
      });
      c.lineWidth = 1;
      for (const [colour, pairs] of m.alliesByColour) {
        c.strokeStyle = hexA(colour, 0.16); c.beginPath();
        for (const [a, b] of pairs) { c.moveTo(px[a]!, py[a]!); c.lineTo(px[b]!, py[b]!); }
        c.stroke();
      }
      c.setLineDash([3, 6]); c.strokeStyle = 'rgba(255,90,110,0.38)'; c.beginPath();
      for (const [a, b] of m.feuds) { c.moveTo(px[a]!, py[a]!); c.lineTo(px[b]!, py[b]!); }
      c.stroke(); c.setLineDash([]);
      c.font = "500 10px 'Geist Mono Variable', ui-monospace, monospace"; c.textBaseline = 'middle'; c.textAlign = 'left';
      m.coins.forEach((coin, i) => {
        const x = coinX(i), y = coinY(i), dead = coin.dead || deadNow.has(coin.mint), col = dead ? DOWN : COIN;
        if (pulse[i]! > 0) { const s = 36 + pulse[i]! * 34; c.drawImage(glow(dead ? DOWN : AMBER), x - s / 2, y - s / 2, s, s); pulse[i] = Math.max(0, pulse[i]! - dt * 1.4); }
        c.save(); c.translate(x, y); c.rotate(Math.PI / 4); c.globalAlpha = dead ? 0.45 : 0.95; c.fillStyle = col; c.fillRect(-3.5, -3.5, 7, 7); c.restore();
        c.globalAlpha = dead ? 0.4 : 0.7; c.fillStyle = col; c.fillText(`$${coin.symbol}${dead ? ' ✕' : ''}`, x + 9, y); c.globalAlpha = 1;
      });
      m.nodes.forEach((n, i) => {
        const h = hot[i]!, heat = Math.abs(h), col = h < -0.05 ? DOWN : n.colour, size = n.r * (7 + heat * 7);
        c.globalAlpha = Math.min(1, Math.max(0, n.glow + heat * 0.5 + 0.12 * Math.sin(t * 1.3 + n.phase)));
        c.drawImage(glow(col), px[i]! - size / 2, py[i]! - size / 2, size, size);
      });
      c.globalAlpha = 1;
      streaks = streaks.filter((s) => t - s.t0 < s.dur);
      for (const s of streaks) {
        const k = (t - s.t0) / s.dur, ax = px[s.from]!, ay = py[s.from]!, bx = atX(s.to), by = atY(s.to);
        const cx = (ax + bx) / 2 + (by - ay) * 0.18, cy = (ay + by) / 2 - (bx - ax) * 0.18;
        const at = (u: number) => { const iu = 1 - u; return [iu * iu * ax + 2 * iu * u * cx + u * u * bx, iu * iu * ay + 2 * iu * u * cy + u * u * by] as const; };
        const [x, y] = at(k), [tx, ty] = at(Math.max(0, k - 0.16));
        c.strokeStyle = hexA(s.col, 0.55); c.lineWidth = 1.5; c.beginPath(); c.moveTo(tx, ty); c.lineTo(x, y); c.stroke();
        c.drawImage(glow(s.col), x - 8, y - 8, 16, 16);
        if (k > 0.92 && !s.hit) { s.hit = true; if ('coin' in s.to) pulse[s.to.coin] = 1; else hot[s.to.node] = 0.6; }
      }
      rings = rings.filter((r) => t - r.t0 < r.dur);
      for (const r of rings) {
        const k = (t - r.t0) / r.dur;
        if (k < 0) continue;
        c.strokeStyle = hexA(r.col, (1 - k) * 0.8); c.lineWidth = r.w * (1 - k) + 0.5;
        c.beginPath(); c.arc(atX(r.at), atY(r.at), r.r0 + (r.r1 - r.r0) * (1 - (1 - k) ** 3), 0, Math.PI * 2); c.stroke();
      }
    }
    drawAvg = drawAvg * 0.95 + (performance.now() - begin) * 0.05;
  }

  function loop(ts: number) {
    raf = requestAnimationFrame(loop);
    if (ts - last < FRAME_MS) return;
    const dt = last ? Math.min(0.1, (ts - last) / 1000) : 1 / 30;
    last = ts;
    frame(now(), dt);
  }
  const still = () => { if (W && H) frame(STILL_T, 0); };

  function nearest(x: number, y: number, k: number): number[] {
    return model!.nodes.map((_, i) => [i, Math.hypot(px[i]! - x, py[i]! - y)] as const).sort((a, b) => a[1] - b[1]).slice(0, k).map(([i]) => i);
  }

  return {
    resize(w, h, dpr) {
      W = w; H = h;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (opts.reduced || !running) still();
    },
    setModel(m) {
      const old = model;
      model = m;
      const n = m?.nodes.length ?? 0, nc = m?.coins.length ?? 0;
      const oldHot = hot;
      px = new Float32Array(n); py = new Float32Array(n); hot = new Float32Array(n); pulse = new Float32Array(nc);
      if (old && m) for (const [id, i] of m.index) { const o = old.index.get(id); if (o !== undefined) hot[i] = oldHot[o] ?? 0; }
      streaks = []; rings = [];
      if (opts.reduced || !running) still();
    },
    setRegime(r) {
      const target = SKIES[r ?? 'none'];
      if (target === to) return;
      const t = opts.reduced ? STILL_T : now();
      from = opts.reduced ? target : skyAt(t); to = target; fadeAt = opts.reduced ? -FADE_S : t;
      if (opts.reduced || !running) still();
    },
    event(e) {
      if (!model) return;
      const tg = targetsFor(model, e);
      if (e.kind === 'rug' && tg.coin !== null) deadNow.add(model.coins[tg.coin]!.mint);
      if (opts.reduced) { still(); return; }
      const t = now();
      const ring = (at: At, r1: number, col: string, w: number, dur: number, r0 = 4, delay = 0) => rings.push({ at, r0, r1, t0: t + delay, dur, col, w });
      if (tg.from !== null) hot[tg.from] = e.kind === 'transfer' ? 0.6 : e.kind === 'buy' || e.kind === 'sell' ? 0.8 : 1;
      switch (e.kind) {
        case 'buy': case 'sell':
          if (tg.from !== null && tg.coin !== null) streaks.push({ from: tg.from, to: { coin: tg.coin }, t0: t, dur: 1.1, col: e.kind === 'buy' ? UP : DOWN, hit: false });
          break;
        case 'transfer':
          if (tg.from !== null && tg.toNode !== null) streaks.push({ from: tg.from, to: { node: tg.toNode }, t0: t, dur: 1.3, col: WHITE, hit: false });
          break;
        case 'post':
          if (tg.from !== null) ring({ node: tg.from }, 34, CYAN, 1.5, 1.2);
          break;
        case 'launch':
          if (tg.coin !== null) { pulse[tg.coin] = 1; ring({ coin: tg.coin }, 90, AMBER, 3, 1.8, 6); }
          else if (tg.from !== null) ring({ node: tg.from }, 90, AMBER, 3, 1.8, 6);
          break;
        case 'rug': {
          const at: At | null = tg.coin !== null ? { coin: tg.coin } : tg.from !== null ? { node: tg.from } : null;
          if (!at) break;
          if (tg.coin !== null) pulse[tg.coin] = 1;
          const big = Math.max(W, H);
          ring(at, big * 0.6, DOWN, 6, 2.2, 10);
          ring(at, big * 0.35, AMBER, 3, 1.8, 4, 0.25);
          for (const i of nearest(atX(at), atY(at), 10)) hot[i] = -1;
          break;
        }
      }
    },
    start() { if (running || opts.reduced) return; running = true; last = 0; raf = requestAnimationFrame(loop); },
    stop() { running = false; cancelAnimationFrame(raf); },
    destroy() { running = false; cancelAnimationFrame(raf); model = null; },
    stats: () => ({ drawMs: Math.round(drawAvg * 100) / 100 }),
  };
}
```

`apps/web/src/components/swarm/swarm.module.css`:

```css
/* The backdrop sits behind everything and never takes the pointer. */
.canvas { position: fixed; inset: 0; z-index: -1; display: block; width: 100vw; height: 100vh; pointer-events: none; }
```

`apps/web/src/components/swarm/SwarmBackdrop.tsx`:

```tsx
import { useEffect, useMemo, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import type { Regime } from '@shillex/shared';
import { useAgentGraph, useCoins } from '../../features/agents/agentsApi';
import { useWeather } from '../../features/agents/weather';
import { buildSwarm, type SwarmModel } from './model';
import { createRenderer, type Renderer } from './renderer';
import { swarm } from './bus';
import s from './swarm.module.css';

/**
 * The fixed backdrop behind every screen: the live agent world (agents as lights clustered by faction, ally and feud
 * lines, coins as diamonds) under a sky coloured by the market weather. Events from `swarm.emit` animate it. Without an
 * agent world it is sky and stars only. Decorative: aria-hidden, paused while the tab is hidden, still under reduced motion.
 */
export function SwarmBackdrop() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<Renderer | null>(null);
  const reduced = useReducedMotion() ?? false;
  const graph = useAgentGraph();
  const coins = useCoins();
  const regime = useWeather();
  const prev = useRef<SwarmModel | null>(null);
  const model = useMemo(() => {
    if (!graph.data) return null;
    const m = buildSwarm(graph.data, coins.data ?? [], prev.current);
    prev.current = m;
    return m;
  }, [graph.data, coins.data]);
  const latest = useRef<{ model: SwarmModel | null; regime: Regime | null }>({ model, regime });
  latest.current = { model, regime };

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const r = createRenderer(el, { reduced });
    renderer.current = r;
    if (!r) return;
    const size = () => r.resize(window.innerWidth, window.innerHeight, Math.min(2, window.devicePixelRatio || 1));
    size();
    r.setModel(latest.current.model);
    r.setRegime(latest.current.regime);
    const off = swarm.on((e) => r.event(e));
    const vis = () => (document.hidden ? r.stop() : r.start());
    window.addEventListener('resize', size);
    document.addEventListener('visibilitychange', vis);
    if (!document.hidden) r.start();
    if (import.meta.env.DEV) (window as unknown as { __swarmStats?: () => { drawMs: number } }).__swarmStats = () => r.stats();
    return () => { off(); window.removeEventListener('resize', size); document.removeEventListener('visibilitychange', vis); r.destroy(); renderer.current = null; };
  }, [reduced]);
  useEffect(() => { renderer.current?.setModel(model); }, [model]);
  useEffect(() => { renderer.current?.setRegime(regime); }, [regime]);

  return <canvas ref={canvas} className={s.canvas} aria-hidden="true" />;
}
```

`apps/web/src/components/swarm/hooks.ts`:

```ts
import { useSocketEvent } from '../../lib/socket';
import { swarm } from './bus';

/** Signed-in shell only (the socket needs a session): a new post ripples on its author if the author is an agent. */
export function useSwarmPosts() {
  useSocketEvent('post:new', (p) => swarm.emit({ kind: 'post', agentId: p.authorId }));
}
```

- [ ] **Step 8: Swap the backdrop in and remove the old one**

`apps/web/src/App.tsx`:

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import { MotionConfig } from 'motion/react';
import { queryClient } from './lib/queryClient';
import { router } from './routes';
import { SwarmBackdrop } from './components/swarm/SwarmBackdrop';

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <SwarmBackdrop />
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MotionConfig>
  );
}
```

`apps/web/src/layout/AppShell.tsx`: replace `import { useAtmospherePulse } from '../components/atmosphere/Atmosphere';` with `import { useSwarmPosts } from '../components/swarm/hooks';` and `useAtmospherePulse();` with `useSwarmPosts();`.

Login and signup: remove `<SignalRiver />` and its import from `LoginPage.tsx` and `SignupPage.tsx`; in `auth.module.css` delete the "Signal river" block (`.river` through `.riverLine::before`) and the `.riverCol` part of the 480 px media query; change the card's glow to `box-shadow: var(--shadow-pop), 0 0 120px rgba(255, 184, 107, 0.1);`.

Delete `components/atmosphere/` (both files), `features/auth/SignalRiver.tsx` and `test/atmosphere.test.ts`. Remove `--sky-top` and `--sky-low` (and their comment) from `tokens.css`. In `base.css` change the comment to `/* The backdrop is <SwarmBackdrop/> (components/swarm), mounted once at the app root. */`. In `test/palette.test.ts` remove the atmosphere exclusion (`if (f !== 'atmosphere')` becomes a plain recursive `walk(p, out)`) and its comment.

Confirm nothing still imports the removed names: `grep -rn "atmosphere\|Atmosphere\|SignalRiver\|usePulseOnNew" apps/web/src apps/web/test` prints nothing.

- [ ] **Step 9: Run the tests**

Run (in `apps/web`): `npx vitest run` — all pass. From the repo root: `npm run typecheck` — exits 0.

- [ ] **Step 10: Visual and performance check**

With the dev servers running (agents on, memory chain): pages `/login`, `/` and `/agents`. Wait 20 s on `/` so trades and launches happen, then:
- Screenshots at the three widths: the agents are visible as clustered lights around the content, coins as labelled diamonds, the sky is not a flat gradient, and text in cards is readable (the reading band darkens the centre).
- `browser_evaluate` with `() => window.__swarmStats?.()` — `drawMs` ≤ 6 at 1440×900.
- `browser_evaluate` with `() => document.documentElement.scrollWidth - window.innerWidth` — `0` at each width.
- `browser_emulate_media` with `reducedMotion: 'reduce'`, reload `/`: one still frame (two screenshots 3 s apart are identical in the backdrop).
- Change the regime to see the sky change: from `apps/server`, there is no route for it; instead confirm visually that the current regime from `curl localhost:3010/api/weather` matches the sky (euphoria = warm amber/green, grind = grey, fear = red, chaos = violet/cyan).

- [ ] **Step 11: Commit**

```bash
git add -A apps/web
git commit -m "feat(web): The Swarm backdrop — the live agent world behind every screen: factions, feuds, coins, trade streaks, launch rings, rug shockwaves and a weather-coloured sky

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task S3: The shell

A glass top bar (wordmark, live count, the live ticker, weather, search, notifications, account), a slim icon rail, the reading column, and the World now panel; phones get a compact top bar with the ticker strip and a bottom tab bar. Home opens on everyone's posts.

**Files:**
- Create: `apps/web/src/layout/navData.ts`, `apps/web/src/layout/TopBar.tsx`, `apps/web/src/layout/IconRail.tsx`, `apps/web/src/layout/WorldPanel.tsx`, `apps/web/src/layout/shell.module.css`
- Modify: `apps/web/src/layout/AppShell.tsx`, `apps/web/src/layout/MobileTabBar.tsx`, `apps/web/src/layout/layout.module.css` (remove the old shell, nav, mobile header and demo note rules), `apps/web/src/features/messages/ConversationList.tsx` and `apps/web/src/features/tokens/TokenPanel.tsx` (import `useConversations` from `layout/navData`), `apps/web/src/features/feed/HomePage.tsx`, `apps/web/src/features/feed/Composer.tsx` (prepend to both feeds), `apps/web/src/features/feed/Composer.module.css` (collapsed bar), `apps/web/src/features/auth/LoginPage.tsx` (copy; demo button only without an agent world), `apps/web/src/styles/tokens.css` (drop `--left-w`, `--column*`, `--mobile-header-h`)
- Delete: `apps/web/src/layout/LeftNav.tsx`, `apps/web/src/layout/MobileHeader.tsx`, `apps/web/src/layout/DemoWorldNote.tsx`, `apps/web/test/LeftNav.test.tsx`
- Test: `apps/web/test/TopBar.test.tsx`, `apps/web/test/IconRail.test.tsx`, `apps/web/test/WorldPanel.test.tsx`, `apps/web/test/HomePage.test.tsx`

**Interfaces:**
- Consumes: `LiveTicker({ names, symbols, compact })` and `useAgentPulses()` (Task 6.1, `features/agents/LiveTicker.tsx`, `features/agents/pulses.ts`); `useOverview()` → `AgentsOverview` (Task 6.2, `agentsApi.ts`); `WeatherChip` (Task 6.5, `features/agents/WeatherChip.tsx`) and `usePaper(day?)` → `PaperView | null` (Task 6.5, `agentsApi.ts`); `useAgentGraph`, `useWeatherView`, `WEATHER_LABEL`, `WEATHER_EFFECT`, `minutesLeft`, `useSwarmPosts` (S2); `useAgentsInfo`, `useCoins` (`agentsApi.ts`); `RightRail` (classic rail); `Menu`, `Avatar`, `NavBadge`, `Wordmark`, `openPalette`, `mentionDots` (`layout/unreadStore.ts`), `useStore` (`lib/store.ts`).
- Produces (Task 6.7 builds the public shell from these):
  - `TopBar({ me }: { me: MeView | null })`, `IconRail({ me }: { me: MeView | null })`, `railItems(opts: { dm: number; mentions: boolean }): RailItem[]` with `RailItem = { to; label; icon; end?; badge?; dot?; authed? }`, `WorldPanel()`, `MobileTabBar({ me }: { me: MeView | null })`.
  - `shell.module.css` classes `shell`, `railCol`, `stage`, `center`, `side` (the grid every shell uses).
  - `useConversations(enabled?)`, `useJoinedCommunities(enabled?)` in `layout/navData.ts`.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/TopBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch, me } from './utils';

vi.mock('../src/features/agents/LiveTicker', () => ({ LiveTicker: () => <p>ticker</p> }));
vi.mock('../src/features/agents/WeatherChip', () => ({ WeatherChip: () => <span>Fear</span> }));
import { TopBar } from '../src/layout/TopBar';

const node = (id: string, ghost = false) => ({ id, username: id, displayName: '', avatarUrl: null, netWorthSol: 0.1, mood: 0, ghost, reputation: 0, factionId: null, factionColour: null });
const world = {
  '/api/agents/info': { network: 'memory', agents: 3, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 },
  '/api/agents/graph': { nodes: [node('a'), node('b'), node('c', true)], edges: [], generatedAt: '' },
  '/api/coins': { coins: [] },
};

describe('TopBar', () => {
  it('shows the live agent count, the ticker, weather and the signed-in actions', async () => {
    mockFetch(world);
    renderWithApp(<TopBar me={me} />);
    expect(await screen.findByText('2 agents live')).toBeInTheDocument();
    expect(screen.getByText('ticker')).toBeInTheDocument();
    expect(screen.getByText('Fear')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Notifications, 3 unread/ })).toHaveAttribute('href', '/notifications');
    expect(screen.getByRole('button', { name: /Account/ })).toBeInTheDocument();
  });
  it('offers log in and sign up to a signed-out viewer', async () => {
    mockFetch(world);
    renderWithApp(<TopBar me={null} />);
    expect(await screen.findByText('2 agents live')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/signup');
  });
  it('says demo world when there is no agent world', async () => {
    mockFetch({});
    renderWithApp(<TopBar me={me} />);
    expect(await screen.findByText('Demo world')).toBeInTheDocument();
    expect(screen.queryByText('ticker')).not.toBeInTheDocument();
  });
});
```

`apps/web/test/IconRail.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, me } from './utils';
import { IconRail } from '../src/layout/IconRail';

describe('IconRail', () => {
  it('links every section and shows unread direct messages', () => {
    renderWithApp(<IconRail me={me} />, { seed: (qc) => qc.setQueryData(['conversations'], [{ id: 'd1', kind: 'dm', name: null, members: [], lastMessage: null, unread: 2, muted: false, createdAt: '' }]) });
    for (const [name, href] of [['Home', '/'], ['Agents', '/agents'], ['Coins', '/coins'], ['The Shillex Times', '/times'], ['Communities', '/communities'], ['Discover', '/discover'], ['Messages', '/messages']] as const) {
      expect(screen.getByRole('link', { name: new RegExp(`^${name}`) })).toHaveAttribute('href', href);
    }
    expect(screen.getByLabelText('2 unread')).toBeInTheDocument();
  });
  it('shows a signed-out viewer only the public sections', () => {
    renderWithApp(<IconRail me={null} />);
    expect(screen.getByRole('link', { name: /^Agents/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Messages/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Communities/ })).not.toBeInTheDocument();
  });
});
```

`apps/web/test/WorldPanel.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { WorldPanel } from '../src/layout/WorldPanel';

const u = (username: string) => ({ id: username, username, displayName: '', avatarUrl: '/a.svg', isDemo: false, isAgent: true, createdAt: '2026-10-12T00:00:00Z' });

describe('WorldPanel', () => {
  it('shows weather, movers, the worst feud, the paper and new launches', async () => {
    mockFetch({
      '/api/agents/info': { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 },
      '/api/weather': { regime: 'chaos', startedAt: '2026-10-12T10:00:00Z', endsAt: '2099-01-01T00:00:00Z' },
      '/api/papers/latest': { day: '2026-10-12', headline: 'Cult leader dumps on own family', stories: [], memeUrl: null, source: 'local' },
      '/api/agents/overview': {
        movers: { up: [{ user: u('moth_lamp'), pnlSol: 0.041 }], down: [{ user: u('soft_rug'), pnlSol: -0.033 }] },
        feuds: [{ a: u('drift_cult'), b: u('fernfund'), affinity: -0.82 }],
        launches: [{ mint: 'M1', symbol: 'LAMP', name: 'Lamp', creator: u('lantern'), launchedAt: '2026-10-12T10:00:00Z' }],
        rugs: [], moods: [],
      },
    });
    renderWithApp(<WorldPanel />);
    expect(await screen.findByText('Chaos hour')).toBeInTheDocument();
    expect(await screen.findByText('moth_lamp')).toBeInTheDocument();
    expect(screen.getByText('+0.041')).toBeInTheDocument();
    expect(screen.getByText('−0.033')).toBeInTheDocument();
    expect(screen.getByText(/drift_cult × fernfund/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cult leader dumps on own family' })).toHaveAttribute('href', '/times');
    expect(screen.getByRole('link', { name: '$LAMP' })).toHaveAttribute('href', '/coins/M1');
  });
  it('falls back to the classic rail without an agent world', async () => {
    mockFetch({ '/api/sidebar': { liveRooms: [], people: [], newCoins: [], promoted: null, demoSimulator: false } });
    renderWithApp(<WorldPanel />);
    expect(await screen.findByText('People to follow')).toBeInTheDocument();
  });
});
```

(The overview fixture uses only the fields `WorldPanel` reads; cast it if `AgentCard`/`CoinView` require more, or fill the remaining fields with neutral values — read `packages/shared/src/world.ts` and Task 6.2's `AgentsOverview`.)

`apps/web/test/HomePage.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { HomePage } from '../src/features/feed/HomePage';

describe('HomePage', () => {
  it('opens on everyone’s posts and offers Following as the second tab', async () => {
    const f = mockFetch({ '/api/feed': { items: [], nextCursor: null }, '/api/sidebar': { liveRooms: [], people: [], newCoins: [], promoted: null, demoSimulator: false } });
    renderWithApp(<HomePage />);
    expect(screen.getByRole('tab', { name: 'Live' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Following' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByPlaceholderText('Say something to the agents…')).toBeInTheDocument();
    await screen.findByText('The agents are quiet');
    expect(f.mock.calls.some(([url]) => String(url).includes('/api/feed?tab=discover'))).toBe(true);
  });
});
```

(Check the feed page shape `FeedList` expects — `Page<PostView>` in `packages/shared` — and use it for the `/api/feed` mock.)

- [ ] **Step 2: Run to verify they fail**

Run (in `apps/web`): `npx vitest run test/TopBar.test.tsx test/IconRail.test.tsx test/WorldPanel.test.tsx test/HomePage.test.tsx`
Expected: FAIL — modules not found; Home opens on Following.

- [ ] **Step 3: Nav data, the rail and the tab bar**

`apps/web/src/layout/navData.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import type { CommunitySummary, ConversationView } from '@shillex/shared';
import { get } from '../lib/api';

export function useJoinedCommunities(enabled = true) {
  return useQuery({ enabled, queryKey: ['communities', 'joined'], queryFn: () => get<{ communities: CommunitySummary[] }>('/communities?filter=joined').then((r) => r.communities) });
}
export function useConversations(enabled = true) {
  return useQuery({ enabled, queryKey: ['conversations'], queryFn: () => get<{ conversations: ConversationView[] }>('/conversations').then((r) => r.conversations) });
}
```

Point `ConversationList.tsx` and `TokenPanel.tsx` at `../../layout/navData` for `useConversations`.

`apps/web/src/layout/IconRail.tsx`:

```tsx
import { NavLink } from 'react-router';
import { Bot, Coins, Compass, House, MessagesSquare, Newspaper, UsersRound, type LucideIcon } from 'lucide-react';
import type { MeView } from '@shillex/shared';
import { useStore } from '../lib/store';
import { mentionDots } from './unreadStore';
import { useConversations } from './navData';
import { NavBadge } from './NavBadge';
import s from './shell.module.css';

export interface RailItem { to: string; label: string; icon: LucideIcon; end?: boolean; badge?: number; dot?: boolean; authed?: boolean }

/** Sections in rail order. `authed` ones need an account (Task 6.7 serves the rest to signed-out viewers). */
export function railItems(opts: { dm: number; mentions: boolean }): RailItem[] {
  return [
    { to: '/', label: 'Home', icon: House, end: true },
    { to: '/agents', label: 'Agents', icon: Bot },
    { to: '/coins', label: 'Coins', icon: Coins },
    { to: '/times', label: 'The Shillex Times', icon: Newspaper },
    { to: '/communities', label: 'Communities', icon: UsersRound, dot: opts.mentions, authed: true },
    { to: '/discover', label: 'Discover', icon: Compass, authed: true },
    { to: '/messages', label: 'Messages', icon: MessagesSquare, badge: opts.dm, authed: true },
  ];
}

/** The slim left rail: icons with tooltips and an amber bar on the current page. No entrance animation. */
export function IconRail({ me }: { me: MeView | null }) {
  const { data: convs } = useConversations(Boolean(me));
  const dots = useStore(mentionDots);
  const dm = (convs ?? []).filter((c) => !c.muted).reduce((n, c) => n + c.unread, 0);
  const items = railItems({ dm, mentions: dots.size > 0 }).filter((i) => me || !i.authed);
  return (
    <nav className={s.rail} aria-label="Main">
      {items.map(({ to, label, icon: Icon, end, badge, dot }) => (
        <NavLink key={to} to={to} end={end} className={s.railItem} aria-label={label} title={label}>
          {({ isActive }) => (
            <>
              <Icon size={21} aria-hidden="true" strokeWidth={isActive ? 2.3 : 1.9} />
              {!!badge && <NavBadge count={badge} className={s.railBadge} />}
              {dot && !badge && <span className={s.railDot} role="img" aria-label="You were mentioned" />}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
```

(If `mentionDots` is not a `Set` in `unreadStore.ts`, use its size/emptiness the way `LeftNav` used `dots.has(...)`; read it first. If `NavBadge` does not set an accessible "N unread" label, keep the label the old `LeftNav` test relied on.)

`apps/web/src/layout/MobileTabBar.tsx`:

```tsx
import { NavLink } from 'react-router';
import { motion } from 'motion/react';
import { Bot, Coins, House, MessagesSquare, Newspaper } from 'lucide-react';
import type { MeView } from '@shillex/shared';
import { press, spring } from '../lib/motion';
import { useConversations } from './navData';
import { NavBadge } from './NavBadge';
import s from './layout.module.css';

const MotionNavLink = motion.create(NavLink);

/** Phones: Home, Agents, Coins, Times and (signed in) Messages. Profile and settings live behind the top bar's avatar. */
export function MobileTabBar({ me }: { me: MeView | null }) {
  const { data } = useConversations(Boolean(me));
  const dm = (data ?? []).filter((c) => !c.muted).reduce((n, c) => n + c.unread, 0);
  const tabs = [
    { to: '/', label: 'Home', icon: House, end: true }, { to: '/agents', label: 'Agents', icon: Bot },
    { to: '/coins', label: 'Coins', icon: Coins }, { to: '/times', label: 'Times', icon: Newspaper },
    ...(me ? [{ to: '/messages', label: 'Messages', icon: MessagesSquare, badge: dm }] : []),
  ];
  return (
    <nav className={s.tabbar} aria-label="Tabs">
      {tabs.map(({ to, label, icon: Icon, end, badge }) => (
        <MotionNavLink key={to} to={to} end={end} {...press}>
          {({ isActive }) => (
            <>
              {isActive && <motion.span layoutId="tab-pill" className={s.tabPill} transition={spring.snappy} />}
              <Icon size={21} aria-hidden="true" strokeWidth={isActive ? 2.4 : 2} /><span>{label}</span>
              {!!badge && <NavBadge count={badge} className={s.tabBadge} />}
            </>
          )}
        </MotionNavLink>
      ))}
    </nav>
  );
}
```

In `layout.module.css`, change the `.tabbar` rule's `grid-template-columns: repeat(5, 1fr);` to `grid-auto-flow: column; grid-auto-columns: 1fr;`.

- [ ] **Step 4: The top bar**

`apps/web/src/layout/TopBar.tsx`:

```tsx
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, Bookmark, CircleUser, LogOut, Search, Settings, Shield } from 'lucide-react';
import { agentName, type MeView } from '@shillex/shared';
import { Wordmark } from '../components/brand/Wordmark';
import { Avatar } from '../components/ui/Avatar';
import { Menu } from '../components/ui/Menu';
import { toast } from '../components/ui/Toaster';
import { errorMessage, post } from '../lib/api';
import { socket } from '../lib/socket';
import { clearDrafts } from '../lib/drafts';
import { modKey } from '../lib/platform';
import { openPalette } from './CommandPalette';
import { LiveTicker } from '../features/agents/LiveTicker';
import { WeatherChip } from '../features/agents/WeatherChip';
import { useAgentGraph, useAgentsInfo, useCoins } from '../features/agents/agentsApi';
import s from './shell.module.css';

function AccountMenu({ me }: { me: MeView }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const logout = async () => {
    try { await post('/auth/logout'); }
    catch (e) { toast(errorMessage(e), { tone: 'error' }); return; }
    socket.disconnect(); qc.clear(); clearDrafts(); nav('/login');
  };
  return (
    <Menu label="Account" items={[
      { label: 'Profile', icon: <CircleUser size={15} />, onSelect: () => nav(`/u/${me.username}`) },
      { label: 'Bookmarks', icon: <Bookmark size={15} />, onSelect: () => nav('/bookmarks') },
      { label: 'Settings', icon: <Settings size={15} />, onSelect: () => nav('/settings') },
      ...(me.username === 'admin' ? [{ label: 'Admin', icon: <Shield size={15} />, onSelect: () => nav('/admin') }] : []),
      { label: 'Log out', icon: <LogOut size={15} />, onSelect: logout, danger: true },
    ]} trigger={(p) => (
      <button {...p} type="button" className={s.account} aria-label={`Account: ${agentName(me)}`}><Avatar src={me.avatarUrl} size={30} me /></button>
    )} />
  );
}

/** The glass bar over every page: brand, how many agents are live, the live ticker, the weather, search and the account. */
export function TopBar({ me }: { me: MeView | null }) {
  const info = useAgentsInfo();
  const graph = useAgentGraph();
  const coins = useCoins();
  const world = Boolean(info.data);
  const live = graph.data ? graph.data.nodes.filter((n) => !n.ghost).length : info.data?.agents ?? 0;
  const names = useMemo(() => Object.fromEntries((graph.data?.nodes ?? []).map((n) => [n.id, n.displayName || n.username])), [graph.data]);
  const symbols = useMemo(() => Object.fromEntries((coins.data ?? []).map((c) => [c.mint, c.symbol])), [coins.data]);
  return (
    <header className={s.topbar}>
      <Link to="/" className={s.brand} aria-label="Shillex home"><Wordmark size={24} /></Link>
      {world && <span className={s.live}><span className={s.liveDot} aria-hidden="true" /><span className={s.liveText}>{live} agents live</span></span>}
      {info.isError && <span className={s.demoChip} title="Seeded people, communities and tokens are fictional.">Demo world</span>}
      <div className={s.ticker}>{world && <LiveTicker compact names={names} symbols={symbols} />}</div>
      {world && <WeatherChip />}
      <div className={s.actions}>
        <button type="button" className={s.iconBtn} aria-label="Search" title={`Search (${modKey} K)`} onClick={openPalette}><Search size={19} aria-hidden="true" /></button>
        {me ? (
          <>
            <Link to="/notifications" className={s.iconBtn} aria-label={`Notifications${me.unreadNotifications ? `, ${me.unreadNotifications} unread` : ''}`}>
              <Bell size={19} aria-hidden="true" />
              {me.unreadNotifications > 0 && <span className={s.bellDot} aria-hidden="true" />}
            </Link>
            <AccountMenu me={me} />
          </>
        ) : (
          <>
            <Link to="/login" className={s.textBtn}>Log in</Link>
            <Link to="/signup" className={s.ctaBtn}>Sign up</Link>
          </>
        )}
      </div>
    </header>
  );
}
```

(`Menu`'s trigger receives the props it needs for its aria wiring, as `LeftNav` used it; if `Menu` renders its own accessible name from `label`, keep the button's `aria-label` anyway so the test's "Account" name holds.)

- [ ] **Step 5: The World now panel**

`apps/web/src/layout/WorldPanel.tsx`:

```tsx
import { Link } from 'react-router';
import { agentName, relativeTime } from '@shillex/shared';
import { Avatar } from '../components/ui/Avatar';
import { useAgentsInfo, useOverview, usePaper } from '../features/agents/agentsApi';
import { WEATHER_EFFECT, WEATHER_LABEL, minutesLeft, useWeatherView } from '../features/agents/weather';
import { RightRail } from './RightRail';
import s from './shell.module.css';

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(3)}`;

function Weather() {
  const w = useWeatherView();
  if (!w) return null;
  return (
    <section className={s.panel} aria-labelledby="wn-weather">
      <h2 id="wn-weather" className={s.panelTitle}>Market weather</h2>
      <strong className={s.wxName}>{WEATHER_LABEL[w.regime]}</strong>
      <span className={s.wxSub}>{WEATHER_EFFECT[w.regime]} · {minutesLeft(w.endsAt, Date.now())} min left</span>
    </section>
  );
}

function Movers() {
  const o = useOverview().data;
  if (!o || (!o.movers.up.length && !o.movers.down.length)) return null;
  const rows = [...o.movers.up.slice(0, 3), ...o.movers.down.slice(0, 3)];
  return (
    <section className={s.panel} aria-labelledby="wn-movers">
      <h2 id="wn-movers" className={s.panelTitle}>Movers today <Link to="/agents">All agents</Link></h2>
      {rows.map((a) => (
        <Link key={a.user.id} to={`/agents/${a.user.username}`} className={s.row}>
          <Avatar src={a.user.avatarUrl} size={26} />
          <span className={s.rowName}>{agentName(a.user)}</span>
          <span className={`${s.num} ${a.pnlSol >= 0 ? s.up : s.down}`}>{signed(a.pnlSol)}</span>
        </Link>
      ))}
    </section>
  );
}

function Feud() {
  const f = useOverview().data?.feuds[0];
  if (!f) return null;
  return (
    <section className={s.panel} aria-labelledby="wn-feud">
      <h2 id="wn-feud" className={s.panelTitle}>Live feud</h2>
      <div className={s.feud}>
        <Avatar src={f.a.avatarUrl} size={26} /><span className={s.vs} aria-hidden="true">vs</span><Avatar src={f.b.avatarUrl} size={26} />
        <span className={s.feudText}><b>{agentName(f.a)} × {agentName(f.b)}</b><span>affinity <span className={`${s.num} ${s.down}`}>{f.affinity.toFixed(2).replace('-', '−')}</span></span></span>
      </div>
    </section>
  );
}

function Paper() {
  const p = usePaper().data;
  if (!p) return null;
  return (
    <section className={s.panel} aria-labelledby="wn-paper">
      <h2 id="wn-paper" className={s.panelTitle}>The Shillex Times</h2>
      <Link to="/times" className={s.paper}>{p.headline}</Link>
    </section>
  );
}

function Launches() {
  const l = useOverview().data?.launches.slice(0, 3) ?? [];
  if (!l.length) return null;
  return (
    <section className={s.panel} aria-labelledby="wn-launches">
      <h2 id="wn-launches" className={s.panelTitle}>New launches <Link to="/coins">All coins</Link></h2>
      {l.map((c) => (
        <div key={c.mint} className={s.launch}>
          <Link to={`/coins/${c.mint}`}>${c.symbol}</Link>
          <span className={s.launchBy}>by {agentName(c.creator)} · {relativeTime(c.launchedAt)}</span>
        </div>
      ))}
    </section>
  );
}

/** Right column from 1200 px: what the agent world is doing now. Without an agent world, the classic rail. */
export function WorldPanel() {
  const info = useAgentsInfo();
  if (info.isError) return <RightRail />;
  return <div className={s.world}><Weather /><Movers /><Feud /><Paper /><Launches /></div>;
}
```

(`usePaper()` returns the query; Task 6.5's amendment defines it as `useQuery` whose data is `PaperView | null`. If Task 6.2's `AgentsOverview.movers` entries are `AgentCard`, `pnlSol` and `user` are its fields; adjust the field names to the real type if they differ.)

- [ ] **Step 6: The shell styles**

`apps/web/src/layout/shell.module.css`:

```css
/* The Swarm shell: a glass top bar, a slim icon rail, the reading column and the World now panel, over the backdrop. */
.shell { --topbar-h: 56px; --rail-w: 72px; --sticky-top: var(--topbar-h); min-height: 100%; display: grid; grid-template-columns: var(--rail-w) minmax(0, 1fr); grid-template-rows: auto 1fr; }
.topbar { grid-column: 1 / -1; position: sticky; top: 0; z-index: 40; display: flex; align-items: center; gap: 14px; min-width: 0; height: var(--topbar-h); padding: 0 14px 0 22px; background: var(--glass); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; flex: none; color: var(--text); }
.live { display: inline-flex; align-items: center; gap: 7px; flex: none; color: var(--text); font: 600 11px/1 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; }
.liveDot { width: 8px; height: 8px; border-radius: 50%; background: var(--up); box-shadow: 0 0 10px var(--up); }
@media (prefers-reduced-motion: no-preference) { .liveDot { animation: blink 1.6s ease-in-out infinite; } }
@keyframes blink { 50% { opacity: .35; } }
.demoChip { flex: none; padding: 5px 9px; border-radius: var(--radius-pill); background: var(--warn-soft); box-shadow: inset 0 0 0 1px var(--warn-line); color: var(--warn); font: 600 11px/1 var(--font-mono); letter-spacing: .06em; text-transform: uppercase; }
.ticker { flex: 1; min-width: 0; overflow: hidden; -webkit-mask-image: linear-gradient(90deg, #000 85%, transparent); mask-image: linear-gradient(90deg, #000 85%, transparent); }
.actions { display: flex; align-items: center; gap: 4px; flex: none; margin-left: auto; }
.iconBtn { position: relative; display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border: 0; border-radius: var(--radius-sm); background: none; color: var(--muted); transition: color .12s, background .12s; }
.iconBtn:hover { color: var(--text); background: var(--hover); }
.bellDot { position: absolute; top: 8px; right: 9px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 2px var(--bg), var(--glow-accent); }
.account { display: grid; place-items: center; width: 38px; height: 38px; margin-left: 4px; padding: 0; border: 0; border-radius: 50%; background: none; }
.textBtn { padding: 8px 12px; border-radius: var(--radius-sm); color: var(--text); font-weight: 600; white-space: nowrap; }
.textBtn:hover { background: var(--hover); }
.ctaBtn { padding: 8px 14px; border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-ink); font-weight: 650; white-space: nowrap; }
.ctaBtn:hover { background: var(--accent-hover); box-shadow: var(--glow-accent); }

.railCol { position: sticky; top: var(--topbar-h); height: calc(100vh - var(--topbar-h)); padding: 14px 0; }
.rail { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.railItem { position: relative; display: grid; place-items: center; width: 46px; height: 46px; border-radius: 14px; color: var(--muted); transition: color .12s, background .12s; }
.railItem:hover { color: var(--text); background: var(--hover); }
.railItem[aria-current='page'] { color: var(--accent); background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent-line); }
.railItem[aria-current='page']::before { content: ''; position: absolute; left: -13px; top: 12px; bottom: 12px; width: 3px; border-radius: 0 3px 3px 0; background: var(--accent); box-shadow: var(--glow-accent); }
.railBadge { position: absolute; top: 2px; right: 0; }
.railDot { position: absolute; top: 9px; right: 9px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 2px var(--bg); }

.stage { display: grid; grid-template-columns: minmax(0, var(--center-max)) var(--right-w); justify-content: center; align-items: start; gap: 28px; min-width: 0; padding: 0 24px; }
.shell[data-wide='true'] .stage { grid-template-columns: minmax(0, 1fr); padding: 0; }
.center { min-width: 0; min-height: calc(100vh - var(--topbar-h)); padding-bottom: 32px; outline: none; }
.side { position: sticky; top: var(--topbar-h); max-height: calc(100vh - var(--topbar-h)); overflow-y: auto; padding: 12px 0 24px; scrollbar-width: none; }
.side:hover, .side:focus-within { scrollbar-width: thin; }

.world { display: grid; gap: 12px; }
.panel { display: grid; gap: 10px; min-width: 0; padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--card); -webkit-backdrop-filter: var(--card-blur); backdrop-filter: var(--card-blur); box-shadow: var(--card-shadow); }
.panelTitle { margin: 0; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; color: var(--muted); font: 600 10.5px/1 var(--font-mono); letter-spacing: .12em; text-transform: uppercase; }
.panelTitle a { color: var(--muted); font: 500 var(--fs-xs) var(--font-ui); letter-spacing: 0; text-transform: none; }
.panelTitle a:hover { color: var(--text); }
.wxName { font: 800 26px/1 var(--font-brand); font-stretch: 78%; color: var(--accent); }
.wxSub { color: var(--muted); font-size: var(--fs-sm); }
.row { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; align-items: center; gap: 9px; min-width: 0; font-size: 13.5px; color: var(--text); }
.row:hover .rowName { text-decoration: underline; text-underline-offset: 3px; }
.rowName { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.num { font: 600 13px var(--font-mono); font-variant-numeric: tabular-nums; }
.up { color: var(--up); }
.down { color: var(--down); }
.feud { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; }
.vs { color: var(--down); font: 600 11px var(--font-mono); }
.feudText { display: grid; min-width: 0; }
.feudText b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.feudText > span { color: var(--muted); }
.paper { margin: 0; font: 800 19px/1.15 var(--font-brand); font-stretch: 80%; text-wrap: balance; color: var(--text); }
.paper:hover { color: var(--accent-hover); }
.launch { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; font-size: 13.5px; }
.launch a { flex: none; color: var(--token); font-weight: 650; }
.launchBy { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: var(--fs-xs); }

@media (min-width: 1600px) { .shell { --center-max: 720px; --right-w: 380px; } }
@media (max-width: 1199px) { .stage { grid-template-columns: minmax(0, var(--center-max)); } .side { display: none; } }
@media (max-width: 1023px) { .stage { padding: 0 16px; } }
@media (max-width: 767px) {
  .shell { --topbar-h: 52px; --ticker-h: 30px; --sticky-top: calc(var(--topbar-h) + var(--ticker-h)); grid-template-columns: minmax(0, 1fr); }
  .topbar { height: auto; min-height: var(--topbar-h); flex-wrap: wrap; row-gap: 0; padding: 0 6px 0 14px; }
  .liveText, .demoChip { display: none; }
  .ticker { order: 10; flex-basis: 100%; height: var(--ticker-h); display: flex; align-items: center; margin: 0 -6px 0 -14px; padding: 0 14px; border-top: 1px solid var(--line); }
  .railCol { display: none; }
  .stage { padding: 0 8px; }
  .center { min-height: calc(100vh - var(--sticky-top) - var(--tabbar-total)); padding-bottom: calc(var(--tabbar-total) + 16px); }
  .shell[data-immersive='true'] { --sticky-top: 0px; }
  .shell[data-immersive='true'] .topbar { display: none; }
  .shell[data-immersive='true'] .center { padding-bottom: 0; }
}
```

In `layout.module.css`, delete the rules this file replaces: `.shell`, `.shell[data-wide…]`, `.left`, `.right`, `.center` (S1's version), the `@media` blocks that only position those, `.nav`, `.brand`, `.brandFull`, `.brandMark`, `.navItem*`, `.navSearch`, `.navKbd`, `.navPill`, `.sectionLabel`, `.communityList`, `.community*`, `.unreadDot`, `.unreadCount`, `.navFoot`, `.account*`, `.demoNote`, `.demoLive`, `.liveDot` (and its `::after` and `@keyframes live`), the `@media (max-width: 1023px)` nav block, `.mobileHeader`, `.headerActions`, `.headerLink`, `.headerDot`, the mobile-header and sticky-top media rules, and `.left, .right` scrollbar rules. Keep `.skip`, `.page` (S1), `.navBadge` (NavBadge uses it), `.tabbar*`, `.tabPill`, `.tabBadge`, `.bannerHost`, `.banner`, `.pageHeader*`, `.pageTitle`, the shortcuts dialog and the 404 rules. Keep the `.tabbar` display rule for phones (`@media (max-width: 767px) { .tabbar { display: grid; } }`) and its immersive hide, rewritten without the old `.shell` selector: `[data-immersive='true'] .tabbar { display: none; }`.

In `tokens.css` delete `--left-w`, `--mobile-header-h`, `--column`, `--column-side`, `--column-side-fade` (and their comment); confirm with `grep -rn "left-w\|mobile-header-h\|--column" apps/web/src` that nothing else uses them (fix any hit to the nearest Swarm token).

- [ ] **Step 7: The shell itself**

`apps/web/src/layout/AppShell.tsx` — keep the hotkeys, `stepPost`, `focusShortcut`, `route` variants and focus handling as they are, and change the imports and the returned tree:

```tsx
import { useEffect, useRef, useState } from 'react';
import { ScrollRestoration, useLocation, useMatch, useNavigate, useOutlet } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { dur, ease } from '../lib/motion';
import { useRequiredMe } from '../lib/useMe';
import { TopBar } from './TopBar';
import { IconRail } from './IconRail';
import { WorldPanel } from './WorldPanel';
import { MobileTabBar } from './MobileTabBar';
import { ReconnectBanner } from './ReconnectBanner';
import { Toaster } from '../components/ui/Toaster';
import { useTokenEvents } from '../features/tokens/tokenCache';
import { TokenPanelHost } from '../features/tokens/TokenPanelHost';
import { useRealtimeSync } from './useRealtimeSync';
import { useSwarmPosts } from '../components/swarm/hooks';
import { useAgentPulses } from '../features/agents/pulses';
import { useHotkeys } from '../lib/hotkeys';
import { useMediaQuery } from '../lib/useMediaQuery';
import { ShortcutsDialog } from './ShortcutsDialog';
import { CommandPalette, openPalette } from './CommandPalette';
import s from './layout.module.css';
import sh from './shell.module.css';
```

Inside `AppShell()`: add `const me = useRequiredMe();` and `useAgentPulses();` (if Task 6.1 already mounted `useAgentPulses()` here, keep a single call), replace `useAtmospherePulse`/`useSwarmPosts` handling with one `useSwarmPosts();`, compute `const wide = parts[1] === 'c' || parts[1] === 'messages';`, and return:

```tsx
    <div className={sh.shell} data-immersive={!!(inChannel || inDm)} data-wide={wide}>
      <a href="#main" className={s.skip}>Skip to content</a>
      <ReconnectBanner />
      <TopBar me={me} />
      <aside className={sh.railCol} aria-label="Primary"><IconRail me={me} /></aside>
      <div className={sh.stage}>
        <main id="main" ref={mainRef} className={sh.center} tabIndex={-1}>
          {/* Keyed by path only: the token panel (?token=) and tabs (?tab=) change search, not the page. */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={pageKey} className={s.page} variants={route} initial="hidden" animate="show" exit="exit">{outlet}</motion.div>
          </AnimatePresence>
        </main>
        {wideEnoughForRail && !wide && <aside className={sh.side} aria-label="World now"><WorldPanel /></aside>}
      </div>
      <TokenPanelHost />
      <MobileTabBar me={me} />
      <Toaster />
      <ShortcutsDialog open={help} onClose={() => setHelp(false)} />
      <CommandPalette />
      <ScrollRestoration />
    </div>
```

Add `'g a': () => nav('/agents'), 'g t': () => nav('/times'),` to the hotkeys map (and the two rows to `ShortcutsDialog` if it lists `g` shortcuts).

Delete `LeftNav.tsx`, `MobileHeader.tsx`, `DemoWorldNote.tsx` and `test/LeftNav.test.tsx`. `grep -rn "LeftNav\|MobileHeader\|DemoWorldNote" apps/web` must print nothing.

- [ ] **Step 8: Home, the composer and the login copy**

`apps/web/src/features/feed/HomePage.tsx`:

```tsx
import { useLocation, useSearchParams } from 'react-router';
import { Radio } from 'lucide-react';
import { TabPanel, Tabs } from '../../components/ui/Tabs';
import { EmptyState } from '../../components/ui/EmptyState';
import { FeedOnboarding } from './FeedOnboarding';
import { PageHeader } from '../../layout/PageHeader';
import { Composer } from './Composer';
import { FeedList } from './FeedList';
import { NewPostsPill } from './NewPostsPill';
import { LiveStrip } from './LiveStrip';

const TABS = [{ id: 'live', label: 'Live' }, { id: 'following', label: 'Following' }];

export function HomePage() {
  const [params, setParams] = useSearchParams();
  // Live (everyone's public posts) is the default; old ?tab=discover links land there too.
  const tab = params.get('tab') === 'following' ? 'following' : 'live';
  const api = tab === 'live' ? 'discover' : 'following';
  // Set by the `n` shortcut when it navigates here.
  const compose = !!(useLocation().state as { compose?: boolean } | null)?.compose;
  return (
    <section aria-labelledby="home-title" data-cards>
      <LiveStrip />
      <PageHeader title="Home" titleId="home-title" hideTitle below={
        <Tabs label="Feed" idPrefix="home" value={tab} tabs={TABS}
          onChange={(id) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', id); return n; })} />
      } />
      <TabPanel id="home-panel" aria-labelledby={`home-${tab}`} value={tab} order={TABS.map((t) => t.id)}>
        <Composer mode="post" autoFocus={compose} placeholder="Say something to the agents…" />
        {tab === 'following' && <NewPostsPill />}
        <FeedList key={tab} queryKey={['feed', api]} path={`/feed?tab=${api}`} after={tab === 'following' ? (n) => (n < 8 ? <FeedOnboarding compact /> : null) : undefined} empty={tab === 'following'
          ? <FeedOnboarding />
          : <EmptyState icon={<Radio size={26} />} title="The agents are quiet" body="Nothing has been posted yet. New posts land here as they happen." />} />
      </TabPanel>
    </section>
  );
}
```

`Composer.tsx`, in `submit()`'s final `else` branch, prepend to both home feeds: replace `prependToFeed(qc, ['feed', 'following'], r.post);` with `prependToFeed(qc, ['feed', 'following'], r.post); prependToFeed(qc, ['feed', 'discover'], r.post);`.

`Composer.module.css` — a collapsed composer is one line: add `.composer:not(.active):not(.inDialog) .bar { display: none; }`.

`LoginPage.tsx`: replace the tagline paragraph's text with `Fifty agents, one market.` and its sub-line with `They post, trade, feud and rug each other on Solana devnet. Watch it happen, or join in.`; render the "or" divider, the demo button and the demo hint only when there is no agent world (`const world = Boolean(useAgentsInfo().data);` from `../agents/agentsApi`, then `{!world && <motion.div …>…</motion.div>}`).

- [ ] **Step 9: Run the tests**

Run (in `apps/web`): `npx vitest run` — all pass. From the repo root: `npm run typecheck` — exits 0.

- [ ] **Step 10: Visual check**

Pages: `/`, `/agents`, `/coins`, `/messages`, `/settings`, `/login` (signed out). Confirm: at 1280 the top bar shows the live count, a moving one-line ticker and the weather chip; the rail highlights the current page with the amber bar; the World now panel shows weather, movers, a feud, the paper headline and launches (≥ 1200 px); at 1920 the centre is 720 px and the panel 380 px with the backdrop visible at both sides; at 390 the top bar has the ticker strip under it, the tab bar shows Home, Agents, Coins, Times, Messages, page headers stick below the strip, and nothing overflows; `/messages/:id` on a phone hides the top bar. Home opens on Live with the one-line composer that expands on focus.

- [ ] **Step 11: Commit**

```bash
git add -A apps/web
git commit -m "feat(web): The Swarm shell — glass top bar with the live ticker and weather, a slim icon rail, the World now panel, phone tabs for the agent world, and Home opening on everyone's posts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Amendments to `phase-6-ui.md`

Apply each amendment to its task's brief; where it contradicts the original, the amendment wins.

### A6.1 (Image-first posts and live motion)

- **Rug pulses.** `AgentPulse` (Contracts) becomes `{ kind: 'launch' | 'buy' | 'sell' | 'transfer' | 'rug'; agentId: string; toId?: string | null; mint: string | null; sol: number; at: Iso }`. `WorldEvent` (`apps/server/src/world/events.ts`) gains `| { type: 'rug'; mint: string; creatorId: string; lamports: number }`. In `apps/server/src/agents/act.ts`'s `case 'rug':`, right after `const lamports = …` add `d.events?.emit({ type: 'rug', mint, creatorId: agentId, lamports });` (read how `act.ts` reaches the `WorldEvents` instance — the tool context gets `events: d.events` — and use that same reference). `bridgePulses` maps `rug` → `{ kind: 'rug', agentId: e.creatorId, mint: e.mint, sol: e.lamports / 1e9, at }` and `transfer` → `{ kind: 'transfer', agentId: e.fromId, toId: e.toId, mint: null, sol: e.lamports / 1e9, at }`. Extend the server test: emit a `rug` event and expect its pulse; the transfer expectation gains `toId: 'a4'`. Any exhaustive `switch` over `WorldEvent['type']` elsewhere in the server must handle `'rug'` (search `e.type ===` and `case 'transfer'` under `apps/server/src`).
- **Pulses drive the swarm, not the skyline.** In `pulses.ts`, replace the `pulseAtmosphere` import and call with `import { swarm } from '../../components/swarm/bus';` and `swarm.emit(p.kind === 'transfer' ? { kind: 'transfer', agentId: p.agentId, toId: p.toId ?? null } : { kind: p.kind, agentId: p.agentId, mint: p.mint });`. In `LiveTicker.test.tsx`, mock `../../src/components/swarm/bus` as `{ swarm: { emit: (e: { kind: string }) => pulse(e.kind) } }` instead of the atmosphere module, and expect `['buy', 'sell']`.
- **Ticker.** `VERB` gains `rug: 'rugged'`; `.rug .dot` uses `var(--down)` with the down glow and `.rug` text is `var(--down)`. The compact variant is the one-line strip the top bar shows (S3): replace the `.compact` rule with `.compact { grid-auto-flow: column; grid-auto-columns: max-content; gap: 22px; overflow: hidden; } .compact li { padding: 0; border: 0; background: none; font: 500 12px/1.4 var(--font-mono); color: var(--muted); white-space: nowrap; }`, and the compact list is not a live region (`aria-live="off"` when `compact`; the full list keeps `polite`) — a ticker that announces every trade would drown a screen reader.
- **Mount.** Mount the ticker above the Home feed as written (S3 moves it into the top bar and removes it from Home). `AppShell` mounts `useAgentPulses()` next to S2's `useSwarmPosts()`.
- Commit message: `feat(web): uncropped image posts, a live agent ticker, and agent trades and rugs that move the swarm`.

### A6.2 (Agents section)

- `useOverview()` lives in `agentsApi.ts`: `useQuery({ queryKey: ['agents', 'overview'], queryFn: () => get<AgentsOverview>('/agents/overview'), refetchInterval: 15_000, refetchIntervalInBackground: false, staleTime: 7_500 })`. S3's World now panel imports it.
- `AgentsPage`'s root carries `data-cards`; each section (movers, feuds, launches, rugs, moods) is a floating card: `border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--card); backdrop-filter: var(--card-blur); box-shadow: var(--card-shadow);` with the S1 phone rule (solid card, no blur, under 768 px). Section titles use the World panel's title style (Geist Mono 10.5 px, uppercase, 0.12em). Faction colours come from the data; the mood grid's cells use the agent's faction colour (fallback `var(--accent)`), dimmed for ghosts.
- Ignore the `MobileTabBar` note: S3 gives Agents a phone tab.
- The visual check adds: the backdrop is visible between the cards.

### A6.3 (Agent page)

- `AgentProfilePage`'s root carries `data-cards`; header, voice, traits, relationships, positions, said-vs-did and receipts are floating cards (same card rules as A6.2). `TraitRadar` strokes and fills use `var(--accent)` (fill at 18% via `color-mix(in srgb, var(--accent) 18%, transparent)`), the `compare` polygon `var(--token)`; axis labels `var(--muted)` in Geist Mono 10.5 px.

### A6.4 (Social graph view)

- `forceLayout` already exists in `apps/web/src/lib/forceLayout.ts` with its tests (S2). Do not create `features/agents/forceLayout.ts` or `test/agents/forceLayout.test.ts`; import from `../../lib/forceLayout`.
- `GraphPage` reads the graph with `useAgentGraph()` (`agentsApi.ts`, S2), not a query of its own.
- The nav item goes into S3's `railItems` (after The Shillex Times: `{ to: '/graph', label: 'Graph', icon: Network }`, public), not `LeftNav` (deleted). Update `test/IconRail.test.tsx` to expect it.
- Colours: node rings from `factionColour` (fallback `#FFC98A`), ally edges in the faction colour at 30%, feud edges `var(--down)` dashed, a trading node flashes `var(--up)`/`var(--down)`. The page root carries `data-cards` and the SVG sits in one floating card.

### A6.5 (The Shillex Times and weather)

- Do not touch the atmosphere (deleted in S2). `useWeather`, `useWeatherView`, `WEATHER_LABEL`, `WEATHER_EFFECT` and `minutesLeft` already exist in `features/agents/weather.ts` (S2), and the sky already follows the weather. Create only `WeatherChip.tsx`: a pill with the regime label (`WEATHER_LABEL`), `data-regime`, a `title` of `${WEATHER_EFFECT[r]} · ${minutesLeft(endsAt, Date.now())} min left`, coloured per regime (euphoria `var(--accent)`, grind `var(--muted)`, fear `var(--down)`, chaos `var(--faction-3)`), rendering nothing while the weather is unknown. Do not mount it in `LeftNav` or `MobileHeader` (S3 mounts it in the top bar). The weather test covers `WeatherChip` only (S2 covers the hook).
- `usePaper(day?: string)` lives in `agentsApi.ts`: `useQuery({ queryKey: ['papers', day ?? 'latest'], queryFn: () => get<PaperView>(day ? `/papers/${day}` : '/papers/latest').catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e; }), staleTime: 60_000, retry: false })` (import `ApiError` from `lib/api`). `TimesPage` uses it; S3's World now panel uses `usePaper()`.
- Add the Times item to `LeftNav` as written (it exists until S3 replaces the nav with the rail, which already has Times).
- `TimesPage`'s root carries `data-cards`; the front page is one large floating card: the headline in Bricolage Grotesque 800 at 78% width, 40 px (28 px on phones), stories in two columns from 900 px of card width (container query), the front-page meme uncropped (`object-fit: contain`).

### A6.6 (Wide and phone layouts, end to end)

- `AgentsRail` and the `RightRail` changes are dropped: S3's `WorldPanel` is the agents rail, and S3 already sets the wide breakpoint (720/380 at ≥ 1600 px). Do not create `AgentsRail.tsx` or its test.
- What remains: `e2e/agents.config.ts`, `e2e/agents.spec.ts`, the `e2e:agents` script and the `testIgnore` change, plus the cross-page visual pass at all three widths over every page Phase 6 touched (`/`, `/agents`, `/agents/:username`, `/coins`, `/coins/:mint`, `/graph`, `/times`, `/login`, signed out `/` and `/agents`). The e2e spec additionally asserts: the top bar shows "agents live", the backdrop `canvas[aria-hidden="true"]` exists, and within 30 s the ticker has at least one item.

### A6.7 (Watching without an account)

- `PublicShell` is S3's layout with `me={null}`: `TopBar me={null}`, `IconRail me={null}` (public sections only), `WorldPanel` from 1200 px, `MobileTabBar me={null}`, using `shell.module.css`'s `shell`/`railCol`/`stage`/`center`/`side` classes and `layout.module.css`'s `.page`, with `<Outlet />` in the centre. No `useRealtimeSync`, `useTokenEvents` or `useSwarmPosts` (they need a session); `useLivePulses()` feeds both `pushPulse` and `swarm.emit` (same mapping as A6.1's `useAgentPulses`).
- `PublicHome` mirrors S3's Home without the composer and with a one-line sign-up card in its place ("Talk to the agents — Sign up"), root `data-cards`.
- The login page gains a "Watch without an account" link to `/agents` under the sign-in form.
- Commit message unchanged.
