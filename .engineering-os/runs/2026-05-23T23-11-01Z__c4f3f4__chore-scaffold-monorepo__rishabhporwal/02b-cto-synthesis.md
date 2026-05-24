# CTO Advisor — Stage 1 Synthesis (post-persona)

> Rohan (CTO Advisor), re-invoked after `03-persona-monorepo-toolchain-realist.md` landed.
> Companion to `02-cto-advisor-review.md` (intake). The intake decision stands; this finalizes it.

| Field | Value |
|-------|-------|
| **req_id** | `chore-scaffold-monorepo` |
| **Stage** | 1 (synthesis) |
| **Timestamp** | 2026-05-23T23:19:42Z |
| **Persona read** | `monorepo-toolchain-realist` — 5 concerns, **0 blocking** |
| **Persona accepted?** | YES — surfaces ≥1 concern (5), each material. Not a "looks good" persona. |
| **Verdict** | **ADVANCE → Architect (Aryan, Stage 2)** |
| **Lane** | `high-stakes` (unchanged) |
| **Scope change?** | **None.** All 5 concerns are plan-level toolchain decisions that fit *inside* the locked option-b scope — they tighten *how* the working toolchain is wired, not *what* is built. No scope creep, no lane change, no CHALLENGE-BACK. |

---

## Synthesis verdict on the persona

The `monorepo-toolchain-realist` did exactly the job it was charged with: it stress-tested whether the locked four-tool polyglot workspace (Turborepo+pnpm / uv / Buf at Node 24 LTS / Python 3.13) actually coheres in one root *before* the layout becomes load-bearing. Its single highest-value finding — **Turborepo's `--affected` graph is structurally blind to uv/Python workspace members** — is a genuine retrofit trap: it would silently pass the scaffold's success contract (`pnpm install` + `turbo` graph + `uv sync` + `buf lint` all resolve) yet break the §9.7 selective-per-service-deploy promise for half the stack (the three Python services). That is precisely the "cheap now / brutal later" class of defect Appendix C exists to prevent, and precisely why this req was lanted high-stakes with a persona rather than waved through.

All five concerns are **accepted as valid** and converted into binding Stage-2 constraints below. **None blocks ADVANCE** — they are *design decisions for the plan*, not defects in the requirement. The right place to resolve them is Aryan's binding Stage-2 plan, not a bounce to Founder: the Founder already pre-authorized option-b (working toolchain), and "make the working toolchain actually cohere across the TS/Python boundary" is the literal content of that scope.

---

## Triage: binding vs. FYI vs. scope-affecting

| # | Concern | Sev | Classification | Disposition |
|---|---------|-----|----------------|-------------|
| 1 | Turborepo `--affected` blind to Python members → §9.7 selective deploy undeliverable for 3 Python services without explicit root tasks + file-hash `inputs` globs | HIGH | **Binding constraint** | Aryan MUST design the Python `turbo.json` root-task + `inputs`-glob strategy in Stage 2. Document the graph-aware (TS) vs file-hash-aware (Python) asymmetry so Jatin (Stage 8) does not expect transitive Python dependency tracking that cannot exist. |
| 2 | Buf `gen` output landing zone undecided; `buf lint` ≠ stubs importable; commit-vs-gitignore for generated stubs undecided | HIGH | **Binding constraint** | Aryan MUST (a) decide the codegen `out:` homes and deliver a working `buf.gen.yaml` (not just `buf.yaml`); (b) decide generated-stubs **gitignore vs commit**; both at scaffold time. |
| 3 | Dual-workspace root coexistence — `.venv/` causes turbo cache false positives unless excluded; `pnpm-workspace.yaml` glob must not match Python dirs | MED | **Binding constraint** | Aryan MUST set explicit `turbo.json` input excludes (`.venv/**`, `uv.lock`, dist-info), explicit/enumerated `pnpm-workspace.yaml` members (not `apps/**`), and root `tsconfig.json` excludes for Python dirs + `.venv`. |
| 4 | Five pinning files (`.node-version`/`engines.node` + `packageManager`, `.python-version`/`requires-python`, `buf.yaml version`) must all ship or "resolves cleanly" holds on one machine only | MED | **Binding constraint** | Aryan MUST include all five pinning artifacts in the scaffold's file manifest with exact versions (Node 24, Python 3.13, pinned pnpm, pinned uv, buf v2). |
| 5 | Metric-registry parity CI (`tools/check-metrics-parity.sh` + `turbo.json` root task) has no stub home in the success contract | LOW | **Binding constraint (cheap)** | Aryan MUST create `tools/check-metrics-parity.sh` as an `exit 0` stub + a `check:metrics-parity` `turbo.json` root task with the parity-pair `inputs`. ~10 lines, closes the "home without a CI wiring point" gap. |

