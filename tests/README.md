# tests — cross-service / end-to-end suites

Per the Brain spec, repo-wide test suites live here. Unit + contract tests stay co-located
with their service (`apps/<svc>/src/**/*.test.ts`, `apps/<svc>/tests/`, `__tests__/`) and are
run by `turbo run test`. This directory is reserved for tests spanning more than one service:

```
tests/
├── e2e/            # Playwright (web) + Detox (mobile) full-journey flows
├── contract/       # cross-service gRPC/proto contract tests (Pact-style)
├── integration/    # multi-service docker-compose scenarios
└── load/           # k6 load + soak
```

Current state (Phase 0–1): cross-service coverage runs via per-service integration tests + the
live docker-compose smoke. True cross-service e2e/contract suites move here as the 7-service split lands.
