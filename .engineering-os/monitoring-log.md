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

## Pass 2 — 2026-05-29 ~18:01Z — clean
All 4 containers healthy, 0 restarts. Resources nominal (CH ~949MB, gateway ~177MB, web ~138MB, PG ~27MB). No genuine errors in gateway/web logs. Endpoints OK: gateway /health 200, /auth/login 200, /auth/sign-up 200, /onboarding+/dashboard (unauth) → /auth/login. PG + CH ping OK. No new authenticated-user activity (post-fix; 4c1f… user has not retried). SessionBootstrap fix (231f09c) deployed and stable.

## Pass 3 — 2026-05-29 ~18:21Z — clean
All 4 healthy, 0 restarts. No genuine errors. Endpoints OK (health 200, login/sign-up 200, onboarding+dashboard→login). PG+CH ping OK. No authed activity. CH mem ~995MB (normal idle merge baseline, not flagged).

## Monitoring stopped — 2026-05-29 ~18:25Z
Stopped on Founder request after Pass 3. Cron 7469e80f cancelled; no scheduled jobs remain. Summary: 3 passes; 1 real bug found+fixed (no-membership login loop, 231f09c) + 2 clean. Stack left running and healthy.