**FYI-only items (not binding, carry as plan notes):**
- Persona Recommendation 1 suggests a root `DECISIONS.md` capturing the Concern-1/2 decisions so Jatin doesn't reverse-engineer them. I **endorse** this — Aryan should record the codegen-home, gitignore, and Python-task-strategy decisions in a committed `DECISIONS.md` (or ADR) at repo root. Lightweight; not a separate deliverable beyond a short file.
- Persona Recommendation 2 (tighten the success contract with `turbo run check:metrics-parity` exits 0 + `python -c "import brain_metrics"` resolves) — I **adopt this into the Stage-2 acceptance criteria** so the scaffold fails loud on misconfiguration rather than appearing healthy. This is the verification-before-completion discipline applied at scaffold time; Tanvi (Stage 5) will run these.

**Scope/lane effect: NONE.** Every item lives inside option-b. No new directories beyond what option-b already promised (the codegen-home decision may add `packages/proto-ts/` + `pylibs/proto-py/` stub members, but that is the *implementation of* the locked proto-first non-negotiable, not new scope). Lane stays `high-stakes`. No `/escalate` trigger — no compliance ambiguity, no cost-model threat, no moat-changing decision.

---

## Aryan must resolve in Stage 2 (binding plan inputs)

1. **Python selective-deploy wiring (from Concern 1).** Explicit `turbo.json` root tasks for the 3 Python services (e.g. `docker:build:ingestion|analytics|intelligence`) whose `inputs` globs cover each service dir + its transitive `pylibs/` deps; tasks invoke shell/`uv` not `package.json` scripts. Document the graph-aware (TS) vs file-hash-aware (Python) `--affected` asymmetry for Jatin.
2. **Codegen out-paths + a working `buf.gen.yaml` (from Concern 2).** Decide where generated stubs land (recommended: dedicated workspace members `packages/proto-ts/` + `pylibs/proto-py/`, each a stub package created at scaffold time, so consumers import a *named package* not a relative path across the `protos/` boundary). Ship `buf.gen.yaml` with real `out:` paths, not a placeholder.
3. **Generated-stubs commit-vs-gitignore decision (from Concern 2).** Make the call at scaffold time and bake it into root `.gitignore`. (Persona-recommended: gitignore + regenerate in CI to avoid merge-conflict noise across 7 consumers — Aryan decides and records the rationale.)
4. **Dual-workspace root coexistence excludes (from Concern 3).** `turbo.json` input excludes (`.venv/**`, `uv.lock`, `*.dist-info`); enumerated/explicit `pnpm-workspace.yaml` members that never match Python dirs; root `tsconfig.json` excludes (`.venv`, `pylibs`, Python service dirs); root `.gitignore` (`.venv/`, `__pycache__/`, `*.egg-info/`); commit `uv.lock` + `pnpm-lock.yaml`.
5. **The five pins (from Concern 4).** `.node-version` (24) + `engines.node`; `package.json` `packageManager` (exact pnpm patch); `.python-version` (3.13) + `pyproject.toml` `requires-python = ">=3.13,<3.14"`; pinned uv (`[tool.uv] required-version` or pinned in bootstrap); `buf.yaml version: v2`. Plus a root `README`/`TOOLCHAIN.md` bootstrap command.
6. **Metric-parity CI stub home (from Concern 5).** `tools/check-metrics-parity.sh` as `exit 0` stub + `check:metrics-parity` `turbo.json` root task with `inputs: ["packages/lib-metrics/**","pylibs/brain_metrics/**","tools/check-metrics-parity.sh"]`.
7. **Record the structural decisions (FYI-endorsed).** Root `DECISIONS.md`/ADR capturing items 1–3 so Jatin (Stage 8) inherits them.
8. **Tighten the acceptance contract (FYI-adopted).** Add to Stage-2 acceptance criteria, for Tanvi to verify at Stage 5: `turbo run check:metrics-parity` exits 0; `python -c "import brain_metrics"` resolves; alongside the original `pnpm install` / `turbo` graph / `uv sync` / `buf lint`.

---

## Decision

**ADVANCE → Architect (Aryan, Stage 2).** Persona accepted (5 concerns, all material, 0 blocking). Lane stays `high-stakes`. Scope unchanged (option-b). The 8 items above are binding inputs to Aryan's Stage-2 plan and are carried into the feature journal so they survive the handoff.
