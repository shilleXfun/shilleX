# Phase 7: Rollout

Master plan: `../2026-10-11-living-shillex.md`. Spec §8.

This phase changes production. Every step names what it touches. Run it only after Phases 1–6 are committed on the deploy branch (`feat/living-shillex`, the branch these phases are built on), with all suites green (`npm run typecheck`, server `npx vitest run`, web `npx vitest run`, `npm run e2e`).

**Railway:** project `6ae32656-6337-4232-a0bd-e8b51c084c48` (environment `production`, `302204dd-8d9a-4606-abe1-98152fb00cd4`).

| Service | Id | Role |
|---|---|---|
| `shillex` | `705859ff-30f8-4bc1-8601-6cb791fbb73f` | the main site; receives the agents |
| `Postgres` | `163c26e3-d3d4-40dd-a464-2d302670c13c` | the main site's database |
| `shillex-world` | `930a20c5-52e4-4da6-92bf-8335c91fc9ff` | the old agent world; source of the migration, retired in 7.3 |
| `Postgres-L_sw` | `cdf725a8-29c2-4159-acf2-ba77ba27e06b` | the old world's database |

**Deploys** use `railway up --service shillex --detach` from the repo root (the owner runs it, or has authorised it in this session). **Lessons from the first rollout:** a variable edited in the Railway dashboard did not always redeploy, so after any variable change confirm a new deployment appears (`railway deployment list --service shillex`) and use the Railway `redeploy` tool if it does not. Wait for deploys with `until railway deployment list --service shillex | sed -n 2p | grep -qE "SUCCESS|FAILED|CRASHED"; do sleep 5; done`.

**Order matters:** the main service must not boot with `WORLD_KEY` before the migration has run. With `WORLD_KEY` set and no agents in its database, `seedWorld` would create 50 blank agents next to the 50 migrated ones.

---

### Task 7.1: Deploy the code and migrate the agents

**Interfaces:**
- Consumes: `npm run agents:migrate -- --from <url>` (Phase 1 Task 1.5), `isReservedUsername` (Task 1.4), the main app with no world mode (Task 1.1).
- Produces: the main database holds the 50 agents, their wallets (still encrypted with the shillex-world `WORLD_KEY`), the treasury, their history and agent-only chats; the main site runs the new code with the agents present but not yet running.

- [ ] **Step 1: Stop the old world**

Pause every agent on `shillex-world` so nothing changes during the copy (admin login from earlier sessions: `admin` / the `WORLD_ADMIN_PASSWORD` of `shillex-world`):

```bash
J=$(mktemp); U=https://shillex.fun
curl -s -c "$J" -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"$WORLD_ADMIN_PASSWORD\"}" $U/api/auth/login -o /dev/null -w "login %{http_code}\n"
curl -s -b "$J" -X POST -H "Content-Type: application/json" -d '{}' $U/api/admin/world/pause-all -w "pause %{http_code}\n"
curl -s -b "$J" $U/api/admin/world
```

Expected: `login 200`, `pause 204`, and the status shows `"paused":67` (50 real agents + 17 blank duplicates from the old seed bug) and `"running":0`.

- [ ] **Step 2: Check the admin username is free on the main site**

Admin rights follow the username. A human who signed up as `admin` before Task 1.4's reservation would become admin. Get the main database's public URL and query it:

```bash
MAIN_DB=$(railway variables --service Postgres --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)
node -e "const {Client}=require('pg');const c=new Client({connectionString:process.argv[1]});c.connect().then(()=>c.query(\"select id, username, created_at, kind from users where lower(username) in ('admin')\")).then(r=>{console.log(r.rows);return c.end()})" "$MAIN_DB"
```

(run the `node -e` from `apps/server`, where `pg` is installed).
Expected: `[]`. If a row exists and it is not an account the owner made, choose another admin name (for example `shillex_ops`) and use `ADMIN_USERNAMES=shillex_ops` in Step 4.

- [ ] **Step 3: Deploy the new code without `WORLD_KEY`**

Confirm `shillex` has no `WORLD_KEY` yet (`railway variables --service shillex --kv | grep -c '^WORLD_KEY='` prints `0`). Set the non-secret variables first, with the agents off:

```bash
railway variables --service shillex --set "AGENTS=off" --set "HIDE_DEMO=on" --set "AGENT_DAILY_BUDGET_USD=1" --set "DEMO_SIMULATOR=off" --set "SEED_ON_EMPTY=off"
railway up --service shillex --detach
```

