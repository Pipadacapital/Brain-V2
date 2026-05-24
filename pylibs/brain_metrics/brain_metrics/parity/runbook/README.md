# HOLD-AT-LIVE-RECON — Stage 8 Only

**Status: HOLD-AT-LIVE-RECON. Do NOT run any script in this directory before the gated Stage-8 ceremony.**

This directory is NOT scanned by any migration runner. It mirrors the `migrations/manual/rls/` un-applicable-path discipline from Child-1.

## What lives here

- `live-reconciliation-runbook.md` — step-by-step guide for the future live parity run
- `column-migration-skeleton.sql` — additive `*_mu` column DDL (un-applicable until Stage-8 ceremony)

## Prerequisites (ALL must hold before the live run)

1. The C5 RLS gate is **LIVE/FORCED** (not merely SATISFIABLE) for the read tables.
2. Child-3 connectors have populated Brain's raw store (Brain MU values exist to compare).
3. Child-4 metric materialization exists for the `(workspace_id, date, field)` grain.
4. Founder has explicitly authorised the live reconciliation ceremony (Stage-8 "commit it").

None of these hold at Child-2 exit → the live run is correctly impossible now.

## Reversibility

The `*_mu` columns are ADDITIVE (legacy Decimal columns untouched during shadow).
Rollback = `ALTER TABLE DROP COLUMN *_mu` (no data loss; no destructive step until Child-7).
