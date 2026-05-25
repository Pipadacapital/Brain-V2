# api-gateway — LOCAL Run Harness (Phase-0)

## Boot

```bash
# Terminal 1: api-gateway BFF (Phase-0 stub, no external deps)
cd apps/api-gateway && pnpm dev
# Fastify + tRPC on :3001; StubDataPlane serves Sugandh-Lok seed data

# Terminal 2: web frontend
cd apps/web && pnpm dev
# Next.js 16 + Turbopack on :3000

# Open: http://localhost:3000/login
# Credentials: founder@sugandhlok.com / brain-local-dev  (Phase-0 stub — remove at auth cutover)
# Expect: "18.50 L" Net Revenue, "3.20 L" CM2, "2.85x" ROAS, "1,247" orders
# All values come from StubDataPlane — deterministic seed, not hand-typed UI numbers.
```

The `pnpm dev` script runs `tsx src/interfaces/server.ts`.  No Redis, no Docker, no
Python process needed for Phase-0.  The `StubDataPlane` serves the full
Sugandh-Lok seed through the real `DataPlanePort` contract.

---

## Architecture (Phase-0 vs Phase-2)

| Layer | Phase-0 (now) | Phase-2 (config flip) |
|---|---|---|
| Data plane | `StubDataPlane` (in-process, deterministic) | `LoopbackDataPlane` (gRPC to Python analytics/intelligence) |
| Idempotency | `InMemoryIdempotencyStore` | `ioredis.Redis` (REDIS_URL env var) |
| Auth | Local stub claim from request headers | JWT verification + membership DB lookup |
| gRPC metadata | Not propagated (no network boundary) | `buildGrpcMetadata()` from `tenancy.ts` wired into `LoopbackDataPlane` |

The Phase-2 split is a config flip, not a rewrite — `DataPlanePort` is the seam
(`src/domain/proto-types.ts`).

---

## M2 — gRPC boundary correlation 4-tuple (tech-debt, Phase-2)

**Status:** Deferred per plan §2 + SEC-C6-M1. Not a current gap.

The correlation 4-tuple (`request_id`, `trace_id`, `workspace_id`, `user_id`) IS
propagated through the in-process path:
- Every `WorkspaceContext` carries `requestId` + `traceId`.
- Every success response body includes `request_id: ctx.requestId`.
- Every error response includes `requestId: ctx.requestId` (via `errorFormatter`).
- `buildGrpcMetadata(ctx)` in `tenancy.ts` serialises the quad into
  `x-workspace-id / x-request-id / x-trace-id / x-user-id` headers.

What is NOT yet exercised: `buildGrpcMetadata` is never called because there
is no gRPC network boundary in Phase-0.  The Python handlers in
`analytics-service/src/interfaces/` and `intelligence-service/src/interfaces/`
are empty stubs (V4 deferral per architecture plan §2).

**What must happen at Phase-2 cutover:**
1. Wire `buildGrpcMetadata(ctx)` into `LoopbackDataPlane` on every gRPC call.
2. Implement the Python gRPC handlers to read `x-workspace-id` / `x-request-id`
   from the gRPC metadata and propagate to the Python correlation context.
3. Add a real-network smoke test that starts both the Node gateway and the Python
   gRPC server and asserts the headers arrive in the Python handler.

The absence of this wire does NOT affect Phase-0 correctness — `StubDataPlane`
is in-process and the 4-tuple is present on every context object.

---

## M3 — Visx Number(_mu) pixel-math invariant (tech-debt, display only)

**Status:** Documented. Not a display-fidelity failure for current seed values.

`cm-waterfall-chart.tsx` converts `step.cumulative_mu` and `step.value_mu` to
`Number()` for SVG pixel-coordinate math only (Visx `yScale` domain).  The
comment in the file explicitly marks these as `cumulativePx`/`valuePx` — NOT
for display.  The display path uses `formatMoney(bigint, ...)` throughout.

**The `< 2^53` assumption:** for INR values the safe threshold is
`2^53 paise = 9_007_199_254_740_992 paise ≈ ₹90,071 crore`.  Sugandh-Lok
seed values (max ₹18.5L = 185_000_000 paise) are far below this.  For a
brand to exceed this threshold it would need ≈ ₹90,000 crore total pipeline —
beyond any DTC brand on this platform.

**What to do if this is ever a concern:**
- Clamp the yScale domain input:
  ```ts
  const safePx = (mu: bigint) => Number(mu > BigInt(Number.MAX_SAFE_INTEGER)
    ? BigInt(Number.MAX_SAFE_INTEGER)
    : mu);
  ```
- Or switch Visx to a BigInt-capable scale (not currently available upstream).

The display invariant is not affected: `formatMoney` never calls `Number(mu)`.

---

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `GATEWAY_PORT` | `3001` | Port the Fastify server listens on |
| `GRPC_METRICS_ADDR` | (Phase-2 only) | analytics-service gRPC address |
| `GRPC_INTELLIGENCE_ADDR` | (Phase-2 only) | intelligence-service gRPC address |
| `REDIS_URL` | (Phase-2 only) | ioredis connection string |
| `LOG_PRETTY` | (unused) | Reserved for future pino-pretty toggle |