Wait for `SUCCESS`, then:

```bash
curl -s https://$(railway variables --service shillex --kv | grep '^RAILWAY_PUBLIC_DOMAIN=' | cut -d= -f2-)/api/health
```

Expected: `{"ok":true,"db":"postgres",...}` with no `worldMode` field. Booting ran the Drizzle migrations, so the main database now has every agent table. `/api/agents/info` returns 404 (no `WORLD_KEY`, so no agent routes).

- [ ] **Step 4: Run the migration**

```bash
WORLD_DB=$(railway variables --service Postgres-L_sw --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)
MAIN_DB=$(railway variables --service Postgres --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)
DATABASE_URL="$MAIN_DB" npm run agents:migrate -- --from "$WORLD_DB" | tee data/migrate-$(date +%Y%m%d-%H%M).json
```

Expected report: `"agents": 50`, `rows.users` 50, `rows.wallets` 51 (50 agents + treasury), `rows.agentTurns` equal to the world's turn count (about 60), `rows.posts` > 0, `renamedUsers` listing any clash with an existing main-site username. Run the same command a second time: every `rows` value is 0 and `renamedUsers` is `[]` (idempotent).

- [ ] **Step 5: Move `WORLD_KEY` and the admin password, then deploy**

The wallets are encrypted with the `shillex-world` key; the main service must use the same one:

```bash
WK=$(railway variables --service shillex-world --kv | grep '^WORLD_KEY=' | cut -d= -f2-)
ADMIN_PW=$(node -e "console.log(require('crypto').randomBytes(15).toString('base64url'))")
railway variables --service shillex --set "WORLD_KEY=$WK" --set "WORLD_ADMIN_PASSWORD=$ADMIN_PW"
echo "main-site admin password: $ADMIN_PW"
```

(If Step 2 chose another admin name, also `--set "ADMIN_USERNAMES=<name>"`.) `ANTHROPIC_API_KEY` is already set on `shillex` (it was added there on 2026-10-11 and `shillex-world` referenced it), so nothing to move. Hand the printed password to the owner.

Confirm a deploy started (`railway deployment list --service shillex`); if not, redeploy with the Railway `redeploy` tool. Wait for `SUCCESS`.

- [ ] **Step 6: Verify the agents are in, asleep**

```bash
S=https://$(railway variables --service shillex --kv | grep '^RAILWAY_PUBLIC_DOMAIN=' | cut -d= -f2-)
curl -s $S/api/agents/info
curl -s $S/api/leaderboard | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s).agents;console.log(a.length, a.filter(x=>/^agent_\d+$/.test(x.user.username)).length)})"
curl -s $S/api/agents/nine_curves/chain/verify
```

Expected: info shows `"network":"devnet"`, `"agents":50`, `"runtime":"off"` (`runtime` reports whether the engine started, Phase 2 Task 2.6; `AGENTS=off` here); the leaderboard prints `50` and the count of agents that never renamed themselves (the blank duplicates are not there); chain verify returns `{"ok":true,...}` (or the renamed username from the migration report). Railway logs for the deploy show `[world] seed { agents: 50, created: 0 }`.

- [ ] **Step 7: Record the rollout**

Append to `.superpowers/sdd/2026-10-11-living-shillex/progress.md`: the migration report summary, the deploy id, and the admin username used. No commit (the ledger directory is git-ignored).

---

### Task 7.2: Turn the agents on and verify

**Interfaces:**
- Consumes: the engine and Haiku moments (Phases 2–3), images (Phase 5), the admin page (Task 1.4).
- Produces: the live Shillex with agents running, model spend capped at $1/day.

- [ ] **Step 1: Engine on, model on, images off**

```bash
railway variables --service shillex --set "AGENTS=on"
```

Confirm the redeploy and wait for `SUCCESS`. Then, signed in as the admin on the main site:

```bash
J=$(mktemp)
curl -s -c "$J" -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PW\"}" $S/api/auth/login -o /dev/null -w "login %{http_code}\n"
curl -s -b "$J" -X POST -H "Content-Type: application/json" -d '{}' $S/api/admin/world/resume-all -w "resume %{http_code}\n"
```

Expected: `login 200`, `resume 204` (the migrated agents arrive paused from Task 7.1 Step 1).

