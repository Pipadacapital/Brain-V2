# Live Reconciliation Runbook — HOLD-AT-LIVE-RECON

> **STATUS: HOLD-AT-LIVE-RECON. Do NOT execute any step until Stage-8 ceremony.**
>
> Named state: `HOLD-AT-LIVE-RECON` (mirrors Child-1's `HOLD-AT-FORCE`).
> Prerequisites: C5 RLS LIVE/FORCED + Child-3 connectors + Child-4 materialization.
> Authored: Child 2 (feat-money-minor-units-parity). Runs: future Stage-8 ceremony.

---

## Step 0 — Region assert

Confirm the Brain database is `ap-south-1` and that the workspace primary currency
resolves to a known `subunit_multiplier`. No cross-region read. CF-MAYA-2.

```python
# Pseudocode — do not execute until Stage 8
assert db_region == "ap-south-1"
assert subunit_multiplier(workspace.primary_currency) in {1, 10, 100, 1000}
```

---

## Step 1 — Precondition gate (all must be True)

Before starting the live run:

- [ ] `feat-tenancy-rls-brain-native` status = **LIVE/FORCED** (not SATISFIABLE)
- [ ] Child-3 connectors populated: `SELECT COUNT(*) FROM shopify_orders WHERE workspace_id = ?` > 0 in Brain
- [ ] Child-4 metric materialization: `shadow_workspace_daily_metrics` has rows for the target workspace
- [ ] `tools/check-metrics-parity.sh` exits 0 on the golden fixtures (CI green)
- [ ] Founder has given explicit "run live reconciliation for workspace_id=?"

If any check fails: STOP. Do NOT proceed.

---

## Step 2 — Re-point harness at live data

Update `harness.py` `run_harness()` to accept a live fixture builder:

```python
# Pseudocode — implement at Stage 8 under Founder supervision
def build_live_fixtures(workspace_id: str, date_range: tuple[str, str]) -> list[dict]:
    # Read legacy Postgres: SELECT field, value FROM workspace_daily_metrics
    #   WHERE workspace_id = ? AND date BETWEEN ? AND ?
    # Under the C5 RLS session context (set_workspace_context(workspace_id))
    # Build fixture dicts in the same shape as golden_fixtures.json
    ...
```

The harness engine itself is unchanged — only the fixture source is different.

---

## Step 3 — Per-(workspace, date) reconciliation

Run the harness per workspace, per date range. Grain: `(workspace_id, date, field)`.

```bash
# Pseudocode — do not execute until Stage 8
python -m brain_metrics.parity.harness \
  --workspace_id ws_live_001 \
  --date_start 2026-01-01 \
  --date_end 2026-01-31 \
  --live
```

---

## Step 4 — Triage by 5-category taxonomy

Categories (CF-C2-RECON-TAXONOMY-1):

| Category | Action |
|---|---|
| `BLOCKING_BUG` | **STOP. File a bug. Do NOT proceed to cutover.** |
| `EXPECTED_DEFINITIONAL_DELTA` | Verify in Child-4 Definitional-Delta Register. |
| `EXCLUDED_FX_MISMATCH` | FX rate difference. Excluded from gate. |
| `RATIO_MISMATCH` | Evaluate under separate ratio tolerance. |
| `ROUNDING_MODE_MISMATCH` | Division-derived field (miscExpensesProrated, cm3). Expected. Log count. |

The `rounding_mode_mismatches_count` in the report is non-blocking. It is
informational — tells the team how many .X45-midpoint division-derived cells
differ between Brain and legacy. This is expected and pre-classified.

---

## Step 5 — Cutover decision

Proceed to cutover only when:
- `blocking_bug_count == 0`
- All `EXPECTED_DEFINITIONAL_DELTA` items are registered in Child-4 register
- Founder gives explicit "proceed to cutover"

Cutover = flip the read source from legacy Decimal to Brain BIGINT columns.
(Additive columns already written during shadow period; this is the read switch.)

---

## Reversibility

Cutover is reversible until legacy-reads-decommissioned gate (Child 7):
- Roll back = revert the read source to legacy Decimal columns
- The `*_mu` BIGINT columns are not destroyed until Child 7
- No destructive step before Child 7
