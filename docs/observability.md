# Observability — End-to-End Tracing in Brain

> One correlation ID 4-tuple flows browser → web → api-gateway → core → DB.
> If you can't trace a user action by `request_id`, the chain is broken — fix it.

## The 4-tuple

| Field | Header | Purpose | Source |
|---|---|---|---|
| `request_id` | `x-request-id` | One per HTTP request | First hop (browser tRPC client or Next middleware) mints; downstream hops propagate |
| `trace_id` | `x-trace-id` | Span across one user-action (multiple requests) | First hop mints; downstream propagate |
| `workspace_id` | `x-brain-workspace` | The workspace the request operates on | Set by the authed client; gateway VALIDATES against JWT membership before honoring |
| `user_id` | `x-brain-user` (server-internal) | Verified `sub` (NEVER email/phone) | Set by the gateway AFTER JWT verify; never trusted as input |

Every log line on every hop carries the relevant subset of these four. PII (email, phone, full name) **never** appears in correlation headers or log lines — the shared logger (`packages/lib-logger`) redacts at the canonical paths.

## How to trace one user action end-to-end

### Browser (DevTools)

1. Open the page you want to trace (e.g. `/dashboard`)
2. Open DevTools → Console. Set `localStorage.setItem('brain.log_level', 'debug')` then refresh
3. Each tRPC call emits a `trpc call` JSON line with `request_id` + `trace_id`
4. Network tab → click the request → Response Headers → `x-request-id`, `x-trace-id` are stamped

### Web middleware (Next.js stdout)

```
{
  request_id: '54f453f6-48bf-4d27-843b-4a7315646af8',
  trace_id: 'e78a73a2-895f-4f69-8066-3bfd91f280af',
  route: '/dashboard',
  method: 'GET'
} { duration_ms: 1, decision: 'pass', authenticated: true, user_id: '4c1fb1d6-...' } 'middleware: pass'
```

In production (`next start`) this lands as raw JSON. In `next dev` it's pretty-printed by Next.js but the underlying pino output is still JSON-shaped.

### API Gateway (Fastify + pino → JSON stdout)

```json
{"level":30,"time":"2026-05-26T11:52:17.394Z","service":"api-gateway","pid":16024,"reqId":"54f453f6-...","request_id":"54f453f6-...","trace_id":"e78a73a2-...","route":"/trpc/workspace.list","method":"GET","msg":"gateway request"}
```

After JWT verify, subsequent lines also carry `workspace_id` and `user_id`:

```json
{"level":50,"time":"...","service":"api-gateway","request_id":"54f453f6-...","trace_id":"...","workspace_id":"...","user_id":"...","trpc_path":"workspace.list","code":"UNAUTHORIZED","msg":"tRPC procedure error"}
```

### Grep one request across all services

```bash
# Local
grep '"request_id":"54f453f6"' /tmp/api-gateway.log /tmp/web.log

# Docker (Phase 2)
docker compose logs --no-color | grep '"request_id":"54f453f6"'

# Prod (Phase 4+): Fluent Bit → OpenSearch
# Kibana → filter request_id:54f453f6
```

## Log levels

Set per service via `LOG_LEVEL` env (default `info`).

| Level | When to use |
|---|---|
| `debug` | Per-query SQL, per-decision-step traces, browser tRPC call emissions |
| `info` | Per-request lifecycle (request received, request completed, auth pass, redirect) |
| `warn` | Recoverable problems (refresh-token-not-found, slow query, retry triggered) |
| `error` | Procedure failure, 5xx, anything that woke a user |
| `fatal` | Service boot failed, unrecoverable corruption |

Browser-side: `localStorage.setItem('brain.log_level', 'debug')` toggles client-side debug emissions. Defaults to `info`.

## PII redaction (canonical)

The shared logger (`packages/lib-logger/src/redact-paths.ts`) carries the canonical paths replaced with `[Redacted]` before any log line is serialized. The list covers:

- HTTP `Authorization`, `Cookie`, `x-supabase-auth`, `x-api-key` headers + `set-cookie` response header
- Supabase / OAuth tokens at any nesting (`access_token`, `refresh_token`, `id_token`, including `*.access_token`)
- Vendor OAuth credentials in connector flows (`credential.content`, `connector.credentials`)
- Customer PII: `email`, `firstName`, `lastName`, `phone`, `shipping_address`, `billing_address`
- Webhook + signing secrets: `SHOPIFY_CLIENT_SECRET`, `META_APP_SECRET`, `GOOGLE_ADS_CLIENT_SECRET`, `*.client_secret`, `webhook_secret`
- DB / env leaks: `DATABASE_URL`, `SUPABASE_ANON_KEY`, `CONNECTOR_CUSTODY_KEY`, `password`

**To add a new redact path:** edit `packages/lib-logger/src/redact-paths.ts`. Adding it per-service is forbidden — the guarantee must be uniform across the stack.

## Per-procedure logging (every API call traced)

The api-gateway's tRPC layer runs a tracing middleware on every procedure
(public → identity → authed → workspace tiers). Every API call emits a
`procedure done` log line — info on success, warn on caller errors (UNAUTHORIZED,
FORBIDDEN, NOT_FOUND, BAD_REQUEST, etc.), error on server errors.

