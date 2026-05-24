# Pending Founder Commit — chore-scaffold-monorepo

> Stage 6 PASS (Rohan, CTO Advisor). Per the standing **no-commit rule**, agents stage but the Founder commits product code.
> The 105 product-code files are already staged (`git diff --cached` is non-empty). Generated stubs and `.engineering-os/` are correctly NOT staged.
> Review the diff, then run the commit below.

## 1. Review the staged diff

```bash
git -C /Users/rishabhporwal/Desktop/Brain diff --cached --stat
git -C /Users/rishabhporwal/Desktop/Brain diff --cached        # full diff
```

Expected: 105 files changed, ~1249 insertions. No `gen/`/`_gen/` stubs. No `.engineering-os/` files.

## 2. (Optional) Re-confirm staged set is product-code only

```bash
# Should be empty — no generated stubs staged:
git -C /Users/rishabhporwal/Desktop/Brain diff --cached --name-only | grep -E "gen/|_gen/"
# Should be empty — no EOS files staged (those belong to Jatin's Stage-8 chore(eos): commit):
git -C /Users/rishabhporwal/Desktop/Brain diff --cached --name-only | grep "^.engineering-os/"
```

## 3. Commit (mechanical — files are already staged, no `git add -A`)

```bash
git -C /Users/rishabhporwal/Desktop/Brain commit -m "feat(scaffold): establish Brain monorepo skeleton and working root toolchain

- §9.1 directory tree: apps/ (9 product dirs), packages/, pylibs/, protos/
- §9.2 DDD layer folders (bootstrap/domain/application/infrastructure/interfaces)
  as .gitkeep in all 7 backend services; no controllers/ anywhere
- Root toolchain: pnpm@11.0.9 workspace (enumerated TS members),
  Turborepo (build/lint/test + 3 docker:build:* Python root tasks),
  uv workspace (3 Python services + 5 pylibs), buf v2 (buf.yaml + buf.gen.yaml)
- Five toolchain pins: Node 24, pnpm@11.0.9, Python 3.13, uv>=0.8.22, buf v2
- Metric-parity CI stub: tools/check-metrics-parity.sh + check:metrics-parity turbo task
- buf.gen.yaml: betterproto plugin v1.2.5; buf generate produces TS stubs
  (packages/proto-ts/gen/) and Python stubs (pylibs/proto_py/proto_py/_gen/) — gitignored, regen in CI
- packages/proto-ts: @bufbuild/protobuf runtime dep
- Day-one-non-negotiable homes: money, 4-layer workspace_id seam, Decision Log,
  events/idempotency, RegionAdapter, metric-registry TS/Python pair, @paradigm,
  OLTP/OLAP split, Morning Brief (mobile)
- DECISIONS.md (5 ADRs), TOOLCHAIN.md (bootstrap + CI guidance)
- docs/conventions/: 8 convention files establishing the homes
- Scaffold placeholder: protos/brain/health/v1/health.proto (buf codegen verified)"
```

## Notes
- This is the FIRST product-code commit. Nothing to break, no migration, no infra.
- After commit, the orchestrator advances to Stage 8 (Jatin) for the deploy/infra track (per pipeline), which is separate from this commit.
- Non-blocking follow-ups for later (NOT part of this commit): pin buf plugin digests at CI; align dev/CI to Node 24; replace `health.proto` placeholder with the first real service contract.
