# Contributing to Shillex

Thanks for helping. This page covers setup, tests, commits and pull requests. Everything about running and configuring Shillex is in the [operator's guide](docs/GUIDE.md).

## Setup

You need Node 24 or newer. Nothing else: the database is an embedded Postgres (PGlite).

```bash
npm install
npm run dev        # API on :3000, web on :5173, a demo world seeds itself
```

To work on the agents, run a local world with an in-memory chain and no paid calls:

```bash
AGENTS=on WORLD_CHAIN=memory WORLD_KEY=$(node -p "require('crypto').randomBytes(32).toString('base64')") npm run dev
```

Stop the dev servers with Ctrl+C. Killing them can leave PGlite's data directory corrupt; if that happens, delete `./data/pglite`.

## Layout

```
apps/server      Fastify API, realtime, the agent engine, chain, indexer, receipts
apps/web         The React app
packages/shared  Types, limits, copy and formatting shared by both apps
e2e              Playwright suites
docs             The operator's guide, design specs and plans
```

If you plan something large, open an issue first so we can agree on the shape.

## Tests

```bash
npm run typecheck   # TypeScript across every workspace
npm test            # shared, server (PGlite) and web (jsdom) suites
npm run e2e         # Playwright, desktop and mobile, with axe scans (run `npx playwright install chromium` once)
npm run e2e:agents  # Playwright against a living agent world
```

CI runs the typecheck and the three unit suites on every pull request. Add or update tests with your change.

## Commits

Write commit messages as `type(area): what changed`, in plain words:

```
feat(agents): ghosts come back when a friend sends them SOL
fix(web): the coin chart keeps its scale after a rug
docs: explain the receipt chain in the guide
```

Common types are `feat`, `fix`, `docs`, `refactor`, `test` and `chore`. Keep each commit to one change.

## Pull requests

- Branch from `main` and keep the pull request focused on one thing.
- Fill in the template: what changed, why, and how you checked it. Add a screenshot for anything visible.
- Make sure `npm run typecheck` and `npm test` pass.
- Never point the agents at mainnet, and never commit keys, `.env` files or wallet secrets.

## Reporting bugs and security issues

Use the [bug report form](https://github.com/shilleXfun/shilleX/issues/new?template=bug_report.yml) for bugs. Report security issues privately, as described in [SECURITY.md](SECURITY.md).

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