Example output for `metrics.kpiSummary` (workspace tier, success):
```json
{
  "level": 30, "time": "...", "service": "api-gateway", "component": "trpc",
  "trpc_path": "metrics.kpiSummary", "trpc_type": "query",
  "request_id": "...", "trace_id": "...", "workspace_id": "...", "user_id": "...",
  "ok": true, "duration_ms": 41,
  "msg": "procedure done"
}
```

To see procedure-entry (debug-level) lines in addition, set `LOG_LEVEL=debug`.

Filter the log to one user's actions:
```bash
grep '"user_id":"4c1fb1d6-..."' /tmp/api-gateway.log | grep '"procedure done"' | jq .
```

Filter to one slow workspace:
```bash
grep '"workspace_id":"<ws>"' /tmp/api-gateway.log | jq 'select(.duration_ms > 500)'
```

## Per-package logging (which package failed?)

`@brain/lib-logger` exports `packageLogger(service, pkg)` that returns a pino
logger with `package: '<pkg>'` bound. Every `@brain/core-*` module is expected
to declare one at the top of its main module so failures pin themselves to a
specific package within the api-gateway service.

```ts
// apps/core-service/src/application/onboarding/onboarding-use-cases.ts
import { packageLogger } from '@brain/lib-logger';
const log = packageLogger('api-gateway', 'core-onboarding');

export async function resolveMembership(sub: string) {
  const fn = 'resolveMembership';
  const t0 = Date.now();
  try {
    const result = await db.query(...);
    log.debug({ fn, sub_prefix: sub.slice(0, 8), found: result !== null,
                duration_ms: Date.now() - t0 }, 'resolveMembership done');
    return result;
  } catch (err) {
    log.error({ fn, err, sub_prefix: sub.slice(0, 8),
                duration_ms: Date.now() - t0 }, 'resolveMembership failed');
    throw err;
  }
}
```

Output shows `package` + `fn`:
```json
{ "level": 20, "service": "api-gateway", "package": "core-onboarding",
  "fn": "resolveMembership", "sub_prefix": "4c1fb1d6", "found": true,
  "duration_ms": 12, "msg": "resolveMembership done" }
```

### Currently wired
- `core-onboarding` (`onboarding-use-cases.ts`) — `resolveMembership` + `listWorkspaces` wrapped with full debug/error logging
- `core-notifications` (`notifications-use-cases.ts`) — package logger bound; extend per-function as needed
- `core-connectors` (`connector-use-cases.ts`) — package logger bound; **OAuth-token safety: NEVER log the token value, only shapes** (vendor, workspace_id prefix, error code, duration_ms). The redact list backstops, but don't rely on it

### To wire a new package
1. Add `@brain/lib-logger: workspace:*` to the relevant app's `package.json`
2. At the top of the module: `const log = packageLogger('<service>', '<package>');`
3. Wrap functions with `try { log.debug(...); return ... } catch (err) { log.error({err, ...}, '... failed'); throw err }`
4. NEVER include raw PII (email, phone, full names, tokens) in log fields — use prefixes (e.g. `sub_prefix: sub.slice(0, 8)`)

### Per-request correlation in package logs
The package logger does NOT auto-bind `request_id` / `trace_id` today (no
AsyncLocalStorage yet). When a package function is called from a tRPC procedure
and you want the per-request IDs in its logs, pass the per-request logger from
the caller:

```ts
// caller (tRPC procedure)
import { trpc } from '@/application/trpc';
const myProc = workspaceProc.query(async ({ ctx }) => {
  // ctx.requestId / ctx.traceId are available; thread to the function
  return doWork(ctx.requestId, ctx);
});

// callee uses both the package logger AND the per-request fields
async function doWork(requestId: string, ctx: ...) {
  log.info({ fn: 'doWork', request_id: requestId, workspace_id: ctx.workspaceId }, 'doing work');
}
```

A follow-up requirement may add `AsyncLocalStorage` to lib-logger so every
`packageLogger` call auto-binds the correlation 4-tuple without threading.

## Adding logging to a new TS service

```ts
import { createLogger, extractCorrelation } from '@brain/lib-logger';

const log = createLogger('your-service-name');

// Per-request: extract correlation from incoming headers and bind to a child logger
const correlation = extractCorrelation(req.headers);
const reqLog = log.child({
  request_id: correlation.request_id,
  trace_id: correlation.trace_id,
});

reqLog.info({ route: req.url, method: req.method }, 'request received');
```

For outgoing calls to another service, propagate the correlation:

```ts
import { buildCorrelationHeaders } from '@brain/lib-logger';

const outgoing = buildCorrelationHeaders(correlation);
await fetch(downstreamUrl, { headers: outgoing });
```

## What NOT to log

- Raw email, phone, full names (use `user_id` = the verified `sub`)
- Authorization headers, OAuth tokens, refresh tokens, session cookies (redact list covers these but don't deliberately include them)
- Full SQL queries with PII in `WHERE` clauses (parameterize first; log `query_name` not the raw SQL with values)
- Customer credit card / UPI / bank fields (Brain never stores these; logging would compound the violation)

## Production envelope (Phase 2+, planned)

- All services emit JSON to stdout
- Fluent Bit DaemonSet on EKS tails container stdout
- Ship to OpenSearch (logs) + CloudWatch Metrics + AWS X-Ray (traces) + Sentry (errors)
- Single Kibana dashboard pivoting on `request_id` shows every hop of a user action
- Per-service retention: 30 days hot, 90 days warm, 1 year cold

The wire format is the SAME as today's local stdout output — only the transport changes. So a correlation pattern that works locally will work in prod without code changes.
