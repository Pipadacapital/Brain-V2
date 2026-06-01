# Brain — design-conformance suite (LLD §7)

A required-CI gate that asserts Brain's **architectural invariants** against on-disk
truth. A single blocking `FAIL` means **"not as per design"**, printed with the
`file:line` that drifted. Deterministic, pure-stdlib, `@paradigm: sql` (zero LLM,
zero network). This is the product analogue of the Engineering OS's own
`paradigm_check`/parity gates — but for Brain, the product.

## Run

```bash
python tests/conformance/run_conformance.py                 # static checks (default)
python tests/conformance/run_conformance.py --with-behavioral  # + run C4/C5/C8 commands
python tests/conformance/run_conformance.py --json          # machine-readable
```

Exit `0` if no blocking `FAIL`, else `1`. `WARN` (advisory) and `SKIP` never fail CI.

## The invariants (C1–C14)

These were ratified by the architect on 2026-06-01 to assert Brain's **actual,
evolved** invariants — not the literal LLD table names (which the
`integration-extensible-schema` decision superseded; see
`docs/lld-amendment-2026-06-01.md`). The manifest is `conformance.yaml`; the
authoritative executor is `run_conformance.py`.

| ID | Invariant | Kind | Blocking |
|----|-----------|------|----------|
| C1 | Money is integer minor-units (no float/NUMERIC) | static | yes |
| C2 | Every CH table `ORDER BY` leads with `workspace_id` | static | yes |
| C3 | Every workspace-scoped PG table has fail-closed RLS | static | yes |
| C4 | CH query gateway is fail-closed (`UnscopedQueryError`) | behavioral | yes |
| C5 | Metric registry TS↔Python byte-parity | behavioral | yes |
| C6 | `ai.decision_log` is append-only (BEFORE UPDATE trigger raises) | static | yes |
| C7 | `ai.decision_log` idempotency key | static | yes |
| C8 | `@paradigm` gate enforced at runtime | behavioral | yes |
| C9 | LLM access is LiteLLM-gateway-only | static | yes |
| C10 | Pagination is cursor-only (OFFSET banned) | static | yes |
| C11 | DDD layering — no `controllers/models/managers/helpers` dirs | static | yes |
| C12 | No cross-service DB read | static | **advisory** |
| C13 | Cross-brand memory k-anonymity (`brand_count >= 5`) | static | yes |
| C14 | Single pgvector opclass (cosine) + decision_log correlation quad | static | yes |

`behavioral` checks (C4/C5/C8) register existing killed-mutant tests; they `SKIP`
unless `--with-behavioral`, but `FAIL` if the registered target has been deleted.
`C12` is advisory (convention-enforced) until per-service Postgres GRANTs land
(roadmap Phase A4), then flip `blocking: true`.

## Non-vacuity

Every check must fail when its invariant is removed. The suite proved this on its
first run by catching genuine drift (see below) — it is not a rubber stamp. When
adding a check, include the negative control in its docstring (e.g. "drop the RLS
policy → C3 goes red").

## Known drift (caught by this suite, pending disposition)

- **C10 — OFFSET pagination (RED).** `apps/core-service/src/application/contexts/`
  `product-cogs/product-cogs-use-cases.ts` and `store-browser/store-browser-use-cases.ts`
  use `LIMIT … OFFSET` for page-number table UIs. This violates the canon's
  OFFSET-ban. Disposition (keyset conversion vs. a documented bounded-admin
  exception) is a Founder/architect decision, tracked separately. Until resolved,
  C10 keeps the gate red — which is the honest state: there is real drift to fix
  before this gate can be wired blocking in CI.

## Wiring into CI (roadmap Phase A3)

Add a job that runs `python tests/conformance/run_conformance.py --with-behavioral`
on every PR, alongside `tools/check-metrics-parity.sh`. Gate is green once the C10
drift is dispositioned.
