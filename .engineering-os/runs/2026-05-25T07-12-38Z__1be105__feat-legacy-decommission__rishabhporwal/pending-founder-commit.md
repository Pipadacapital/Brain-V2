# Pending Founder Commit — `feat-legacy-decommission` (Child 7, FINAL)

> Runbook-only child. NO product code (no app code, no `@paradigm`, no new runtime, legacy untouched). The only artifacts are the run-folder audit trail + the EOS memory/state updates. No agent commits — the Founder commits after free-text "commit it" (feature-branch-only rule + harness guard).
>
> **Mechanical command — explicit paths only, NO `git add -A`** (so no unrelated co-staged work is swept in). Current branch: `feature/feat-tenancy-auth-rls-hardening`.

## What this commits
- The Child-7 run folder (intake → persona → synthesis → runbook → handoff → final review → retro → founder decision → this file).
- The EOS audit-trail updates this Stage-6 made: state, decision-log, CTO-advisor journal, the per-feature journal.

## Command

```bash
cd /Users/rishabhporwal/Desktop/Brain

git add \
  ".engineering-os/runs/2026-05-25T07-12-38Z__1be105__feat-legacy-decommission__rishabhporwal/01-requirement.md" \
  ".engineering-os/runs/2026-05-25T07-12-38Z__1be105__feat-legacy-decommission__rishabhporwal/02-cto-advisor-review.md" \
  ".engineering-os/runs/2026-05-25T07-12-38Z__1be105__feat-legacy-decommission__rishabhporwal/03-persona-dpdp-decommission-safety-realist.md" \
  ".engineering-os/runs/2026-05-25T07-12-38Z__1be105__feat-legacy-decommission__rishabhporwal/05-stage1-synthesis.md" \
  ".engineering-os/runs/2026-05-25T07-12-38Z__1be105__feat-legacy-decommission__rishabhporwal/06-decommission-runbook.md" \
  ".engineering-os/runs/2026-05-25T07-12-38Z__1be105__feat-legacy-decommission__rishabhporwal/07-handoff-to-developer.md" \
  ".engineering-os/runs/2026-05-25T07-12-38Z__1be105__feat-legacy-decommission__rishabhporwal/11-final-review.md" \
  ".engineering-os/runs/2026-05-25T07-12-38Z__1be105__feat-legacy-decommission__rishabhporwal/12-founder-decision.json" \
  ".engineering-os/runs/2026-05-25T07-12-38Z__1be105__feat-legacy-decommission__rishabhporwal/14-retro.md" \
  ".engineering-os/runs/2026-05-25T07-12-38Z__1be105__feat-legacy-decommission__rishabhporwal/pending-founder-commit.md" \
  ".engineering-os/state/active.json" \
  ".engineering-os/decision-log/2026/05/2026-05-25.jsonl" \
  ".engineering-os/memory/agents/cto-advisor.journal.md" \
  ".engineering-os/memory/features/feat-legacy-decommission.md"

git commit -m "chore(eos): Child-7 (FINAL) legacy-decommission runbook — Stage 1-6 PASS

Runbook-only child (Child-0 analogue): no app code, no @paradigm, no new
runtime, legacy untouched. Rohan Stage-6 compliance + reversibility review
IS the gate (VETO) — PASS, Founder gate signed under standing delegation.

- 8-row PoNR ledger (4 PoNRs: per-connector plaintext-delete [Shiprocket
  last/no-replay], read-decommission, DB shutdown, archive deletion); each
  names precondition + positive-proof verification (no flag-read) + rollback
  tree valid until the line.
- DPDP §12 archive design (Option ALPHA live-read-only / BETA S3-Parquet
  per-workspace; flat pg_dump rejected); ap-south-1; archive vs decommission
  two dates; §12/§13 close-out + governance-phase handoff.
- 4 machine gates: custody (real seal() + prod-path-200 + parity),
  dwell (24h serve-stability), DDR (Gate P2 Brain-sourced), festival.
- FIRED custody escalation carried as build_gated_on; ARMED archive tripwire
  does NOT fire. Execution Stage-8 / Founder-at-console.

Closes the 7-child chore-migrate-legacy-to-brain epic (planning/build);
production cutover remains Founder-gated at Stage-8.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Explicitly NOT committed
- No `git add -A` / no `git add .` — other children's in-flight files (Child-3/4/6 audit trails, other journals) stay out of this commit unless the Founder chooses to stage them separately.
- No legacy edits (none were made — `CF-BN-NOLEGACY-1`).
- No product code (none exists in this child).
- No merge / no push to `development` / `release` / `master` — feature-branch only; the Founder drives every PR hop.
