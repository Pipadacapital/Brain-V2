# Retro — chore-scaffold-monorepo

> Filled by CTO Advisor (Rohan) at the close of Stage 6. Append-only.
> Feeds the lessons-learned registry at `.engineering-os/lessons-learned.md`.

| Field | Value |
|-------|-------|
| **req_id** | `chore-scaffold-monorepo` |
| **Parent req_id** | — *(standalone — first product-code requirement)* |
| **Shipped at** | 2026-05-24T00:05:00Z *(Stage 6 PASS; awaiting Founder commit)* |
| **Author** | cto-advisor (Rohan), on Founder's behalf under delegation |

---

## What worked (concrete patterns to replicate)

- **One adversarial toolchain persona banked the single most expensive mistake before it went load-bearing.** `monorepo-toolchain-realist` Concern 1 (Turborepo `--affected` is structurally blind to uv/Python members) became binding Stage-2 input 1 and is now load-bearing in the shipped `turbo.json` (`docker:build:*` root tasks with file-hash inputs). A pure-structure review would have missed it; it would have silently passed the success contract and broken per-service deploy for the 3 highest-churn Python services. Replicate: spend the 1 persona on the *coherence* dimension, not on re-litigating the folder tree (Aryan's job).
- **Scope discipline at intake (option-b, explicitly rejecting option-a and option-c) gave a verifiable floor.** The success contract ("the four tools actually resolve") is what made the scaffold testable — and it's what surfaced the betterproto defect. An unverifiable bare tree (option-a) would have shipped the bug to the next requirement.
- **The tightened acceptance contract (verification-before-completion at scaffold time) caught a real defect.** Adding `buf generate` + both-side import smokes (synthesis FYI-adopted) is exactly what bounced the wrong betterproto version. The contract earned its keep on its first use.
- **QA bounce-and-fix loop worked cleanly and traceably.** Tanvi BOUNCE (3 findings) → Vikram 3-line fix → Tanvi re-verify PASS (14/14), each step with captured output and its own artifact (09 / 07b / 09b). The bounce target was correct (backend-developer) and the fix was minimal (no scope change).

---

## What didn't work (concrete patterns to avoid)

- **A plugin version was pinned to a version that does not exist on the registry (`betterproto:v0.0.3`).** The architect plan said "ship real `out:` paths, not placeholders" but did not require the pinned plugin *version strings* to be validated against the BSR. It slipped through Stage 3 only because buf wasn't installed in that environment. Avoid: when a plan pins a remote/registry artifact, the build must verify the exact pinned coordinate resolves (or the reviewer must), not assume a plausible-looking version exists.
- **The Stage-3 build environment lacked buf**, so 4 acceptance items were SKIPPED and the BLOCKING codegen defect was only found at Stage 5. The pipeline absorbed it correctly (that's what Stage 5 is for), but a build environment missing a locked, required tool is friction — the toolchain a high-stakes build runs in should match the locked stack.
- **A "96 files staged" claim was made when the git index was actually empty** (files were on disk untracked). Reports should assert state they verified, not state they intended. Tanvi caught it (LOW); Vikram fixed it (explicit `git add` of 105 product paths).

---

## What surprised us

- **The persona's HIGH concern was structurally invisible to the success contract.** `turbo --affected` blindness to Python members would have passed every check (`pnpm install` + `turbo` graph + `uv sync` + `buf lint` all resolve) and still broken CI selective-deploy. This validated lane-ing a *scaffold* as high-stakes with a persona — counterintuitive for ".gitkeep folders," correct in hindsight.
- **`uv sync` alone does not install pylibs as importable;** `--all-packages` + a `hatchling` build-system per pylib was required for the import smokes. A reasonable plan assumption ("uv sync resolves") needed an impl-level correction — correctly handled within Vikram's authority, not escalated.
- **The dual TS+Python+buf root is genuinely unusual** (most Turborepo repos are pure-TS; most uv repos are pure-Python). The four-config junction (`pnpm-workspace.yaml` / `pyproject.toml` / `turbo.json` / `buf.gen.yaml`) had never been stress-tested in the Brain canon before this run — and three of the five persona concerns lived exactly there.

---

## Lessons to file in the registry

| # | Lesson (one-line) | Applies to | Evidence |
|---|---|---|---|
| 1 | When a plan pins a remote/registry artifact (buf plugin, container image, action), the build MUST verify the exact pinned coordinate resolves — a plausible-looking version is not a real one. | `process`, `infra`, `code` | 09-qa-report.md BLOCKING: `betterproto:v0.0.3` did not exist (latest v1.2.5); only caught at Stage 5 |
| 2 | A high-stakes build environment must contain every locked, required tool; a missing tool turns gate items into SKIPs that defer defects downstream. | `process`, `infra` | 07-build-report.md: buf absent at Stage 3 → 4 acceptance items SKIPPED → BLOCKING defect surfaced only at Stage 5 |
| 3 | For a polyglot (TS+Python) Turborepo, `turbo --affected` is blind to uv/Python members; per-service deploy needs explicit root tasks with file-hash `inputs` globs — decide this at scaffold time, not after services stack on top. | `infra`, `single-primitive`, `agent-discipline` | 03-persona Concern 1 → plan input 1 → shipped `turbo.json` `docker:build:*` root tasks |
| 4 | Generated proto stubs belong in dedicated named workspace-member packages (`proto-ts`/`proto_py`), gitignored + regenerated in CI — never path-aliased across the `protos/` boundary. | `code`, `infra` | DECISIONS.md ADR-002/003; verified both-side import smokes pass |
| 5 | Reports must assert verified state, not intended state ("staged" must mean the git index is non-empty). | `process`, `agent-discipline` | 09-qa-report.md LOW: "96 staged" claim vs empty index |

**Applies-to tags used:** `process`, `infra`, `code`, `single-primitive`, `agent-discipline`.

---

## Action items for next child

- [ ] Next CTOA intake: if a plan pins any remote/registry coordinate, add an explicit acceptance-contract line that the coordinate resolves (lesson 1).
- [ ] Next CTOA intake touching codegen/infra: confirm the build environment has the locked required tools BEFORE Stage 3, so gate items aren't SKIPPED (lesson 2).
- [ ] First real service requirement: delete/replace the `protos/brain/health/v1/health.proto` placeholder with the real contract (DECISIONS.md note).
- [ ] When Jatin wires CI: pin buf plugin *digests* (not tags) and run `buf generate` reproducibly (Shreya S-2).

---

## Cost + paradigm reality vs plan

| Metric | Planned | Actual | Variance |
|---|---|---|---|
| Monthly $ cost | ₹0 (no infra) | ₹0 | 0% |
| LLM tokens / day | 0 (no compute path) | 0 | 0% |
| Wall-clock duration | ~half-day build + review | ~1 day incl. 1 QA bounce+fix | within band |
| Paradigm declared | n/a | n/a | MATCH |
| Persona count | 1 | 1 (`monorepo-toolchain-realist`) | MATCH |

**Calibration note for next time:** A scaffold that establishes a registry/codegen contract is correctly high-stakes — the persona earned its keep and the tightened acceptance contract caught a real BLOCKING defect. The only avoidable cost was the QA round-trip caused by a non-validated plugin version + a build env missing buf; both are codified as lessons 1 and 2. Single occurrence each → lessons, not yet rules (no ≥3-run pattern exists; this is the first product-code run).
