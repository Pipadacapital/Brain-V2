# Live Local Stack — Monitoring Log

Monitoring the running local stack (`docker compose`): postgres-dev, clickhouse-dev, api-gateway, web.
Each pass: container health/restarts, resource usage, error/warn log scan, endpoint probes, DB/CH ping. Fix anything broken.

---

## Pass 1 — 2026-05-29 ~17:50Z

**Stack:** all 4 containers healthy, 0 restarts. Resource use nominal (CH ~940MB/12%, gateway ~188MB, web ~124MB, PG ~32MB). PG + CH ping OK.

**Findings:**
- 🔴 **FIXED — no-membership login loop.** Logs showed a real verified Supabase user (`sub 4c1f…`) hitting `auth.session` (workspace tier) → `UNAUTHORIZED` twice, 4s apart. Root cause: `SessionBootstrap` treated *any* `auth.session` error as "invalid session" → `signOut` → `/login`, so a verified user with no workspace looped login→shell→signout→login and never reached `/onboarding`. Fix: on session error, probe identity-tier `user.me`; `needsOnboarding` → `/onboarding`, genuine identity failure → `signOut`+`/login`. File: `apps/web/src/interfaces/components/auth/session-bootstrap.tsx`. Test: `apps/web/src/test/session-bootstrap.test.tsx` (4 cases). tsc clean; web image rebuilt + redeployed (healthy).
- ✅ **Not a bug — `/auth/signup` 404.** My probe used the wrong path; the real route is `/auth/sign-up` (200). Corrected the probe.
- ℹ️ Expected log noise: `auth verify rejected (missing_token)` + `UNAUTHORIZED` on unauthenticated probes — correct fail-closed behavior, not errors.

**Verification after fix:** `/auth/login` 200, `/auth/sign-up` 200, `/onboarding` (unauth) → `/auth/login`. All containers healthy.