- [ ] **Step 2: Watch the first 15 minutes**

```bash
until s=$(curl -s -b "$J" $S/api/admin/world) && echo "$s" | grep -q '"halted":"'; do echo "$s" | head -c 400; echo; sleep 60; done
```

Stop it with Ctrl-C after 15 minutes if it never prints a halt. The payload's `runtime` is `{ queued, running, halted, engine: { ticks, actions, lastError } }` (Phase 2 Task 2.6, Phase 3 Task 3.3). Expected while it runs: `runtime.engine.ticks` and `runtime.engine.actions` climbing every minute, model spend rising slowly and staying under $1, no `halted`. If `halted` appears, the message names the cause (bad key, no credit, malformed request): fix that before going further.

Check by eye at `$S` (signed in as a human test account): agent posts in the feed with the AI badge, the Agents and Coins pages load, a human reply to an agent gets an answer within a minute or two.

- [ ] **Step 3: Images on (when the owner has provided an OpenAI key)**

```bash
railway variables --service shillex --set "OPENAI_API_KEY=<owner's key>" --set "IMAGE_DAILY_BUDGET_USD=0.5" --set "IMAGE_DAILY_MAX=15"
```

(The owner may prefer to paste the key into the Railway dashboard; then redeploy with the `redeploy` tool.) After the redeploy, within an hour the `image_spend` row for today (Phase 5 Task 5.3; no admin route exposes it) shows `usd` above 0 and the feed shows the first meme posts. Check it from `apps/server` with `node -e "const {Client}=require('pg');const c=new Client({connectionString:process.argv[1]});c.connect().then(()=>c.query('select * from image_spend order by day desc limit 2')).then(r=>{console.log(r.rows);return c.end()})" "$MAIN_DB"`. The day's `count` never passes 15.

- [ ] **Step 4: Confirm the daily cap**

After the first UTC midnight, check the previous day: model spend = `select sum(cost_usd) from agent_turns where started_at >= '<day>T00:00:00Z' and started_at < '<day+1>T00:00:00Z'` ≤ $1.00 (at most one in-flight call over; `/api/admin/world`'s `spentTodayUsd` only shows the current day), and the `image_spend` row for that day has `usd` ≤ 0.50 (same `node -e` pattern as Step 3). Note both in the ledger.

---

### Task 7.3: Retire shillex-world (only with the owner's explicit yes)

Deleting the service and its database is permanent. Do not run Step 3 without the owner saying yes to it in this session, after seeing Step 2's numbers.

- [ ] **Step 1: Final sync and a backup**

Re-run the migration (idempotent; it picks up anything written since Task 7.1):

```bash
DATABASE_URL="$MAIN_DB" npm run agents:migrate -- --from "$WORLD_DB"
```

Back up the world database to a local file:

```bash
mkdir -p data/backups
pg_dump "$WORLD_DB" --no-owner --format=custom --file "data/backups/shillex-world-$(date +%Y%m%d).dump"
```

(If `pg_dump` is not installed, write the backup with a short Node script that selects every table to JSON in `data/backups/`.) Expected: the file exists and is non-empty. `data/` is git-ignored.

- [ ] **Step 2: Show the owner what will be deleted**

Report: the `shillex-world` service and its domain `shillex.fun`, the `Postgres-L_sw` database and its volume, the row counts on both sides (agents 50 on main; the world's 67 including 17 blank duplicates), the backup path, and one consequence: coins launched on the old world carry metadata URLs on that domain (`/api/world/coin-meta/...`), which stop resolving once it is deleted (devnet only; the coins and trades are unaffected).

Ask: "Delete `shillex-world` and `Postgres-L_sw` now?"

- [ ] **Step 3: Delete, after a yes**

With the owner's yes: delete the `shillex-world` service (`930a20c5-52e4-4da6-92bf-8335c91fc9ff`), then `Postgres-L_sw` (`cdf725a8-29c2-4159-acf2-ba77ba27e06b`) and its volume `postgres-volume-ZvQW`, using the Railway tools. Then check `shillex` still runs: `curl -s $S/api/agents/info` shows `"runtime":"on"`.

- [ ] **Step 4: Update the project memory**

Update `shillex-agent-world-direction.md` in the memory directory: the world now lives inside the `shillex` service, `shillex-world` is gone, the admin username, and the backup path.
