# 14 — Retro — chore-app-hmac-secret-custody

| Field | Value |
|-------|-------|
| **req_id** | `chore-app-hmac-secret-custody` |
| **Stage 6 author** | Rohan (cto-advisor) |
| **Timestamp** | 2026-05-29T18:45:00Z |
| **Outcome** | PASS / APPROVE (delegated) — 0 bounces across S4/S5/S6 |

---

## What worked

- **The grounding correction at Stage 1 paid off all the way through.** The stub said the verifier
  was in core-service; the grounding note said api-gateway; both were partial. Catching the real
  3-consumer shape (C1/C2 TS OAuth + C3 Python webhook) at intake meant Aryan's owner-boundary
  ruling (CF-HMAC-TS-VS-PY-OWNER-1) was made on facts, not the stub. Zero rework downstream.
- **Folding the handoff into §17b (the 11-CF → artifact → bounce table)** gave every reviewer the
  same checklist. S4, S5, and S6 all verified against the identical contract; the verdicts lined
  up cleanly and the bounce conditions were mechanically checkable.
- **Three-layer mutation verification (Shreya → Tanvi → Rohan), each independent, each on disk.**
  All three got RED-then-byte-identical-revert-then-GREEN on both gates. The fail-closed mutation
  being corroborated by 3 *behavioral* assertions (not one tautological test) is exactly what made
  it credible after the builder interruption.
- **Reuse over re-author.** The provider mirrored the parent's lazy-boto3 / residency-assert /
  never-log / factory-flag primitives instead of forking a parallel custody class. Small,
  reversible slice; Single-Primitive held; over-engineering audit clean (no new deps/abstractions).
- **Honest HELD boundary.** The slice left a seam and explicitly did NOT build the ingress route or
  force the TS move. `git status` confirmed no endpoint/TS files touched. Scope discipline held.

## What didn't work / what to watch

- **A transient API-500 interrupted the Python builder mid-run.** The orchestrator completed the
  work — specifically (a) the NEVERLOG botocore-DEBUG defense-in-depth in `_fetch()` and (b) the
  entire `TestVerifyTheVerifier` class (the interrupted run never reached the verify-the-verifier
  obligation). This is the process risk of the run: **a CRITICAL gate's tests were authored by the
  completion path, not the original builder.** It was handled correctly here (Shreya re-mutated,
  Tanvi re-mutated, I re-mutated — three independent confirmations that the gate is non-vacuous),
  but the failure mode is real: an orchestrator-completed gate could in principle be self-confirming.
- **The mitigation that saved it was the durable verify-the-verifier rule itself** — because S6
  re-mutation is mandatory and runnable (moto, no AWS), the orchestrator-authored gate got an
  independent on-disk falsification test from a different actor. Without that rule, an
  interruption-completed gate would have shipped on the completer's own say-so.

## What surprised us

- The botocore-DEBUG response-body leak vector (botocore logs the raw GetSecretValue body, which
  contains the SecretString, on its own DEBUG logger independent of our ids-only logging). The
  scoped save/set-WARNING/restore-in-`finally` is a neat belt-and-suspenders fix; Shreya proved the
  restore survives the exception path. Worth remembering for any future Secrets Manager reader.
- How cleanly the parent's owner-split precedent (CF-CC-OWNER-1: Python owns AWS, TS stays
  AWS-free) resolved the TS-vs-Python crux — the ruling wrote itself once that precedent was cited.

## Process lesson (candidate signal)

**Builder interruption → orchestrator completion of a CRITICAL gate's own tests is a recurring-risk
pattern to watch.** The standing verify-the-verifier rule (mandatory independent S4/S5/S6
re-mutation) is the correct guardrail and worked here. Logged for the auto-candidate-rule scan
below; this is the first clearly-documented occurrence in this run-series, so it is a **lesson**,
not yet a rule (no ≥3 pattern). If builder-interruption-completed-gates recur, codify: "any gate
whose tests were authored by an interruption-completion path MUST get independent on-disk
re-mutation by a different actor before PASS" (already de-facto enforced by the verify-the-verifier
rule — would only need explicit tightening if the pattern repeats).
