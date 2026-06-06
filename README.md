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

### One command (recommended)
After the one-time prerequisite below (`.env.docker`):
```bash
make up          # or: ./scripts/dev-up.sh
```
Idempotent — it ensures the data volumes exist, starts the DBs, bootstraps the
schema **only if it doesn't already exist** (`scripts/bootstrap-db.sh`), builds +
starts the app, and waits for `/ready`.
Other shortcuts: `make down`, `make logs` (`make logs S=web`), `make ps`, `make ready`.

The manual equivalents are documented below if you want to run the steps yourself.

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

# 2. Bring up the databases. On a FRESH volume the compose mounts auto-apply the
#    consolidated bootstrap (infra/bootstrap/bootstrap-pg.sql + bootstrap-ch.sql)
#    via each image's docker-entrypoint-initdb.d — roles + full schema + RLS.
docker compose --env-file .env.docker up -d postgres-dev clickhouse-dev

# 3. (Belt-and-suspenders) ensure the schema exists — idempotent, sentinel-gated.
#    Safe no-op if the volume was already bootstrapped. This is the single
#    schema-creation path (the per-migration pipeline has been retired).
bash scripts/bootstrap-db.sh

# 4. Bring up the app
docker compose --env-file .env.docker up -d --build api-gateway web
```

> **Schema source of truth:** `infra/bootstrap/bootstrap-pg.sql` (OLTP) +
> `infra/bootstrap/bootstrap-ch.sql` (OLAP), applied by `scripts/bootstrap-db.sh`
> (run automatically by `make up`). The optional Decision-Log / Memory-Layer
> schema (`bootstrap-pg-ai.sql`) is applied only where pgvector is available.
>
> **Data note:** a fresh DB has the *schema* but no rows — the app shows honest-empty
> workspaces. Data is populated going forward by the connectors + webhooks. For UI
> exploration without real data, set `BRAIN_GATEWAY_LOCAL_HARNESS=true` on the gateway
> to serve the in-memory demo plane.

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
