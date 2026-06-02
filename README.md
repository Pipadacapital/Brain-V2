# Brain

AI-native commerce analytics OS for Indian DTC brands. Monorepo: `apps/` (web,
mobile, api-gateway, core-service, Python ingestion/analytics/intelligence
services) + `packages/` (shared TS libs).

This README covers two things:
1. **Run the app locally** in Docker (Postgres + ClickHouse + API gateway + web).
2. **Set up the Engineering OS** (the Claude Code agent pipeline) on a new developer's machine.

---

## 1 · Run the app in Docker

The whole stack is `docker-compose.yml` at the repo root: `postgres-dev` (OLTP),
`clickhouse-dev` (OLAP), `api-gateway` (Fastify + tRPC), `web` (Next.js).

### Prerequisites
- Docker Desktop (or Docker Engine + Compose v2) running.
- Node 24 + pnpm 11 (only needed to run tests / migrations tooling on the host).
- `.env.docker` at the repo root — copy the template and fill it:
  ```bash
  cp .env.docker.example .env.docker
  # fill: SUPABASE_URL + SUPABASE_ANON_KEY + NEXT_PUBLIC_SUPABASE_URL +
  # NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, OAuth client ids/secrets,
  # CONNECTOR_CUSTODY_KEY. (Secrets are NEVER committed.)
  ```

### A · Machine that already has the data volumes (common case)
The fact data + workspaces live in two **external** Docker volumes
(`core-service_brain-pgdata-dev`, `analytics-service_brain-chdata-dev`). If they
already exist (`docker volume ls | grep brain`), just bring everything up:

```bash
docker compose --env-file .env.docker up -d --build
```

> **Always pass `--env-file .env.docker`.** Compose interpolates the web build-args
> (`NEXT_PUBLIC_SUPABASE_*`) from it; without the flag they're blank and `next build` fails.

### B · Fresh machine (no volumes yet)
```bash
# 1. Create the two external volumes (compose expects them to pre-exist)
docker volume create core-service_brain-pgdata-dev
docker volume create analytics-service_brain-chdata-dev

# 2. Bring up just the databases first (initdb only creates the rls_app /
#    per-service roles — it does NOT build the schema)
docker compose --env-file .env.docker up -d postgres-dev clickhouse-dev

# 3. Apply the Postgres schema migrations IN ORDER (postgres superuser),
#    skipping any *down*/rollback files:
for f in $(ls apps/core-service/migrations/local-dev/[0-9]*.sql | grep -v down | sort); do
  echo "applying $f"; docker exec -i brain-postgres-dev psql -U postgres -d brain_dev -v ON_ERROR_STOP=1 < "$f" || break
done

# 4. Apply the ClickHouse fact migrations (0003 → 0011; skip 0001/0002 — the
#    legacy MV uses toDaysInMonth which CH 24.8 lacks):
for f in $(ls apps/analytics-service/migrations/clickhouse/000[3-9]*.sql apps/analytics-service/migrations/clickhouse/001[0-1]*.sql | sort); do
  echo "applying $f"; docker exec -i brain-clickhouse-dev clickhouse-client --user brain_app --password brain_app_pw --multiquery < "$f" || break
done

# 5. Bring up the app
docker compose --env-file .env.docker up -d --build api-gateway web
```

> **Data note:** a fresh DB has the *schema* but no rows — the app shows honest-empty
> workspaces. Loading the real legacy data is a separate, Founder-gated step (needs the
> live Supabase pooler credentials + the FDW + the scripts in `tools/migrate-legacy/`:
> `*-backfill.sql`, `config-tables-backfill.sql`; clean up afterwards with
> `teardown-staging.sql`). For UI exploration without real data, set
> `BRAIN_GATEWAY_LOCAL_HARNESS=true` on the gateway to serve the in-memory demo plane.

### Verify it's up
```bash
docker compose ps                    # all 4 healthy
curl -s localhost:3001/health        # {"status":"ok",...}
curl -s localhost:3001/ready         # {"status":"ready","checks":{"postgres":true,"clickhouse":true}}
open http://localhost:3000           # web → redirects to /auth/login
```
- Web: http://localhost:3000 · API: http://localhost:3001 · PG: `localhost:5432` (`postgres`/`postgres`, db `brain_dev`) · CH: `localhost:8123` (`brain_app`/`brain_app_pw`, db `brain`).
- Logging in needs the Supabase project's Site URL = `http://localhost:3000` + redirect allow-list + a real account (Founder dashboard config).

### Common commands
```bash
docker compose --env-file .env.docker up -d --build api-gateway   # rebuild one service
docker compose logs -f api-gateway                                # tail logs
docker compose down                                               # stop (external volumes survive)
docker compose down -v                                            # stop; external volumes are NOT wiped
```

---

## 2 · Set up the Engineering OS (for other developers)

The Engineering OS is a **Claude Code plugin** (`brain-engineering-os`) — it provides
the agent pipeline (CTO Advisor "Rohan", Architect "Aryan", backend/frontend/QA/security
personas), the staged delivery workflow, and the guard hooks. It installs at the
**user (Claude Code) level**, separate from this repo.

### Prerequisites
- [Claude Code](https://claude.com/claude-code) installed and authenticated.
- Read access to the marketplace repo `Rishabhporwal/Engineering-OS`.

### Install
In Claude Code, run:
```
/plugin marketplace add Rishabhporwal/Engineering-OS
/plugin install brain-engineering-os@brain-engineering-os-marketplace
```
(Or use the interactive `/plugin` menu → *Marketplaces* → add `Rishabhporwal/Engineering-OS`
→ *Install* → `brain-engineering-os`.) Restart Claude Code if prompted.

### What you get
- **Agents** (subagents): `cto-advisor` (Rohan), `architect` (Aryan), `backend-developer`,
  `frontend-web-developer`, `mobile-developer`, `intelligence-engineer`, `qa-agent`,
  `security-reviewer`, `platform-devops`, `product-manager`, + the dynamic-persona generator.
- **Hooks** — e.g. the careful-SQL guard (blocks `DROP`/`TRUNCATE` unless you append
  `#careful-ok` or set `EOS_ALLOW_DESTRUCTIVE=1`), and the SessionStart recall that prints
  in-flight requirements + recent journal entries.
- **Slash commands / pipeline** — `/status`, `/recall <feat-slug>`, `/resume <req-id>`,
  `/test-pipeline --dry-run` (validate plugin health).

### Project-side config (ships with the repo — nothing to install)
Cloning Brain already gives you:
- `CLAUDE.md` — project instructions (auto-loaded by Claude Code), incl. the graphify rules.
- `.claude/settings.json` — the graphify PreToolUse hook.
- `.engineering-os/` — shared pipeline state (journals, monitoring log, lessons-learned, rule-proposals).

### Verify the install
```
/plugin                    # brain-engineering-os shows as installed/enabled
/test-pipeline --dry-run
/status                    # in-flight requirements
```
On the next session start you should see the `[engineering-os] === Session start ===`
banner with in-flight requirements + recent journal entries.

### Optional: graphify (codebase knowledge graph)
`CLAUDE.md` references a `graphify` CLI + `graphify-out/`. For scoped-subgraph codebase
queries (`graphify query "..."`), install graphify and run `graphify update .` to build
`graphify-out/`. Optional — the app + EOS work without it.
