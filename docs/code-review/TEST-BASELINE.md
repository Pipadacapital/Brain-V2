# Code-Review Cleanup — Green Test Baseline

Captured 2026-06-03 on `chore/code-review-cleanup` @ `development` HEAD (8c7f143),
BEFORE any cleanup. Every cleanup commit MUST keep these green (no functionality impact).

| Suite | Command | Result |
|---|---|---|
| api-gateway | `pnpm test` | 424 passed |
| core-service | `pnpm test` | 339 passed, 42 skipped |
| web | `pnpm test` | 850 passed (51 files) |
| analytics-service | `uv run pytest` | 321 passed |
| intelligence-service | `WORKDIR=src uv run pytest` | 289 passed |
| ingestion-service | `uv run pytest` | 332 passed, 14 skipped |

**Total: ~2,555 passing.**

Note: the `apps/web` suite flaked once (non-deterministic failure, passed on re-run) —
flagged as a QA finding (flaky/timing-sensitive test to stabilize).
