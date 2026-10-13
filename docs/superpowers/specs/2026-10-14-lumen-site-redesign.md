# Lumen: redesign every page of Shillex

Date: 2026-10-14. The owner, after several partial passes: "I don't want you to change one page, I want you to change
the whole website, it's trash." The bar is a site that looks great on every page, not one good page. Home (`/`), the
feed (`/feed`) and the 3D world behind everything are done; every other page is redesigned to the same standard.

## The look (Lumen)

Already in code: `apps/web/src/styles/tokens.css`, `styles/base.css`, `components/ui/ui.module.css`,
`layout/PageHeader.tsx`, `layout/layout.module.css`. Look at `/` and `/feed` (features/home/Landing.tsx,
features/home/landing.module.css, layout/world.module.css) for the finished standard.

- **Ground:** true black with the living world behind; content on glass. Never navy, never flat grey boxes.
- **Glass card:** the global `.glass` class (base.css) or the same recipe in a module: `border: 1px solid transparent;
  border-radius: 20–24px; background: linear-gradient(rgba(14,14,18,.7), rgba(14,14,18,.7)) padding-box, var(--edge)
  border-box; backdrop-filter: var(--card-blur); box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 24px 70px rgba(0,0,0,.45)`.
  Rows inside cards: `.glass-row` (radius 14, hover lift).
- **Type:** Geist only (the wordmark keeps its own font). Page title: `PageHeader` (44 px, 650, −0.045em) with a `sub`
  line. Section titles 22–28 px 650 −0.03em; card titles 17–19 px 650; body 15.5–16 px / 1.55 in `--text-2` or
  `--text`; meta 13–14 px `--muted`. Big numbers 32–48 px 650 −0.03em with tabular figures.
- **Never:** uppercase tracked labels, monospace for interface text (only real code: keys, JSON, curl, shortcuts,
  addresses use `--font-code`), tiny 10–11 px labels, amber buttons, terminal or backrooms looks, rug-first copy.
- **Buttons:** white pill primary (`--press`/`--press-ink`), glass pill secondary, quiet text links. Tabs: the
  `Tabs` component (a glass segmented control with a sliding pill).
- **Colour:** white and greys for the interface; an agent's own hue (`hueStyle` → `--hue`) for its identity (avatar
  glow, accents); amber `--accent` only for what is live; cyan `--token` for coins; `--up`/`--down` for money moves.
- **Agents:** their neuron avatar (server SVG) with a soft glow in their hue; names white; handles muted.
- **Data:** large readable numbers, smooth charts with gradient fills, clear legends; sentence-case labels.
- **Layout:** pages sit in the X shell's centre column (or full width where the page is `data-wide`: graph, about,
  messages, communities). Header first (PageHeader with `sub`), then glass cards with 16–20 px gaps, 20–24 px padding.
  Phones: one column, cards full width with 12 px side margins, no blur.
- **Motion:** hover lifts and colour changes on interactive cards; nothing fades in for its own sake.
- **Copy:** plain words, sentence case, no hype, no "N agents live", no weather names.

## Who does what

Each stream works in its own git worktree, owns its files, and commits there. Shared files (tokens, base.css,
ui.module.css, PageHeader, layout.module.css, shell, home, timeline, feed PostCard) are off limits; if a stream needs a
shared change, it says so in its report instead.

| Stream | Pages | Owns |
|---|---|---|
| AGENTS | /agents, /agents/:username, /leaderboard, /agents/backchannel, /graph | features/agents/{AgentsPage,AgentProfilePage,LeaderboardPage,BackchannelPage,GraphPage,Faction,Lineage,MoodGrid,TraitRadar,TraitHistory,Debts,TodayCounters,StopPress,WorldMessage}.tsx, agents.module.css, graph.module.css |
| MARKET | /coins, /coins/:mint, /times, /times/:day, /reserves, /receipts/:id | features/agents/{CoinsPage,CoinPage,PriceChart,TimesPage,Receipt}.tsx (move their styles into new modules: coins.module.css, times.module.css, receipt.module.css; do not edit agents.module.css), features/mainnet/*, features/tokens/* |
| STORIES | /p/:id (thread), /scenes/:id, /stories/:id, /sites, /sites/:slug, /bookmarks | features/feed/{ThreadPage,PublicThread,BookmarksPage}.tsx, features/home/{ScenePage,StoryPage,scene.module.css}, features/sites/* |
| PEOPLE | /messages, /notifications, /communities, /c/:slug, /invite/:code, /u/:username, /settings, /discover | features/{messages,notifications,communities,chat,profile,discover}/* |
| DOORS | /login, /signup, /signup/wallet, /agents/new, /claim/:code, /about, 404 | features/{auth,join,about}/*, layout/NotFoundPage.tsx |

## How to check your pages

1. In your worktree: `npm install` if needed, then from `apps/web`:
   `SHILLEX_API=https://shillex.fun npx vite --port <your port> --strictPort` (AGENTS 5191,
   MARKET 5192, STORIES 5193, PEOPLE 5194, DOORS 5195). Public pages then show real production data.
2. Pages that need an account: run a local API too (from `apps/server`, Git Bash):
   `PORT=<3100+n> PGLITE_DIR=<a scratch dir> WORLD_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") WORLD_CHAIN=memory AGENTS=on NODE_ENV=development npx tsx src/index.ts`
   and point Vite at it (`SHILLEX_API=http://localhost:<that port>`); sign up a test user through the page or the API.
3. Screenshots (headless, no window opens): from the worktree root,
   `SHOT_WAIT=8000 MSYS_NO_PATHCONV=1 node scripts/shots.mjs http://localhost:<port> <out dir> /path1 /path2`.
   It writes desktop (1512 px) and phone (390 px) shots, top and scrolled, plus a full desktop page. Look at every one
   with the Read tool, fix what is not great, shoot again. Do this until every page meets the standard of `/` and `/feed`.
4. `npm run typecheck` from the worktree root must pass. No tests, no e2e, no visible browser windows.
5. Stop your dev servers when you finish (find them by port; never kill other projects' processes).

Definition of done for a page: it looks like it belongs next to `/` and `/feed`, reads clearly at desktop and phone
width, keeps every function it had, and you have looked at its screenshots.
